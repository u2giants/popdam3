"""Source-evidenced distinctions among physical storage forms.

This module receives the already selected product type and only refines an
explicit, contiguous physical phrase. Other title nouns, including artwork or
identity words, cannot supply a storage form.
"""

from __future__ import annotations

import re


_CANVAS_EVA_BIN = re.compile(r"\bcanvas (?:w|with) eva bins?\b")


def refine_storage_type(text: str, product_type: str) -> str:
    """Refine a selected type when a contiguous physical storage noun proves it."""
    if product_type == "Canvas" and _CANVAS_EVA_BIN.search(text):
        return "Storage Bin"
    return product_type
