"""Paired before/after comparison of rule-based fact state (registered before results).

For each contradiction-filter path (naia, naia-llm-filter), pairs the two runs
by case and reports per-class counts and the after-minus-before difference in
case-error count with a cluster bootstrap over construction families.
  case error = wrong_supersession or deletion_not_applied or wrong_archive
Usage: python3 compare.py <before capture.jsonl> <after capture.jsonl> <design dir>
"""
import json, random, sys
from pathlib import Path
from factstate import run

SEED, RESAMPLES = 20260915, 10_000
ERROR_CLASSES = ("wrong_supersession", "deletion_not_applied", "wrong_archive")
REPORT_CLASSES = ERROR_CLASSES + ("not_superseded", "deletion_applied", "obsolete_not_stored", "unmatched")

def case_error(judgement):
    return int(any(judgement.get(k) for k in ERROR_CLASSES))

def bootstrap(diffs_by_family):
    families = sorted(diffs_by_family)
    rng = random.Random(SEED)
    totals = []
    for _ in range(RESAMPLES):
        pick = [rng.choice(families) for _ in families]
        totals.append(sum(sum(diffs_by_family[f]) for f in pick))
    totals.sort()
    return {"lower": totals[int(0.025 * RESAMPLES)], "upper": totals[int(0.975 * RESAMPLES) - 1]}

def main(before_capture, after_capture, design_dir):
    design = Path(design_dir)
    inputs = json.loads((design / "memory-inputs.json").read_text())["cases"]
    family = {c["id"]: c["construction_family"] for c in inputs}
    gold_path = str(design / "memory-gold.json")
    out = {"seed": SEED, "resamples": RESAMPLES, "error_classes": ERROR_CLASSES, "paths": {}}
    for arm in ("naia", "naia-llm-filter"):
        before, after = run(before_capture, gold_path, arm), run(after_capture, gold_path, arm)
        assert set(before) == set(after) == set(family), f"case sets differ for {arm}"
        counts = {side: {k: sum(1 for j in res.values() if j.get(k)) for k in REPORT_CLASSES} for side, res in (("before", before), ("after", after))}
        for side, res in (("before", before), ("after", after)):
            counts[side]["case_error"] = sum(case_error(j) for j in res.values())
        diffs = {}
        for cid in family:
            diffs.setdefault(family[cid], []).append(case_error(after[cid]) - case_error(before[cid]))
        by_family = {f: {"before_errors": sum(case_error(before[c]) for c in family if family[c] == f),
                         "after_errors": sum(case_error(after[c]) for c in family if family[c] == f),
                         "deletion_applied_before": sum(1 for c in family if family[c] == f and before[c].get("deletion_applied")),
                         "deletion_applied_after": sum(1 for c in family if family[c] == f and after[c].get("deletion_applied"))} for f in sorted(diffs)}
        interval = bootstrap(diffs)
        diff = counts["after"]["case_error"] - counts["before"]["case_error"]
        wording = "improvement observed" if interval["upper"] < 0 else "worse observed" if interval["lower"] > 0 else "no difference shown"
        out["paths"][arm] = {"counts": counts, "case_error_difference": diff, "cluster_interval_95": interval, "wording": wording,
                             "hard_condition_after_wrong_archive_zero": counts["after"]["wrong_archive"] == 0,
                             "by_family": by_family,
                             "changed_cases": {c: {"before": before[c], "after": after[c]} for c in sorted(family) if before[c] != after[c]}}
    print(json.dumps(out, ensure_ascii=False, indent=1))

if __name__ == "__main__":
    main(*sys.argv[1:])
