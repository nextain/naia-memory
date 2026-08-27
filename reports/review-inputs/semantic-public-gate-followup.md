Act as a hostile benchmark-publication reviewer. Inspect the current uncommitted
diff in this repository, especially memory-update-contract.ts and its tests,
semantic-public-gate-cli.ts and its tests, and package.json.

The intended public claim gate is deliberately narrower than the base pilot
contract: only independently authored and native-reviewed held-out test cases;
at least 100 test cases; at least 30 in each of Korean, English, and Japanese;
and at least 10 update, delete, and no-update decisions per language. `create`
is outside this semantic update-publication scope. Development and diagnostic
cases must not inflate the floors. A passing implementation test is not a
performance or superiority result.

Try to defeat the gate through category padding, split leakage, author/reviewer
identity overlap, malformed or oversized CLI input, fail-open behavior, and
claim overreach. Verify whether the earlier ambiguity around `create` and the
missing CLI failure-path tests are actually fixed. Distinguish an exploitable
defect from limitations that necessarily require external identities and
signed evidence. Return a concise verdict: COMMIT GO/NO-GO and PUBLIC GO/NO-GO,
followed by actionable findings with exact file locations. Do not modify files.
