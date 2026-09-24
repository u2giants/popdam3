"""Pictured content must never add a construction (F3); material vocabularies stay aligned (F4)."""
import ast
from pathlib import Path

import pytest

from . import material_rules, reader
from .construction_rules import refine_construction
from .reader import read_product_type

SOURCE = Path(__file__).with_name('construction_rules.py').read_text(encoding='utf-8')


def _calls(node, name):
    return any(isinstance(n, ast.Call) and getattr(n.func, 'id', None) == name for n in ast.walk(node))


def test_whole_stated_guards_only_removals():
    for node in ast.walk(ast.parse(SOURCE)):
        if isinstance(node, ast.If) and _calls(node.test, 'whole_stated'):
            for child in ast.walk(ast.Module(body=node.body, type_ignores=[])):
                if isinstance(child, ast.Call) and getattr(child.func, 'attr', None) == 'add':
                    pytest.fail(f'whole_stated guards an addition at line {node.lineno}')


def _parts(construction):
    return [part.strip() for part in (construction or '').split(';')]


def test_caption_never_adds_floating_frame():
    result = read_product_type('framed canvas with floating frame canvas artwork')
    assert 'Floating Frame' not in _parts(result.get('product_construction'))


@pytest.mark.parametrize('description, product_type, forbidden', [
    ('framed canvas with floating frame canvas artwork', 'Framed Canvas', 'Floating Frame'),
    ('wall plaque with layered wood look artwork', 'Wall Plaque', 'Layered'),
    ('paperweight with domed glass scene artwork', 'Paperweight', 'Domed'),
    ('wall plaque with laser cut mdf plaque artwork', 'Plaque', 'Laser-Cut'),
    ('storage bin with tapered storage bin artwork', 'Storage Bin', 'Tapered'),
])
def test_construction_rules_ignore_captions(description, product_type, forbidden):
    assert forbidden not in _parts(refine_construction(description, product_type, ""))


def test_material_vocabularies_stay_aligned():
    # reader._MATERIALS marks the product-phrase boundary; material_rules owns the
    # output vocabulary.  Every boundary name must be an output name except PE,
    # which reader uses only to recognise "pe rattan".
    names = [name for name, _ in reader._MATERIALS]
    assert len(names) == len(set(names))
    output = {name for name, _ in material_rules._MATERIALS}
    assert {name for name in names if name not in output} == {'PE'}
    for _, pattern in reader._MATERIALS:
        assert f'(?:{pattern})' in reader._PHYSICAL
