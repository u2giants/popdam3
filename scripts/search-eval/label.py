#!/usr/bin/env python3
"""Judge new hits from a private --raw run with each case's stored rule, then write the set back.

Rule hits count as relevant; other hits as irrelevant. Results already judged keep their label, so
picture corrections stand. Needs PGPASSWORD. Usage: label.py <set.json> <raw.json> <out.json>
"""
import json, os, re, subprocess, sys

CONN = "host=aws-1-us-east-1.pooler.supabase.com port=6543 dbname=postgres user=postgres.qsllyeztdwjgirsysgai sslmode=require"
FIELDS = """g.id,g.sku,g.folder_path,g.licensor_name,g.property_name,g.product_category,g.mg01_name,g.mg02_name,
g.mg03_name,g.item_description,g.item_short_description,g.customer,left(g.group_ai_description,300) ai,
(select string_agg(tag,'|') from style_group_tags t where t.style_group_id=g.id and t.status is distinct from 'rejected') tags"""

def groups():
    sql = f"select coalesce(json_agg(t),'[]') from (select {FIELDS} from style_groups g) t"
    return {g["id"]: g for g in json.loads(subprocess.check_output(["psql", CONN, "-At", "-c", sql], text=True))}

def group_text(g):
    return " ".join(str(v or "") for k, v in g.items() if k != "id")

def sg_text(d):
    return " ".join([str(d.get(k) or "") for k in ("licensor", "property", "guide", "path")] + list(d.get("tags") or []))

def main(set_path, raw_path, out_path):
    data = json.load(open(set_path))
    raw = json.load(open(raw_path))["raw"]
    catalog = groups()
    added = 0
    for case in data["cases"]:
        if case.get("expect_empty") or not case.get("truth"):
            continue
        rule = re.compile(case["truth"], re.I)
        for engine in ("dam", "sg_guides", "sg_files"):
            run = raw.get(case["id"], {}).get(engine)
            if not run or engine not in case:
                continue
            judged = case[engine]
            known = set(judged.setdefault("relevant", [])) | set(judged.setdefault("irrelevant", []))
            details = run.get("details") or []
            for index, hit in enumerate(run["hits"]):
                if hit in known:
                    continue
                if engine == "dam":
                    good = hit in catalog and bool(rule.search(catalog[hit]["sku"] if case["kind"] == "code" else group_text(catalog[hit])))
                else:
                    good = index < len(details) and bool(rule.search(sg_text(details[index])))
                judged["relevant" if good else "irrelevant"].append(hit)
                added += 1
    json.dump(data, open(out_path, "w"))
    print(f"judged {added} new hits")

if __name__ == "__main__":
    if "PGPASSWORD" not in os.environ:
        sys.exit("Missing PGPASSWORD")
    main(*sys.argv[1:4])
