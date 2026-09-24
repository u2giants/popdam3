"""Deterministic description reader.

It makes no database call.  Part of its product vocabulary is seeded from the
historical MG-era table in ``legacy.LEGACY_PATTERNS`` (see ``reader.py``).
"""

from .reader import RULES_VERSION, read_product_type

__all__ = ["RULES_VERSION", "read_product_type"]
