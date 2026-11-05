#!/usr/bin/env python3
"""Synthetic, session-temporary HNSW reset/rebuild experiment for #5616.

No connection or SQL runs on import. DSN is read ONLY from SG_HNSW_BENCHMARK_DSN.
Root must authorize the target separately. Temporary objects only; session close
cleans them up. Never use the production project's DSN.
"""
import argparse
import json
import os
import time

PRODUCTION_REF = "qsllyeztdwjgirsysgai"
TABLE = "sg_hnsw_bench_documents"
INDEX = "sg_hnsw_bench_embedding_hnsw"


def validate(options, dsn):
    if not dsn or PRODUCTION_REF in dsn:
        raise ValueError("A separately authorized non-production DSN is required")
    if not options.target_identity or options.target_identity == PRODUCTION_REF or options.target_identity not in dsn:
        raise ValueError("Pass the independently verified non-production target identity")
    if not 1 <= options.new_rows < options.old_rows <= 250000:
        raise ValueError("Require 1 <= new-rows < old-rows <= 250000")
    if not 1 <= options.probes <= options.new_rows:
        raise ValueError("Require 1 <= probes <= new-rows")
    if not 1000 <= options.statement_ms <= 900000:
        raise ValueError("Require 1000 <= statement-ms <= 900000")
    if not 10 <= options.deadline_s <= 3600:
        raise ValueError("Require 10 <= deadline-s <= 3600")


def vector_expression(seed):
    # Deterministic, varied 768-dimensional values, with no licensed source data.
    return ("ARRAY(SELECT (((hashint8extended((i::bigint * 768 + j), "
            + str(seed) + ") & 2147483647)::double precision / 1073741824.0) - 1)"
            "::real FROM generate_series(1,768) j)::extensions.vector(768)")


def fixture_sql():
    return (
        "CREATE TEMP TABLE " + TABLE + " (id integer PRIMARY KEY, "
        "embedding extensions.vector(768)) ON COMMIT PRESERVE ROWS",
        "CREATE INDEX " + INDEX + " ON pg_temp." + TABLE
        + " USING hnsw (embedding extensions.vector_cosine_ops) WHERE embedding IS NOT NULL",
    )


def run(options, connect):
    dsn = os.environ.get("SG_HNSW_BENCHMARK_DSN", "")
    validate(options, dsn)
    started = time.monotonic()
    # Autocommit is intentional: a same-transaction reset would retain versions
    # and would not reproduce production's committed mass clear and new writes.
    with connect(dsn, autocommit=True, connect_timeout=15,
                 application_name="sg-hnsw-synthetic-benchmark-5616") as connection:
        def execute(sql, params=None):
            remaining_ms = int((options.deadline_s - (time.monotonic() - started)) * 1000)
            if remaining_ms <= 0:
                raise TimeoutError("Benchmark total deadline reached")
            with connection.cursor() as cursor:
                cursor.execute("select set_config('statement_timeout', %s, false)",
                               (str(min(options.statement_ms, remaining_ms)),))
                cursor.execute(sql, params)
                return cursor.fetchall() if cursor.description else []

        execute("SET lock_timeout='500ms'")
        identity = execute("select current_database(), current_user, current_setting('server_version'), "
                           "current_setting('shared_buffers'), current_setting('maintenance_work_mem')")[0]
        print(json.dumps({"event": "target", "verified_target": options.target_identity,
                          "database": identity[0], "role": identity[1], "server": identity[2],
                          "shared_buffers": identity[3], "maintenance_work_mem": identity[4]}), flush=True)
        installed = execute("select extversion from pg_extension where extname='vector'")
        if not installed or installed[0][0] != "0.8.0":
            raise ValueError("Benchmark requires the production-matching existing pgvector 0.8.0")
        table_sql, index_sql = fixture_sql()
        execute(table_sql)

        def measure(label):
            row = execute("select pg_relation_size('pg_temp." + INDEX + "'), "
                          "count(*) filter(where embedding is not null) from pg_temp." + TABLE)[0]
            print(json.dumps({"event": "size", "stage": label, "index_bytes": row[0],
                              "nonnull_vectors": row[1]}), flush=True)

        def timed(label, sql, params=None):
            tick = time.monotonic()
            result = execute(sql, params)
            print(json.dumps({"event": "operation", "stage": label,
                              "elapsed_ms": round((time.monotonic()-tick)*1000, 2)}), flush=True)
            return result

        timed("old_vectors", "INSERT INTO pg_temp." + TABLE + " SELECT i, "
              + vector_expression(17) + " FROM generate_series(1,%s) i", (options.old_rows,))
        timed("original_index", index_sql)
        measure("old_vectors")
        timed("committed_clear", "UPDATE pg_temp." + TABLE + " SET embedding=NULL")
        timed("new_vectors", "UPDATE pg_temp." + TABLE + " t SET embedding=v.embedding FROM "
              "(SELECT i, " + vector_expression(29) + " embedding FROM generate_series(1,%s) i) v "
              "WHERE t.id=v.i", (options.new_rows,))
        measure("after_clear_and_new_vectors")

        def probe(label, offset):
            # Distinct new values force actual vector writes on both sides.
            plan = timed(label, "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) UPDATE pg_temp." + TABLE
                         + " t SET embedding=v.embedding FROM (SELECT i, "
                         + vector_expression(offset) + " embedding FROM generate_series(1,%s) i) v "
                         "WHERE t.id=v.i", (options.probes,))[0][0][0]
            node = plan["Plan"]
            print(json.dumps({"event": "write_probe", "stage": label,
                              "execution_ms": plan["Execution Time"],
                              "local_hit_blocks": node.get("Local Hit Blocks", 0),
                              "local_read_blocks": node.get("Local Read Blocks", 0),
                              "local_written_blocks": node.get("Local Written Blocks", 0),
                              "shared_hit_blocks": node.get("Shared Hit Blocks", 0),
                              "shared_read_blocks": node.get("Shared Read Blocks", 0)}), flush=True)

        probe("before_identical_rebuild", 41)
        timed("identical_rebuild", "REINDEX INDEX pg_temp." + INDEX)
        measure("after_identical_rebuild")
        probe("after_identical_rebuild", 53)
        execute("DROP TABLE pg_temp." + TABLE)
        print(json.dumps({"event": "complete", "cleanup": "temporary table dropped; session closes"}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target-identity", required=True)
    parser.add_argument("--old-rows", type=int, default=1000)
    parser.add_argument("--new-rows", type=int, default=250)
    parser.add_argument("--probes", type=int, default=32)
    parser.add_argument("--statement-ms", type=int, default=30000)
    parser.add_argument("--deadline-s", type=int, default=180)
    options = parser.parse_args()
    import psycopg
    try:
        run(options, psycopg.connect)
    except Exception as error:
        # Never echo connection exceptions/SQL details that could include a DSN.
        print(json.dumps({"event": "failed", "error_type": type(error).__name__,
                          "cleanup": "connection context closes; temporary objects removed"}), flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
