"""Prove independently labelled coverage without consulting reader predictions."""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from tools.product_type_reader.evaluate import load_corpus, load_gold


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('corpus', 'labels', 'assignments'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args(argv)
    try:
        corpus = load_corpus(args.corpus)
        _, assignments = load_gold(args.labels, args.assignments)
        keys = {row[0] for row in corpus}
        if set(assignments) - keys:
            raise ValueError('Assignments outside corpus')
        uncovered = sum(count for key, _, count in corpus if key not in assignments)
        print(f'uncovered: {uncovered}')
        return 1 if uncovered else 0
    except Exception:  # any failure is exit 2, never a traceback or a false pass
        print('coverage: invalid input')
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
