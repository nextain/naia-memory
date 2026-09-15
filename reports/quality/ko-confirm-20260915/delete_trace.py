"""Per-case delete decisions and context leak (observation, no model).

For every forget, delete_one and cancel_one case, prints the naia arm's delete
decisions from the consolidation trace (where each delete stopped), whether the
latest-mode q1 context still contains an obsolete value, and how many values
were masked in that context.
Usage: python3 delete_trace.py <design dir> <capture.jsonl> [arm]
"""
import json, re, sys
from pathlib import Path

MARKER = "[deleted]"

def norm(s):
    return re.sub(r"[\s'\"‘’“”「」『』]", "", str(s)).lower()

def main(design, capture, arm="naia"):
    design = Path(design)
    gold = {c["case_id"]: c for c in json.loads((design / "memory-gold.json").read_text())["cases"]}
    variants = {cid: g["values"]["variant"] for cid, g in gold.items()}
    targets = {cid for cid, v in variants.items() if v in ("forget", "delete_one", "cancel_one")}
    rows = {}
    for line in open(capture):
        r = json.loads(line)
        if r["arm"] == arm and r["caseId"] in targets:
            rows.setdefault(r["caseId"], []).append(r)
    totals = {}
    for cid in sorted(rows):
        variant = variants[cid]
        q1 = next((r for r in rows[cid] if r["queryId"] == "q1"), None)
        trace = next((r.get("trace") for r in rows[cid] if r.get("trace")), None) or {}
        decisions = (trace.get("consolidation") or {}).get("deleteDecisions")
        ctx = q1.get("contextText", "") if q1 else ""
        values = gold[cid]["values"]["obsolete_values"]
        leak = any(norm(v) and norm(v) in norm(ctx) for v in values)
        summary = "no-trace" if decisions is None else ",".join(
            f"{d['outcome']}:{'+'.join(d['reasons'])}" for d in decisions) or "no-delete-op"
        t = totals.setdefault(variant, {"cases": 0, "leak": 0, "masked_rows": 0, "stops": {}})
        t["cases"] += 1
        t["leak"] += int(leak and variant != "cancel_one")
        t["masked_rows"] += int(MARKER in ctx)
        t["stops"][summary] = t["stops"].get(summary, 0) + 1
        print(f"{cid}\t{variant}\tleak={int(leak)}\tmasked={ctx.count(MARKER)}\t{summary}")
    print(json.dumps(totals, ensure_ascii=False, indent=1))

if __name__ == "__main__":
    main(*sys.argv[1:])
