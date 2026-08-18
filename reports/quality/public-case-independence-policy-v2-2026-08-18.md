# Public case independence and shared-ID policy v2

## Outcome

The public evidence intake now rejects duplicated normalized inputs, duplicated answer IDs within a case, answer-ID reuse across cases, and expected/forbidden label contradictions. The deterministic scoring policy is versioned as `exact-current-hit-at-k-v2`; only each frozen case's expected and forbidden labels affect scoring, while unrelated retrieved IDs remain valid distractors.

This is an evidence-integrity improvement, not a retrieval-performance improvement. It prevents a benchmark from presenting many paraphrases of one fact as many independent memory cases, but it does not establish that Naia Memory is better than another engine.

## Adversarial review

The first OpenCode review found that a proposed “at least one returned ID must intersect the answer vocabulary” gate could reject a valid zero-performing competitor and appear Naia-biased. That gate and its tests were removed. A genuinely poor engine remains a valid comparison arm and may score zero.

The corrected contract does not require a vocabulary-intersection admission test. A second OpenCode review returned `PASS-WITH-LIMITATIONS` and identified cross-case answer-ID reuse as the highest remaining publication-integrity bypass. The loader now rejects expected-ID reuse, forbidden-ID reuse, and contradictory labels across cases.

A later OpenCode review challenged wording that claimed a globally shared ID namespace without enforcing a complete ID registry. The wording and output schema were narrowed to the actual deterministic behavior: compare retrieved IDs only with the frozen labels for that case. This avoids both an unenforced claim and a Naia-specific admission rule.

## Language-stratified evidence v7

Manifest schema v7 and receipt schema v4 require a primary metric and confidence interval for every language declared by the signed dataset. The verifier derives language membership from the dataset, recomputes each language metric from per-case receipt records, and rejects missing, extra, malformed, or altered language claims. This prevents a strong aggregate score from concealing a weak language, but does not itself improve multilingual retrieval.

## Verification

- Public quality suite: 8 files, 71 tests passed.
- Full suite: 37 files, 506 tests passed.
- Biome checks passed on the changed files.
- Strict main and benchmark type checks passed.
- Production build passed.
- `git diff --check` passed.
- The engine-vocabulary-intersection gate rejected by adversarial review is absent from the final diff.

## Remaining publication gate

No new public performance claim is authorized. Publication still requires an independently governed Korean/English/Japanese dataset and verifier-challenged, same-input execution receipts from Naia Memory and at least two credible global engines. Each engine's adapter and configuration must be immutable and reproducible so reviewers can verify how native retrieval results become receipt IDs.
