# Public Evidence Promotion Gate — 2026-08-18

## Decision

**NOT PUBLIC-READY.** The current multilingual v3 result remains a generated diagnostic, not a publishable global comparison. Its 100% oracle score and 64.8% natural hit@1 are useful for locating retrieval headroom, but they do not establish a market-leading claim.

## What changed

A fail-closed promotion gate now prevents diagnostic results from being presented as public benchmark evidence. Promotion requires:

- a pre-run-sealed, independently authored held-out set with at least 30 Korean, English, and Japanese cases;
- separate native reviewer identities and no author/reviewer overlap;
- one Naia arm and at least two distinct external implementation families;
- the same dataset hash, frozen protocol, answer model, judge model, top-k, repetitions, and primary metric;
- distinct byte-verified receipts with revisions, provider/model identities, latency, cost, failures, and 95% confidence intervals;
- an independent adversarial review bound to the sealed evidence scope.

The file verifier fails closed on malformed manifests, unreadable roots, traversal, symlink escape, and content-hash mismatch.

## Adversarial review

The first OpenCode pass found concrete false-promotion paths: Naia aliases could fill competitor slots, receipts could be duplicated, and incomparable metrics could be accepted. The contract was tightened with unique implementation families, unique receipt hashes, and a frozen common metric. Two subsequent independent OpenCode passes returned `CLEAN`. A final low-risk whitespace identity ambiguity was also normalized and regression-tested.

## Trust boundary

Artifact hashes prove byte integrity, not that a claimed person is a native speaker or organizationally independent. Public release still requires externally attestable reviewer identity or a signed review workflow. The gate deliberately does not convert self-declared identities into cryptographic proof.

## Current blockers and next evidence run

1. Commission an independently authored and sealed multilingual set; Naia contributors must not see evaluation answers before freezing.
2. Obtain native Korean, English, and Japanese review with attestable, disjoint identities.
3. Execute Naia, Hindsight, and at least one additional runnable external memory engine under exactly one frozen protocol.
4. Produce per-engine receipts, repeated-run confidence intervals, cost, latency, failure counts, and an independent adversarial review.
5. Publish only if the promotion gate passes and the claimed advantage survives confidence intervals and ablations.

This gate makes the next result harder to overfit or overstate; it does not itself improve retrieval performance.
