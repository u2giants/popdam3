"""Expose the unchanged historical reader to the independent gold evaluator."""
from .legacy import classify_semantic_signature


def read_legacy_product_type(description):
    signature = classify_semantic_signature(description)
    return dict(product_type=signature.physical_product,
                product_construction=signature.construction_shape,
                product_material=signature.material,
                product_treatment=signature.treatment,
                product_type_status={'needs_review': 'unreadable'}.get(signature.status, signature.status),
                product_type_rules_version='legacy-before-phase-a',
                matched_wording=signature.matched_wording)
