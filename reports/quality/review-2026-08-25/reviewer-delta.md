Inspect only these exact files and their current git diff where applicable:

- `src/benchmark/quality/native-full-corpus-evaluation-cli.ts`
- `src/benchmark/quality/native-full-corpus-evaluation-cli.test.ts`
- `src/benchmark/quality/miracl-en-primary-authorization.ts`
- `src/benchmark/quality/miracl-en-primary-authorization.test.ts`
- `src/benchmark/quality/miracl-en-primary-preflight-cli.ts`
- `src/benchmark/quality/miracl-en-primary-preflight-cli.test.ts`
- `src/benchmark/quality/native-full-corpus-evidence.ts`
- `src/benchmark/quality/native-full-corpus-evidence.test.ts`
- `reports/quality/miracl-ar-full-corpus-vector-exact.json`
- `reports/quality/miracl-ar-full-corpus-runtime-observation.json`
- `reports/quality/miracl-ar-full-corpus-launch-receipt-v2.json`

Adversarial questions:

1. Can English primary evaluation reach Qdrant or produce a result without valid
   explicit authorization? Check ordering, environment parsing, replay/staleness,
   source-hash binding, and process-level test realism.
2. Does updating the evaluator source pin genuinely bind evidence to executable
   semantics, or can unrelated edits/stale artifacts pass?
3. Do the Arabic artifacts prove completed retrieval quality without a currently
   live Qdrant completion receipt? Identify the exact defensible claim boundary.
4. Are MIRACL/vector-exact metrics inherently favorable to Naia's product goal?
   State what additional comparator or out-of-domain evidence is required before
   claiming global superiority.
5. Flag implementation defects, missing negative tests, evidence inconsistency,
   benchmark leakage, and the smallest concrete fixes.
