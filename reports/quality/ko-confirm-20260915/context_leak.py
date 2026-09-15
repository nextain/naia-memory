"""Context-level deletion leak (no model): does the supplied recall context of a
latest-mode row still contain a value the user asked to delete?

For forget and delete_one cases the values to delete are the gold
obsolete_values. cancel_one is excluded: its cancellation utterance names the
cancelled item, so the value is legitimately in context. A row leaks in context when
its supplied context text contains one of them after whitespace/quote
normalisation. Answer-level leakage is judged separately.
Usage: python3 context_leak.py <design dir> <label=capture.jsonl> [...]
"""
import json, re, sys
from pathlib import Path

def norm(s):
    return re.sub(r"[\s'\"‘’“”「」『』]", "", str(s)).lower()

def main(design, *runs):
    design = Path(design)
    inputs = {c["id"]: c for c in json.loads((design / "memory-inputs.json").read_text())["cases"]}
    gold = {c["case_id"]: c for c in json.loads((design / "memory-gold.json").read_text())["cases"]}
    targets = {cid for cid, g in gold.items() if g["values"]["variant"] in ("forget", "delete_one")}
    modes = {(c["id"], q["id"]): q.get("mode", "latest") for c in inputs.values() for q in c["queries"]}
    out = {}
    for spec in runs:
        label, path = spec.split("=", 1)
        per_arm = {}
        for line in open(path):
            r = json.loads(line)
            if r["caseId"] not in targets or modes[(r["caseId"], r["queryId"])] != "latest" or r["queryId"] != "q1":
                continue
            values = gold[r["caseId"]]["values"]["obsolete_values"]
            ctx = norm(r.get("contextText", ""))
            leak = any(norm(v) and norm(v) in ctx for v in values)
            arm = per_arm.setdefault(r["arm"], {"rows": 0, "context_leak": 0, "cases": []})
            arm["rows"] += 1
            if leak:
                arm["context_leak"] += 1
                arm["cases"].append(r["caseId"])
        out[label] = per_arm
    print(json.dumps(out, ensure_ascii=False, indent=1))

if __name__ == "__main__":
    main(*sys.argv[1:])
