"""Lists every retired fact in the sealed az2/az3 naia captures, no provider calls.

For each case: gold propositions, each superseded or archived fact, the fact
that replaced it, and both facts' structured fields from the same run's sealed
extraction response (matched by content string). Correctness is judged by a
person from this listing; gold source_event_ids include distractor turns, so
they cannot label retirements mechanically. Run from this directory.
"""
import json

DESIGN = "../remaining-plan-20260905/design"
gold = {c["case_id"]: c for c in json.load(open(f"{DESIGN}/memory-gold.json"))["cases"]}
inputs = {c["id"]: c for c in json.load(open(f"{DESIGN}/memory-inputs.json"))["cases"]}

for run in ("az2", "az3"):
    ext = {}
    for line in open(f"../candidate-{run}-20260915/run/capture-raw-provider.jsonl"):
        r = json.loads(line)
        if r["operation"] != "extraction" or r["status"] != 200:
            continue
        content = json.loads(json.loads(r["responseText"])["choices"][0]["message"]["content"])
        for episode, facts in content.items():
            for f in facts:
                if isinstance(f, dict):
                    ext[(r["caseId"], f["content"])] = (episode, f.get("operation"), f.get("structured") or {})
    print(f"===== {run}")
    seen = set()
    for line in open(f"../candidate-{run}-20260915/run/capture.jsonl"):
        r = json.loads(line)
        if r["arm"] != "naia" or r["caseId"] in seen:
            continue
        seen.add(r["caseId"])
        facts = (r.get("activeState") or {}).get("facts", [])
        retired = [f for f in facts if f["status"] in ("superseded", "archived")]
        if not retired:
            continue
        print(f"# {r['caseId']} ({inputs[r['caseId']]['category']}) gold:", [(p["status"], p["text"]) for p in gold[r["caseId"]]["propositions"]])
        def describe(text):
            e = ext.get((r["caseId"], text))
            if not e:
                return f"{text} [structure unavailable]"
            s = e[2]
            return f"{text} [ep{e[0]} {e[1]} {s.get('propertyId')}|{s.get('property')}|{s.get('value')}|{s.get('cardinality')}|{s.get('polarity')}]"
        for f in retired:
            successors = [x["content"] for x in facts if x.get("supersedes") == f["id"]]
            print(f"   {f['status']:10} {describe(f['content'])}")
            print(f"   {'  replaced by':10} {describe(successors[0]) if successors else '-'}")
