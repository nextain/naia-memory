"""Rule-based fact-state judgement per case (no model), version 2.

Changes from the first held-out set's script (registered before confirmation
results): a fact whose structured value is recorded in the trace lineage is
matched on that value, not on its sentence (a sentence can name both the
cancelled and the kept item); deletion_applied counts archived facts only, and
a value removed by supersession is reported as deletion_by_supersession.

Reads a capture.jsonl and per-case literal values, and classifies the naia
arm's final fact state for each case:
  wrong_supersession   a current value is held only by superseded/archived facts
  not_superseded       an obsolete value is still active in an update/history case
  deletion_not_applied an obsolete value is still active in a delete case
  wrong_archive        a value that must stay (other project, kept booking) is held only by archived facts
  unmatched            a value that must be present appears in no fact (not stored, or surface form differs); not judged
  obsolete_not_stored  (delete variants, report only) the value to delete was never stored as a fact
  deletion_applied     (delete variants) the value to delete is held by an archived fact and by no active fact
  deletion_by_supersession (delete variants, report only) the value to delete is held only by superseded facts
Usage: python3 factstate.py <capture.jsonl> <values.json> [arm]
"""
import json, re, sys
from collections import defaultdict

def norm(s):
    return re.sub(r"[\s'\"‘’“”「」『』.,!?。、]", "", str(s)).lower()

UNITS = {"천": 1000, "만": 10000}

def surface_forms(v):
    """Deterministic alternate spellings extractors are known to produce:
    Korean month-day dates as ISO fragments, and 천/만 amounts as digits."""
    forms = {norm(v)}
    m = re.fullmatch(r"\s*(\d{1,2})월\s*(\d{1,2})일\s*", str(v))
    if m:
        forms.add(f"-{int(m.group(1)):02d}-{int(m.group(2)):02d}")
    m = re.fullmatch(r"\s*(?:월\s*)?(\d+)\s*(천|만)\s*(\d*)\s*(천)?\s*(원)?\s*", str(v))
    if m:
        amount = int(m.group(1)) * UNITS[m.group(2)] + (int(m.group(3)) * 1000 if m.group(3) and m.group(4) else 0)
        forms.update({f"{amount}원", f"{amount:,}원".replace(",", ""), f"{amount:,}", str(amount)})
    return {f for f in forms if f}

def judge(case_id, variant, category, values, facts):
    out = defaultdict(list)
    def holds(fact, v):
        forms = surface_forms(v)
        structured = fact.get("value")
        if structured:
            sv = norm(structured)
            return any(len(form) >= 2 and (form in sv or sv in form) for form in forms)
        return any(form in norm(fact["content"]) for form in forms)
    def holders(v):
        return [f for f in facts if holds(f, v)]
    def only_retired(v):
        h = holders(v)
        return bool(h) and not any(f["status"] == "active" for f in h)
    def active(v):
        return any(f["status"] == "active" for f in holders(v))
    # An obsolete value held by no fact was simply never stored, which is the
    # desired state; only values that must be present can be unmatched.
    for v in values["current_values"] + values.get("other_values", []):
        if not holders(v):
            out["unmatched"].append(v)
    if variant != "at_time":
        for v in values["current_values"]:
            if only_retired(v):
                (out["wrong_archive"] if variant == "cancel_one" and any(f["status"] == "archived" for f in holders(v)) else out["wrong_supersession"]).append(v)
    if category in ("update", "history") and variant != "at_time":
        for v in values["obsolete_values"]:
            if active(v):
                out["not_superseded"].append(v)
    if variant in ("forget", "delete_one", "cancel_one"):
        for v in values["obsolete_values"]:
            held = holders(v)
            if active(v):
                out["deletion_not_applied"].append(v)
            elif any(f["status"] == "archived" for f in held):
                out["deletion_applied"].append(v)
            elif held:
                out["deletion_by_supersession"].append(v)
            else:
                out["obsolete_not_stored"].append(v)
    if variant in ("different", "delete_one"):
        for v in values.get("other_values", []):
            if only_retired(v):
                out["wrong_archive"].append(v)
    return dict(out)

def load_values(path):
    """Accept either a {case_id: values} map or a design memory-gold.json with cases[].values."""
    data = json.load(open(path))
    if isinstance(data, dict) and "cases" in data:
        return {c["case_id"]: c["values"] for c in data["cases"]}
    return data

def run(capture_path, values_path, arm="naia"):
    values = load_values(values_path)
    seen, result = set(), {}
    for line in open(capture_path):
        r = json.loads(line)
        if r["arm"] != arm or r["caseId"] in seen:
            continue
        seen.add(r["caseId"])
        v = values[r["caseId"]]
        category = r.get("family", "").split("-")[1] if r.get("family") else ""
        lineage_values = {f["id"]: f.get("value") for f in ((r.get("trace") or {}).get("lineage") or {}).get("facts", [])}
        facts = [{**f, "value": lineage_values.get(f["id"])} for f in (r.get("activeState") or {}).get("facts", [])]
        result[r["caseId"]] = judge(r["caseId"], v["variant"], category, v, facts)
    return result

if __name__ == "__main__":
    res = run(*sys.argv[1:])
    totals = defaultdict(int)
    for cid, j in res.items():
        for k, vals in j.items():
            totals[k] += 1
    print(json.dumps({"cases": len(res), "cases_with": dict(totals), "detail": {c: j for c, j in res.items() if j}}, ensure_ascii=False, indent=1))
