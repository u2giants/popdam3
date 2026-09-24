import csv
import hashlib
import json
from pathlib import Path

import pytest

from .evaluate import FIELDS, canonical_fields, description_sha256, evaluate, main


def test_fact_order_is_not_a_different_material():
    left = dict.fromkeys(FIELDS, '')
    right = dict(left)
    left['product_material'] = 'MDF; Glass'
    right['product_material'] = 'Glass; MDF'
    assert canonical_fields(left) == canonical_fields(right)
    right['product_material'] = 'Glass'
    assert canonical_fields(left) != canonical_fields(right)


def write_csv(path, rows):
    with path.open('w', encoding='utf-8', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


@pytest.fixture
def inputs(tmp_path):
    corpus = tmp_path / 'corpus.json'
    corpus.write_text(json.dumps([{'description': 'pencil case', 'item_count': 7},
                                 {'description': None, 'item_count': 2}]), encoding='utf-8')
    manifest = tmp_path / 'manifest.json'
    manifest.write_text(json.dumps(dict(sha256=hashlib.sha256(corpus.read_bytes()).hexdigest(),
                                        source_row_count=9, source='coldlion.item_header',
                                        captured_at='2026-09-19T12:00:00Z')))
    labels = tmp_path / 'labels.csv'
    expected = dict.fromkeys(FIELDS, '')
    expected.update(product_type='Pencil Case', product_type_status='accepted')
    row = dict(label_id='pencil', matched_wording='pencil case', **expected,
               review_status='reviewed', reviewed_by='independent implementer', review_note='physical case')
    blank = dict(row, label_id='blank', product_type='', product_type_status='unreadable')
    write_csv(labels, [row, blank])
    assignments = tmp_path / 'assignments.csv'
    write_csv(assignments, [dict(description_sha256=description_sha256('pencil case'), label_id='pencil'),
                            dict(description_sha256=description_sha256(None), label_id='blank')])
    return corpus, manifest, labels, assignments


def correct_reader(description):
    return dict(product_type='Pencil Case' if description else None, product_construction=None,
                product_material=None, product_treatment=None,
                product_type_status='accepted' if description else 'unreadable')


def test_full_weighted_catalog(inputs):
    result, details = evaluate(*inputs, correct_reader)
    assert result['counts'] == dict(source_rows=9, distinct_descriptions=2, null_rows=2,
                                   correct=9, wrong=0, unreadable=2, placeholder=0, uncovered=0, errors=0, reviewed_rows=9, passed=True)
    assert len(details) == 1


def test_report_fingerprints_all_runtime_rule_modules(inputs, capsys):
    args = [value for name, path in zip(('corpus', 'manifest', 'labels', 'assignments'), inputs)
            for value in ('--' + name, str(path))]
    assert main(args) == 0
    fingerprints = json.loads(capsys.readouterr().out)['implementation_sha256']
    root = Path(__file__).parent
    modules = [p for p in root.rglob('*.py')
               if not p.name.startswith('test_') and '__pycache__' not in p.parts]
    assert 'storage_rules.py' in fingerprints and 'gold/coverage.py' in fingerprints
    for path in modules:
        key = path.relative_to(root).as_posix()
        assert fingerprints[key] == hashlib.sha256(path.read_bytes()).hexdigest()


def test_abstention_on_readable_is_wrong(inputs):
    result, _ = evaluate(*inputs, lambda description: correct_reader(None))
    assert result['counts']['wrong'] == 7
    assert not result['counts']['passed']


@pytest.mark.parametrize('field,value', [('product_type', 'Mat'), ('product_material', 'rubber'),
                                        ('product_construction', 'woven'), ('product_treatment', 'foil'),
                                        ('product_type_status', 'placeholder')])
def test_mutation_cannot_change_gold(inputs, field, value):
    def mutant(description):
        result = correct_reader(description)
        if description:
            result[field] = value
        return result
    result, _ = evaluate(*inputs, mutant)
    assert result['counts']['wrong'] + result['counts']['errors'] == 7
    assert not result['counts']['passed']


def test_missing_assignment_is_uncovered(inputs):
    write_csv(inputs[3], [dict(description_sha256=description_sha256(None), label_id='blank')])
    result, _ = evaluate(*inputs, correct_reader)
    assert result['counts']['uncovered'] == 7
    assert not result['counts']['passed']


def test_changed_corpus_rejected(inputs):
    inputs[0].write_text('[{"description":"pencil case","item_count":8}]')
    with pytest.raises(ValueError, match='SHA or source row count'):
        evaluate(*inputs, correct_reader)


def test_unreviewed_gold_rejected(inputs):
    inputs[2].write_text(inputs[2].read_text().replace(',reviewed,', ',proposed,'))
    with pytest.raises(ValueError, match='review metadata'):
        evaluate(*inputs, correct_reader)


def test_duplicate_assignment_rejected(inputs):
    contents = inputs[3].read_text()
    inputs[3].write_text(contents + contents.splitlines()[1] + '\n')
    with pytest.raises(ValueError, match='duplicate assignment'):
        evaluate(*inputs, correct_reader)


def test_null_not_equal_empty():
    assert description_sha256(None) != description_sha256('')


def test_reader_error_is_not_success(inputs):
    def broken(description):
        raise RuntimeError('private description')
    result, details = evaluate(*inputs, broken)
    assert result['counts']['errors'] == 9
    assert not result['counts']['passed']
    assert 'private description' not in json.dumps(details)


def test_empty_semantic_strings_equal_null(inputs):
    def reader(description):
        return {field: value if value is not None else '' for field, value in correct_reader(description).items()}
    result, _ = evaluate(*inputs, reader)
    assert result['counts']['passed']


def test_census_includes_uncovered_without_accuracy_claim(inputs):
    write_csv(inputs[3], [dict(description_sha256=description_sha256(None), label_id='blank')])
    result, _ = evaluate(*inputs, correct_reader)
    assert result['counts']['correct'] == 2
    assert result['counts']['reviewed_rows'] == 2
    assert result['prediction_census'] == dict(accepted=7, unreadable=2, placeholder=0, errors=0)
    assert not result['counts']['passed']


@pytest.mark.parametrize('invalid', [False, 0, [], {}])
def test_invalid_reader_semantic_value_cannot_equal_blank(inputs, invalid):
    def reader(description):
        result = correct_reader(description)
        if description:
            result['product_material'] = invalid
        return result
    result, _ = evaluate(*inputs, reader)
    assert result['counts']['errors'] == 7
    assert not result['counts']['passed']


def test_duplicate_gold_header_rejected(inputs):
    path = inputs[2]
    lines = path.read_text(encoding='utf-8').splitlines()
    header = lines[0].split(',')
    at = header.index('product_material')
    header.insert(at + 1, 'product_material')
    changed = [','.join(header)]
    for line in lines[1:]:
        cells = line.split(',')
        cells.insert(at + 1, '')
        changed.append(','.join(cells))
    path.write_text('\n'.join(changed) + '\n', encoding='utf-8')
    with pytest.raises(ValueError, match='unique nonempty headers'):
        evaluate(*inputs, correct_reader)


def test_whitespace_only_accepted_gold_type_rejected(inputs):
    path = inputs[2]
    path.write_text(path.read_text(encoding='utf-8').replace('Pencil Case', '   '), encoding='utf-8')
    with pytest.raises(ValueError, match='requires product type'):
        evaluate(*inputs, correct_reader)


def _cli_args(inputs):
    return [value for name, path in zip(('corpus', 'manifest', 'labels', 'assignments'), inputs)
            for value in ('--' + name, str(path))]


def test_strict_exit_code_fails_only_a_failing_gate(inputs):
    corpus, manifest, labels, assignments = inputs
    rows = list(csv.DictReader(labels.open(encoding='utf-8', newline='')))
    rows[0]['product_type'] = 'Mat'
    write_csv(labels, rows)
    assert main(_cli_args(inputs)) == 0
    live = _live(inputs)
    assert main(_cli_args(inputs) + ['--strict']) == 2  # strict without a live recheck is refused
    assert main(_cli_args(inputs) + ['--strict', '--live-recheck', str(live)]) == 1


def test_private_details_refused_inside_any_git_checkout(inputs, tmp_path):
    checkout = tmp_path / 'some-checkout'
    (checkout / '.git').mkdir(parents=True)
    target = checkout / 'nested' / 'details.json'
    assert main(_cli_args(inputs) + ['--private-details', str(target)]) == 2
    assert not target.exists()
    worktree = tmp_path / 'linked-worktree'
    worktree.mkdir()
    (worktree / '.git').write_text('gitdir: elsewhere', encoding='utf-8')
    assert main(_cli_args(inputs) + ['--private-details', str(worktree / 'd.json')]) == 2


def test_private_details_written_to_plain_directory(inputs, tmp_path):
    target = tmp_path / 'plain' / 'details.json'
    assert main(_cli_args(inputs) + ['--private-details', str(target)]) == 0
    assert target.is_file()


def _live(inputs, **overrides):
    corpus, manifest = inputs[0], inputs[1]
    data = dict(checked_at='2026-09-20T00:00:00Z', source='coldlion.item_header',
                sha256=hashlib.sha256(corpus.read_bytes()).hexdigest(),
                source_row_count=9, distinct_descriptions=2)
    data.update(overrides)
    path = manifest.parent / 'live.json'
    path.write_text(json.dumps(data), encoding='utf-8')
    return path


def test_live_recheck_recorded(inputs):
    result, _ = evaluate(*inputs, correct_reader, _live(inputs))
    assert result['live_recheck']['source_row_count'] == 9


@pytest.mark.parametrize('overrides', [
    dict(checked_at='2026-09-18T00:00:00Z'), dict(checked_at='2026-09-20T00:00:00'),
    dict(source='other'), dict(sha256='0' * 64), dict(source_row_count=10),
    dict(source_row_count='9'), dict(distinct_descriptions=3)])
def test_live_recheck_mismatch_or_stale_rejected(inputs, overrides):
    with pytest.raises(ValueError):
        evaluate(*inputs, correct_reader, _live(inputs, **overrides))


def _rewrite_manifest(inputs, **overrides):
    data = json.loads(inputs[1].read_text())
    data.update(overrides)
    inputs[1].write_text(json.dumps(data))


@pytest.mark.parametrize('overrides', [dict(source='other'), dict(captured_at='2026-09-19T12:00:00'),
                                       dict(captured_at=None)])
def test_manifest_source_and_capture_time_required(inputs, overrides):
    _rewrite_manifest(inputs, **overrides)
    with pytest.raises(ValueError):
        evaluate(*inputs, correct_reader)


def test_unknown_label_and_foreign_assignment_rejected(inputs):
    corpus, manifest, labels, assignments = inputs
    write_csv(assignments, [dict(description_sha256=description_sha256('pencil case'), label_id='nope'),
                            dict(description_sha256=description_sha256(None), label_id='blank')])
    with pytest.raises(ValueError):
        evaluate(*inputs, correct_reader)
    write_csv(assignments, [dict(description_sha256=description_sha256('pencil case'), label_id='pencil'),
                            dict(description_sha256=description_sha256('not in corpus'), label_id='pencil')])
    with pytest.raises(ValueError):
        evaluate(*inputs, correct_reader)


@pytest.mark.parametrize('rows', [
    [{'description': 'pencil case', 'item_count': 0}],
    [{'description': 'pencil case', 'item_count': 'x'}],
    [{'description': 'pencil case', 'item_count': 4}, {'description': 'pencil case', 'item_count': 5}]])
def test_bad_corpus_rows_rejected(inputs, rows):
    corpus, manifest = inputs[0], inputs[1]
    corpus.write_text(json.dumps(rows), encoding='utf-8')
    _rewrite_manifest(inputs, sha256=hashlib.sha256(corpus.read_bytes()).hexdigest())
    with pytest.raises(ValueError):
        evaluate(*inputs, correct_reader)


def test_unreadable_label_carrying_fields_rejected(inputs):
    labels = inputs[2]
    rows = list(csv.DictReader(labels.open(encoding='utf-8', newline='')))
    rows[1]['product_type'] = 'Mat'
    write_csv(labels, rows)
    with pytest.raises(ValueError):
        evaluate(*inputs, correct_reader)


def test_legacy_reader_runs_through_cli(inputs):
    assert main(_cli_args(inputs) + ['--reader', 'legacy']) in (0, 1)
