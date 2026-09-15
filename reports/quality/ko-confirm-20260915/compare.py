"""Paired before/after fact-state comparison for the confirmation set, version 2.

Primary: the six construction families predicted by mechanism (category
identity rule: new/stable, new/deadline, preferences/coexist; deletion rules:
delete/forget, project_isolation/delete_one, delete/cancel_one; same-episode
rule: delete/cancel_one). The families are fixed by mechanism, not chosen from
results; delete/cancel_one got worse on the first held-out set and is included.
Test: paired sign-flip permutation on case-error differences within the
target subset (swapping before/after labels inside each case), one-sided for a
decrease, seed 20260915, 10,000 permutations. p < 0.05 -> "improvement
observed", otherwise "no difference shown".
Secondary: all cases, construction-family cluster bootstrap as in the first held-out set.
Hard condition: after wrong_archive = 0.
Usage: python3 compare.py <before capture.jsonl> <after capture.jsonl> <design dir>
"""
import json, random, sys
from pathlib import Path
from factstate import run

SEED, N = 20260915, 10_000
TARGET = ("memory-new-stable", "memory-new-deadline", "memory-preferences-coexist", "memory-delete-forget", "memory-project_isolation-delete_one", "memory-delete-cancel_one")
ERROR_CLASSES = ("wrong_supersession", "deletion_not_applied", "wrong_archive")
REPORT = ERROR_CLASSES + ("not_superseded", "deletion_applied", "deletion_by_supersession", "obsolete_not_stored", "unmatched")

def err(j):
    return int(any(j.get(k) for k in ERROR_CLASSES))

def sign_flip(diffs):
    observed = sum(diffs)
    rng = random.Random(SEED)
    nonzero = [d for d in diffs if d]
    hits = sum(1 for _ in range(N) if sum(d if rng.random() < 0.5 else -d for d in nonzero) <= observed)
    return observed, (hits + 1) / (N + 1)

def cluster_bootstrap(by_family):
    fams = sorted(by_family); rng = random.Random(SEED); totals = []
    for _ in range(N):
        totals.append(sum(sum(by_family[f]) for f in (rng.choice(fams) for _ in fams)))
    totals.sort()
    return {"lower": totals[int(0.025 * N)], "upper": totals[int(0.975 * N) - 1]}

def main(before_capture, after_capture, design_dir):
    design = Path(design_dir)
    family = {c["id"]: c["construction_family"] for c in json.loads((design / "memory-inputs.json").read_text())["cases"]}
    assert set(TARGET) <= set(family.values()), "target families missing from design"
    gold = str(design / "memory-gold.json")
    out = {"seed": SEED, "n": N, "target_families": TARGET, "paths": {}}
    for arm in ("naia", "naia-llm-filter"):
        before, after = run(before_capture, gold, arm), run(after_capture, gold, arm)
        assert set(before) == set(after) == set(family)
        target_cases = sorted(c for c in family if family[c] in TARGET)
        diffs = [err(after[c]) - err(before[c]) for c in target_cases]
        observed, p = sign_flip(diffs)
        by_family = {}
        for c in family:
            by_family.setdefault(family[c], []).append(err(after[c]) - err(before[c]))
        counts = {side: {k: sum(1 for j in res.values() if j.get(k)) for k in REPORT} | {"case_error": sum(err(j) for j in res.values()), "target_case_error": sum(err(res[c]) for c in target_cases)} for side, res in (("before", before), ("after", after))}
        out["paths"][arm] = {
            "primary": {"target_cases": len(target_cases), "difference": observed, "p_one_sided": p, "wording": "improvement observed" if p < 0.05 else "no difference shown"},
            "secondary_all_cases": {"difference": counts["after"]["case_error"] - counts["before"]["case_error"], "cluster_interval_95": cluster_bootstrap(by_family)},
            "hard_condition_after_wrong_archive_zero": counts["after"]["wrong_archive"] == 0,
            "counts": counts,
            "by_family": {f: {"before": sum(err(before[c]) for c in family if family[c] == f), "after": sum(err(after[c]) for c in family if family[c] == f)} for f in sorted(by_family)},
            "changed_cases": {c: {"before": before[c], "after": after[c]} for c in sorted(family) if before[c] != after[c]},
        }
    print(json.dumps(out, ensure_ascii=False, indent=1))

if __name__ == "__main__":
    main(*sys.argv[1:])
