"""Reviewed real descriptions with independently reviewed facts.

The fixture holds live catalog wording, so it lives only in the private evidence
package (`reviewed-description-fixture.csv`), never in this public repository.
Point PRODUCT_TYPE_READER_PRIVATE_FIXTURE at it to run these checks; the public
synthetic tests cover every rule without it.
"""
import csv
import os
from pathlib import Path

import pytest



_FIXTURE_PATH = os.environ.get('PRODUCT_TYPE_READER_PRIVATE_FIXTURE', '')
if not _FIXTURE_PATH:
    if os.environ.get('PRODUCT_TYPE_READER_REQUIRE_PRIVATE_FIXTURE') == '1':
        raise RuntimeError('PRODUCT_TYPE_READER_PRIVATE_FIXTURE is required but unset')
    pytest.skip('REQUIRED private evidence not run here: reviewed-description fixture not configured '
                '(set PRODUCT_TYPE_READER_PRIVATE_FIXTURE)', allow_module_level=True)
from tools.product_type_reader import read_product_type
from tools.product_type_reader.evaluate import FIELDS, canonical_fields
with Path(_FIXTURE_PATH).open(encoding='utf-8', newline='') as stream:
    CASES = list(csv.DictReader(stream))
if not CASES:
    raise RuntimeError(f'private fixture {_FIXTURE_PATH} is empty')


@pytest.mark.parametrize('case', CASES, ids=[f'case-{i:04d}' for i in range(len(CASES))])
def test_reviewed_real_description(case):
    expected = {field: case[field] for field in FIELDS}
    actual = read_product_type(case['description'])
    assert canonical_fields(actual) == canonical_fields(expected)
