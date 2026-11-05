"""Offline safety checks; importing/running these tests never opens a DB."""
import argparse
import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location('benchmark', Path(__file__).with_name('benchmark_sg_hnsw_rebuild.py'))
benchmark = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(benchmark)


class BenchmarkSafetyTests(unittest.TestCase):
    def options(self, **overrides):
        return argparse.Namespace(**dict(target_identity='preview-fixture', old_rows=1000,
            new_rows=250, probes=32, statement_ms=30000, deadline_s=180, **overrides))

    def test_rejects_production_even_if_claimed_preview(self):
        with self.assertRaises(ValueError):
            benchmark.validate(self.options(), 'postgresql://user.'+benchmark.PRODUCTION_REF+'@preview-fixture/postgres')

    def test_requires_target_identity_in_connection(self):
        with self.assertRaises(ValueError):
            benchmark.validate(self.options(), 'postgresql://other-fixture/postgres')

    def test_accepts_pinned_disposable_target(self):
        benchmark.validate(self.options(), 'postgresql://preview-fixture/postgres')

    def test_limits_rows_and_runtime(self):
        for attr, value in [('old_rows',250001),('new_rows',1000),('probes',251),
                            ('statement_ms',900001),('deadline_s',3601)]:
            options = self.options()
            setattr(options,attr,value)
            with self.subTest(attr=attr), self.assertRaises(ValueError):
                benchmark.validate(options,'postgresql://preview-fixture/postgres')

    def test_no_shared_table_or_extension_creation(self):
        table,index=benchmark.fixture_sql()
        self.assertTrue(table.startswith('CREATE TEMP TABLE '))
        self.assertIn('ON pg_temp.',index)
        self.assertIn('embedding extensions.vector_cosine_ops',index)
        self.assertIn('WHERE embedding IS NOT NULL',index)
        self.assertNotIn('CONCURRENTLY',index)

    def test_fixture_vectors_are_768_dimensional_and_seeded(self):
        first=benchmark.vector_expression(17)
        second=benchmark.vector_expression(29)
        self.assertIn('generate_series(1,768)',first)
        self.assertIn('::extensions.vector(768)',first)
        self.assertNotEqual(first,second)


if __name__ == '__main__':
    unittest.main()
