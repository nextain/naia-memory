# MIRACL Korean TREC coverage evidence hardening

Date: 2026-08-23 (Asia/Seoul)

## Finding and correction

The final evidence path reproduced aggregate metrics from the hashed TREC run,
but did not independently enforce the frozen run shape. A consistently rehashed
run with missing queries or shallow rankings could reach metric comparison
without first failing the protocol contract.

The verifier now hashes the exact TREC bytes it parses, binds the canonical
topics-file hash carried by the result, requires 213 query rankings, and uses
the existing strict parser and coverage validator to require unique documents,
contiguous ranks, finite scores, and exactly 100 results per query. A regression
test constructs a self-consistent TREC hash after deleting the final query and
confirms rejection.

## Verification and review status

- focused verifier tests: 6 passed;
- full suite: 125 files and 1,023 tests passed;
- TypeScript `--noEmit`, Biome, and `git diff --check`: passed after correction;
- OpenCode read the exact diff and relevant parser implementation, but again
  returned no final verdict before timeout: **PARTIAL / NOT A PASS**.

This is provenance hardening, not a quality gain. It does not change the
pending score or the `publicClaimEligible: false` trust boundary.
