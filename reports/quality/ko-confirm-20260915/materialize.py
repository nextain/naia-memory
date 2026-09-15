"""Materialize the Korean held-out rows into input and gold files.

Mirrors remaining-plan-20260905/design/author_fixtures.py so the runner, rubric
and judge read these cases exactly like the development fixtures. No provider
calls. Writes design/memory-inputs.json, design/memory-gold.json and
design/manifest.sha256.
"""
from pathlib import Path
from datetime import datetime, timezone, timedelta
import hashlib, json

HERE = Path(__file__).resolve().parent
OUT = HERE / "design"
BASE = datetime(2026, 7, 1, 9, tzinfo=timezone.utc)
TAIL = ["기록에 관한 말은 여기까지야.", "이제 다음 질문으로 넘어갈게."]

def iso(day):
    return (BASE + timedelta(days=day)).isoformat().replace("+00:00", "Z")

rows = json.loads((HERE / "rows.json").read_text())
inputs, gold = [], []
per_variant = {}
for n, r in enumerate(rows):
    category, variant, turns = r["category"], r["variant"], r["turns"]
    question, expected, obsolete, second = r["question"], r["expected"], r["obsolete"] or "", r["second"]
    k = per_variant.get(variant, 0); per_variant[variant] = k + 1
    cid = f"memory-ko-{n+1:03}"
    project_a, project_b = f"{cid}-a", f"{cid}-b"
    events = []
    for i, content in enumerate(turns):
        project = project_b if category == "project_isolation" and i == 1 else project_a
        events.append({"id": f"e{i+1}", "operation": "encode", "project": project, "timestamp": iso(i), "message": {"role": "user", "content": content}})
    if k % 2 == 0:
        events.append({"id": "reopen", "operation": "reopen", "timestamp": iso(len(turns))})
    queries = [{"id": "q1", "text": question, "project": project_a, "scope_mode": "strict",
                "mode": "at-time" if variant == "at_time" else "latest", **({"at_timestamp": iso(0)} if variant == "at_time" else {})}]
    if second:
        queries.append({"id": "q2", "text": second[0], "project": project_b if category == "project_isolation" else project_a,
                        "scope_mode": "strict", "mode": "history" if variant == "former" else "latest"})
    props = [{"id": "p1", "text": expected, "status": "deleted_unknown" if variant in ("forget", "delete_one") else "current" if variant != "at_time" else "historical",
              "project": project_a, "source_event_ids": [e["id"] for e in events if e["operation"] == "encode" and e["project"] == project_a], "critical": True}]
    if obsolete:
        props.append({"id": "p_obsolete", "text": obsolete,
                      "status": "deleted" if category == "delete" or variant == "delete_one" else "stale" if category in ("update", "history") else "false_or_foreign",
                      "project": project_a, "source_event_ids": ["e1"] if category != "project_isolation" else ["e2" if variant == "different" else "e1"], "critical": True})
    if second:
        props.append({"id": "p2", "text": second[1], "status": "historical" if variant == "former" else "current",
                      "project": queries[1]["project"], "source_event_ids": ["e1"] if variant == "former" else ["e2"], "critical": True})
    gq = []
    for qi, query in enumerate(queries):
        requires_unknown = qi == 0 and variant in ("forget", "delete_one")
        current_app = query["mode"] == "latest" and not requires_unknown
        forbidden = ["p_obsolete"] if obsolete and (query["mode"] == "latest" or variant == "delete_one") else []
        gq.append({"query_id": query["id"], "expected_answer": expected if qi == 0 else second[1],
                   "required_proposition_ids": ["p1" if qi == 0 else "p2"], "forbidden_proposition_ids": forbidden,
                   "requires_abstention_about_value": requires_unknown,
                   "denominators": {"answer_correctness": True, "current_at_k": current_app,
                      "stale_exposure": query["mode"] == "latest" and category in ("update", "history", "contradiction", "preferences"),
                      "deletion_leakage": category == "delete" or variant == "delete_one",
                      "project_leakage": category == "project_isolation",
                      "false_overwrite": category in ("contradiction", "preferences") or variant == "delete_one",
                      "critical_reversal": category in ("delete", "contradiction") or variant == "delete_one"}})
    if variant == "forget":
        gq[0]["forbidden_value_spans"] = [r["forbidden_value"]]
    if variant == "at_time":
        props[0]["source_event_ids"] = ["e1"]
    inputs.append({"id": cid, "language": "ko", "category": category, "construction_family": f"memory-{category}-{variant}",
                   "events": events, "recent_tail": [{"role": "user", "content": t} for t in TAIL], "queries": queries})
    gold.append({"case_id": cid, "propositions": props, "queries": gq,
                 "values": {"variant": variant, "current_values": r["current_values"], "obsolete_values": r["obsolete_values"], "other_values": r.get("other_values", [])}})

OUT.mkdir(exist_ok=True)
for name, obj in [("memory-inputs.json", inputs), ("memory-gold.json", gold)]:
    (OUT / name).write_text(json.dumps({"schema_version": 1, "cases": obj}, ensure_ascii=False, indent=2) + "\n")
lines = []
for name in ["memory-inputs.json", "memory-gold.json", "rubric.json"]:
    lines.append(f"{hashlib.sha256((OUT / name).read_bytes()).hexdigest()}  {name}")
seal = {"sealed_at": "2026-09-15", "files": {}}
for name in ["AUTHOR-BRIEF.md", "author-receipts.json", "first-set-questions.json", "curation-log-round1.json", "curation-log-2.json", "curation-log-3.json", "curation-log-4-review.json", "curation-log-5.json", "curation-log-6.json", "rows.json", "materialize.py", "factstate.py", "compare.py"]:
    seal["files"][name] = hashlib.sha256((HERE / name).read_bytes()).hexdigest()
for name in ["memory-inputs.json", "memory-gold.json", "rubric.json"]:
    seal["files"]["design/" + name] = hashlib.sha256((OUT / name).read_bytes()).hexdigest()
seal["note"] = "Confirmation set sealed on 2026-09-15 before any result. Row replacements: mechanical checks (curation logs) and reviewer rejections recorded as FORCE_ROWS reasons in curation-log-4-review.json; no hand edits."
seal["regenerated_rows"] = "see review-regeneration-log.json (rounds 1-2, manual review reasons) and curation-log*.json (mechanical check reasons)"
(HERE / "SEAL.json").write_text(json.dumps(seal, indent=1) + "\n")
(OUT / "manifest.sha256").write_text("\n".join(lines) + "\n")
print(len(inputs), "cases,", sum(len(c["queries"]) for c in inputs), "queries")
