"""#5609 lossless private candidate -> proposed probe, never writes the source.

Prints verification SELECT unless --verified-md5 supplies an independent SQL hash.
With verification it prints a proposed full probe for root inspection/activation.
"""
import argparse
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re

FIELDS = ('userid','dbid','toplevel','queryid','stats_since','query_md5','calls','total_exec_time','wal_bytes')


def integer(v, low, high):
    if isinstance(v, bool) or not isinstance(v, (str, int)) or not re.fullmatch(r'-?\d+', str(v)):
        raise ValueError('integer must be a lossless string/integer')
    n = int(v)
    if not low <= n <= high:
        raise ValueError('integer out of range')
    return str(n)


def timestamp(v):
    t = datetime.fromisoformat(v)
    if t.tzinfo is None:
        raise ValueError('timezone required')
    return t.astimezone(timezone.utc)


def numeric(v):
    if not isinstance(v, (str, Decimal, int)) or isinstance(v, bool):
        raise ValueError('numeric must not pass through binary floating point')
    d = Decimal(v)
    if not d.is_finite() or d < 0:
        raise ValueError('nonnegative finite numeric required')
    return format(d, 'f')


def literal(v):
    return "'" + v.replace("'", "''") + "'"


def prepare(candidate):
    rows = candidate['family']
    if not rows:
        raise ValueError('empty family')
    encoded = []
    keys = set()
    opening = timestamp(candidate['observed_at'])
    for r in rows:
        if set(r) != set(FIELDS) or type(r['toplevel']) is not bool:
            raise ValueError('incomplete/unknown vector fields')
        vals = [integer(r['userid'],0,2**32-1),integer(r['dbid'],0,2**32-1), 't' if r['toplevel'] else 'f',integer(r['queryid'],-2**63,2**63-1)]
        key = (int(vals[0]),int(vals[1]),r['toplevel'],int(vals[3]))
        if key in keys:
            raise ValueError('duplicate tuple')
        keys.add(key)
        ts = timestamp(r['stats_since'])
        if ts > opening or not re.fullmatch('[0-9a-f]{32}',r['query_md5']):
            raise ValueError('invalid start/hash')
        delta = ts-datetime(1970,1,1,tzinfo=timezone.utc)
        epoch = Decimal(delta.days*86400+delta.seconds)+Decimal(delta.microseconds)/1000000
        counters = [integer(r['calls'],0,2**63-1), numeric(r['total_exec_time']), numeric(r['wal_bytes'])]
        text = '('+','.join(vals+[format(epoch,'.6f'),r['query_md5']]+counters)+')'
        sqlvals = [vals[0]+'::oid',vals[1]+'::oid',str(r['toplevel']).lower(),vals[3]+'::bigint',literal(ts.isoformat())+'::timestamptz',literal(r['query_md5']),counters[0]+'::bigint',counters[1]+'::numeric',counters[2]+'::numeric']
        encoded.append((key,text,'('+','.join(sqlvals)+')'))
    encoded.sort()
    digest = hashlib.md5('\n'.join(x[1] for x in encoded).encode()).hexdigest()
    values = ',\n'.join(x[2] for x in encoded)
    verification = 'with frozen('+','.join(FIELDS)+') as(values\n'+values+") select count(*) entries,md5(string_agg(row(userid,dbid,toplevel,queryid,extract(epoch from stats_since),query_md5,calls,total_exec_time,wal_bytes)::text,E'\\n' order by userid,dbid,toplevel,queryid)) vector_md5 from frozen;\n"
    return len(rows), digest, values, verification


def proposed(candidate, source, verified):
    count,digest,values,_ = prepare(candidate)
    if verified != digest:
        raise ValueError('independent SQL vector hash mismatch')
    tables = {r['relname']:r for r in candidate['tables']}
    substitutions = {'observed_at':literal(candidate['observed_at']), 'statement_stats_reset':literal(candidate['statement_stats_reset']),
      'database_stats_reset':'null' if candidate['database_stats_reset'] is None else literal(candidate['database_stats_reset']),
      'postmaster_started_at':literal(candidate['postmaster_started_at']), 'statement_dealloc':integer(candidate['statement_dealloc'],0,2**63-1),
      'family_entry_count':str(count),'family_vector_md5':literal(digest),
      'asset_relid':integer(tables['assets']['relid'],0,2**32-1),'document_relid':integer(tables['dam_search_documents']['relid'],0,2**32-1),
      'asset_updates':integer(tables['assets']['n_tup_upd'],0,2**63-1),'document_updates':integer(tables['dam_search_documents']['n_tup_upd'],0,2**63-1)}
    for name,value in substitutions.items():
        source,n = re.subn(r'null::(\w+) as '+name+r'\b',lambda m:value+'::'+m[1]+' as '+name,source,count=1)
        if n != 1:
            raise ValueError('source is not the expected unset template: '+name)
    a=source.index(' -- UNSET: populate');b=source.index('), query_stats as (',a)
    source=source[:a]+' select * from (values\n'+values+'\n )v('+','.join(FIELDS)+')\n'+source[b:]
    return source


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('candidate',type=Path)
    parser.add_argument('--verified-md5')
    parser.add_argument('--template',type=Path,default=Path('.github/live-proofs/5609.sql'))
    args=parser.parse_args()
    candidate=json.loads(args.candidate.read_text(),parse_float=Decimal)
    count,digest,values,verification=prepare(candidate)
    print(proposed(candidate,args.template.read_text(),args.verified_md5) if args.verified_md5 else verification,end='')
