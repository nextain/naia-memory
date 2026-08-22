# Query identity prior-timestamp launch checkpoint (2026-08-22)

## Outcome

The query-identity evidence path can now prove that the sealed oracle hash existed at a trusted RFC 3161 time before an operator-recorded launch. It cannot yet prove that an independent runner received only the blind packet or that predictions were created after receipt. This checkpoint is therefore evidence hardening, not a public competitiveness result.

## Implemented

- Added an atomic `launch` command that verifies the oracle digest timestamp and emits a blind packet plus a launch receipt.
- Added `score-public`, which reconstructs and validates the oracle, timestamp token, launch receipt, prediction receipt binding, and engine/model binding before scoring.
- Bound prediction artifacts to the exact launch-receipt hash.
- Added explicit evidence assurance fields. Ordinary scores report `scoring-only`; timestamp-backed scores report `oracle-prior-existence-rfc3161` while explicitly setting hidden-packet delivery and prediction chronology verification to false.
- Replaced PID-based temporary output names with random UUIDs.

## Adversarial review

OpenCode headless review attacked oracle substitution, timestamp-token substitution, replay, backdating, verifier injection, output ambiguity, and filesystem races.

- Oracle and timestamp substitution attacks were withdrawn by the reviewer after tracing the structural hash chain: reconstruction binds the supplied oracle, timestamp digest, receipt, and prediction receipt hash.
- Accepted: ordinary and timestamp-backed score outputs needed a machine-readable assurance distinction.
- Accepted: exclusive output temporary names should not depend on process IDs.
- Rejected as a production bypass: the injectable RFC 3161 command runner is a unit-test seam; the executable CLI does not expose it and uses the real OpenSSL verifier. It remains outside the public evidence claim.
- Accepted as a protocol ceiling: RFC 3161 proves prior oracle existence only. Operator launch time and prediction `createdAt` do not establish independent delivery or trusted execution order.

## Verification

- `pnpm test`: 105 files, 914 tests passed.
- `pnpm typecheck`: passed for product and benchmark TypeScript configurations.
- Long-running CPU-only MIRACL full-corpus run remained active and reached 163,840 / 1,486,752 indexed documents during this checkpoint.

## Next gate

Require an independent runner acknowledgment that signs the blind-packet hash, launch-receipt hash, runner identity, and receipt time before execution. Require a separately signed or timestamped prediction artifact after execution. Only that chain can support a claim that the oracle stayed hidden from the evaluated engine and that predictions were sealed after launch.
