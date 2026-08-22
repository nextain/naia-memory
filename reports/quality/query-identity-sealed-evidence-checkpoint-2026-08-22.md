# Query identity sealed evidence checkpoint — 2026-08-22

## Outcome

The closed-vocabulary query-identity experiment now has an executable blind-packet and sealed-scoring path. This is infrastructure evidence, not a public competitiveness result: no independently authored Korean, English, and Japanese oracle has been collected or run yet.

## Implemented evidence controls

- The blind packet contains only test case ID, language, and query; expectation and author/reviewer provenance remain in the sealed oracle.
- Canonical SHA-256 binds predictions to one exact oracle and score output to one exact prediction artifact.
- Scoring rejects missing, duplicate, extra, development-split, malformed, or hash-mismatched prediction entries.
- Oracle validation requires independent native author/reviewer identities, accepted review, portable IDs, closed-vocabulary expectations, family-level split isolation, and preregistered per-language coverage.
- Outcomes distinguish correct identity/abstention, valid-but-wrong identity, false positive, unsupported identity, partial pair, invalid output, and missed identity.
- The gate reports per-language point metrics plus Wilson 95% intervals. Unsafe identity emissions are tracked separately.

## Adversarial review

OpenCode headless review was run twice. Accepted findings led to stronger runtime validation, explicit test-double wording, portable identifier constraints, a scoring-policy version, and confidence intervals. The suggestion that opaque case IDs alone preserve secrecy after the oracle is disclosed was rejected: queries themselves permit joining, so trustworthy blinding depends on oracle commitment and prediction sealing order.

The second review found no score-changing bypass. Its remaining observations were either guarded by public-coverage validation or concerned semantically identical JavaScript `undefined` representations that cannot occur in valid JSON.

## Verification

- `pnpm typecheck`: pass
- `pnpm test`: 104 files, 912 tests pass
- Focused query-identity tests: 6 pass

## Evidence still required before publication

1. Collect an oracle from independent native authors and reviewers without Naia-generated labels.
2. Commit or externally timestamp the oracle hash before any engine sees the blind packet.
3. Run Naia and named competitors through the same packet with frozen versions and receipts.
4. Publish the sealed predictions, later disclose the oracle, and reproduce scores from source.
5. Treat Wilson intervals and language-by-language failure classes as the claim boundary; do not promote the unit-test perfect score as benchmark evidence.

The full-corpus MIRACL Korean run remains independent of this checkpoint and was still indexing at 153,600 / 1,486,752 documents when recorded.
