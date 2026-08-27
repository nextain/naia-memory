# Query-identity encrypted oracle checkpoint (2026-08-22)

## Outcome

The query-identity evidence path now supports a launch-bound AES-256-GCM encrypted oracle envelope and a separately persisted release key. Scoring reconstructs the launch receipt and rejects envelope omission, downgrade, or substitution across public, runner-signed, RFC 3161 prediction-timestamped, and escrow-attested paths.

This proves that a disclosed oracle is the same plaintext committed by the launch-bound encrypted envelope. It does **not** prove that the operator lacked the key or plaintext before prediction commitment. This is evidence-infrastructure progress, not a benchmark performance result. Public competitiveness remains **NOT READY**.

## What is verified

- The launch receipt commits to the exact canonical encrypted-envelope SHA-256.
- The envelope commits to the canonical oracle SHA-256 and a SHA-256 commitment to one 32-byte release key.
- AES-256-GCM authentication rejects ciphertext, authentication-tag, key, and envelope substitution.
- Release verification binds the release key to the exact launch-bound envelope and recovers the exact canonical oracle.
- Launch rejects malformed envelope fields and an envelope declaring a different oracle.
- Every scoring tier requires the committed envelope when the launch receipt binds one; reconstructed-receipt equality rejects omission and substitution.
- CLI artifact directories are created with temporary-directory plus atomic rename, reject overwrite, and use directory/file modes 0700/0600.

The emitted assurance is deliberately named `launch-bound-encrypted-oracle-consistency`. It keeps `oracleKeyWithholdingVerified: false`.

## What is not verified

- The release key or plaintext oracle was inaccessible to the benchmark operator before prediction commitment.
- Key deletion, retention policy, threshold custody, or hardware-backed non-exportability.
- Organizational independence or non-collusion of an escrow/runner.
- An independently witnessed release time.
- External execution, reproduction, multilingual quality, or superiority over global memory engines.

Encryption alone cannot establish these claims when the same operator creates both plaintext and key. The next protocol must move key custody and release authority outside the benchmark operator's control.

## Attack matrix

| Attack | Result | Enforcement |
| --- | --- | --- |
| Replace envelope after launch | Rejected | launch-receipt reconstruction hash mismatch |
| Omit a launch-bound envelope at scoring | Rejected | reconstructed receipt differs |
| Supply envelope for a non-envelope launch | Ignored; no assurance upgrade | receipt controls reconstruction |
| Replace release key | Rejected | envelope binding and key commitment |
| Modify ciphertext or authentication tag | Rejected | AES-GCM authentication |
| Change declared oracle hash | Rejected at launch or release | launch oracle binding and canonical plaintext hash |
| Use malformed IV/tag/base64 | Rejected at launch | structural validator |
| Withhold the key indefinitely | **Not prevented** | requires external custody/release SLA |

## Adversarial review

The first scoped OpenCode/DeepSeek V4 Pro review found two high-severity integration defects: the launch command did not persist the committed envelope, and scoring CLIs could not propagate it. Both were fixed. A subsequent review found that malformed envelopes could be committed and fail only at reveal; launch-time structural validation was added. The final review exposed one public API type omission in the timestamped path; it was fixed and inherited by the escrow path.

After these fixes, the final scoped review returned **CLEAN** for binding propagation, downgrade/substitution resistance, claim boundaries, and atomic persistence. During review, a suspected missing direct envelope-hash comparison was traced through the full receipt-reconstruction check and found not exploitable. Recovery mode prevents claiming a formal `review-pass` CLEAN; this is only a scoped OpenCode adversarial verdict.

## Deterministic verification

- Biome: pass for six changed source/test files.
- TypeScript typecheck: pass for library and benchmark configurations.
- Vitest: **108 files, 924 tests passed**.
- Tests include key/envelope/ciphertext/tag/commitment attacks, malformed launch input, CLI release recovery, atomic persistence, and overwrite rejection.

## Long-running public-scale evidence

The CPU-only MIRACL Korean full-corpus run remains alive and untouched at this checkpoint: 1,486,752 documents, 213 queries, exact top-100, Qdrant collection `naia_miracl_ko_74295271_777d3b92`. It is not yet a result and must not be cited as performance evidence until completion and artifact validation.

## Next gate

1. Place the release key under an independent escrow, threshold service, or non-exportable KMS policy that the benchmark operator cannot bypass.
2. Externally timestamp the envelope and launch receipt before predictions, then externally timestamp predictions before key release.
3. Publish complete artifacts and have a separate runner reproduce release verification and scoring.
4. Apply the same protocol to preregistered native-reviewed Korean, English, and Japanese suites and all selected global comparison engines.

Only the resulting independently reproducible measurements can support an outward-facing competitiveness report. This checkpoint makes those measurements harder to manipulate; it does not substitute for them.
