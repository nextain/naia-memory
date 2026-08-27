# Graphiti contacted-runtime evidence review — 2026-08-24

Status: **REVIEWED / NOT PUBLIC-QUALIFIED**

This increment does not claim a Naia Memory quality or performance gain. It closes an evidence-integrity gap in the Graphiti comparator lane so later competitive results can be independently rejected when the contacted runtime differs from the declared comparator configuration.

## What is now bound

- Source pin: Graphiti revision, graphiti-core, Gemini models, embedding provider and dimensions, Neo4j driver, and provider adapter distribution.
- Contacted process, before and after each run: installed graphiti-core, Neo4j and google-genai versions; exact qualified Gemini client/embedder classes; active model/provider/dimensions; deployed sidecar hash; server `uv.lock` hash.
- Downstream campaign validation rechecks both contacted identities against the top-level disclosure and rejects execution-time drift. It no longer trusts the `configurationAuthority` label by itself.

Git revision, container image digest, and provider-side embedding revision remain explicitly operator-attested. The running Python process cannot independently derive those values, so they are not represented as server-observed facts.

## Verification

- Clean-clone application at Graphiti `993e081a6d7948a0d8851c12a5fbdbeb49fed862`: both patches applied; `uv lock` and `uv sync --no-dev` succeeded.
- Observed installed runtime: graphiti-core `0.28.2`, Neo4j driver `5.28.1`, google-genai `1.62.0`, exact Graphiti Gemini client/embedder modules.
- Selected deterministic suites: 62/62 passing.
- TypeScript typecheck, Biome, Python compile check, and `git diff --check`: passing.

## Adversarial review

The first review found that execution-time validation was strong but downstream campaign validation could trust the authority label without reconstructing the nested contacted-runtime checks. That finding was accepted and fixed. The unchanged corrected tree then received two independent scoped CLEAN conclusions. Tested attacks included missing or altered before/after identities, class-name substitution, model/dimension/version mismatch, lock/sidecar hash substitution, and execution-time drift.

Repository-wide formal review-pass status remains **NOT_CLEAN** because an unrelated user-owned untracked `.cache/tools/trec_eval-ba38899/` path fails the global preflight. It was preserved and excluded from this work. Accordingly, this document records scoped adversarial evidence and does not claim formal repository-wide CLEAN delivery.

## Competitive meaning

This work raises confidence that future Graphiti comparisons measure the declared comparator. It does not itself establish that Naia Memory is globally superior, nor does it remove the need for fresh, blinded, powered multilingual and lifecycle runs against all declared competitor classes.
