# Reaction signal (first-class emotion/importance on encode)

`MemoryInput.emotion` / `MemoryInput.importance` (and the same on
`MemoryProviderInput`) let a caller mark a memory as emotionally reacted-to at
encode time, overriding the keyword-heuristic score.

## Semantics (⚠ read before using)
- **`emotion` = VALENCE in [0,1], 0.5 = neutral, 0 = very negative, 1 = very
  positive.** It is NOT intensity. A grief reaction ≈ 0.05, a triumph ≈ 0.95, a
  mundane note = 0.5.
- The "how strongly reacted-to" quantity is **arousal = |emotion − 0.5| × 2**.
  Arousal drives `utility` (= `importance*0.5 + surprise*0.2 + arousal*0.3`,
  `importance.ts`), which becomes `Episode.strength` and, via the fact
  extractors, `Fact.importance`. So a strongly-reacted memory (either valence)
  gets a higher recall rank through the `strength × 0.3` term.
- **Flashbulb** (`Fact.maxEmotion >= 0.8` → +0.5 recall boost, `LocalAdapter`)
  fires on emotional **AROUSAL** in EITHER valence (`|emotion-0.5|*2 >= 0.6`,
  the symmetric form of the previous positive-only 0.8 valence cut) — so strong
  *negative* reactions (grief) flashbulb too, and positive behavior is unchanged.
  Implemented in `adapters/local.ts` (LocalAdapter, the default path; SqliteAdapter
  parity is a separate gap). Default 0.5 (neutral) when maxEmotion absent.

## Propagation (encode → recall)
`MemorySystem.encode` override → `Episode.importance.{emotion,importance,utility}`
→ both fact extractors carry it forward (`index.ts` heuristic `maxEmotion:
ep.importance.emotion`; `llm-fact-extractor.ts` same) → `Fact.maxEmotion` +
`Fact.importance` → recall ranking (`strength*0.3` + flashbulb) →
`NaiaMemoryProvider.recall` exposes `metadata.emotion` for consumers.

## Guards & invariants
- `emotion`/`importance` are guarded with `Number.isFinite` — `null`/`NaN` (from
  JSON) are treated as NO signal, not max-arousal.
- When `disableImportanceGating` is set, the override preserves the equal-weight
  invariant (`utility = 1.0`) rather than recomputing.
- Absent fields → the keyword heuristic runs unchanged (backward-compatible).

## ⚠ This is MATERIAL, not a behavior filter
The reaction signal (and `recall`'s `metadata.emotion`) provide **what surfaces
and how strongly** — the raw material for cognition. They must NOT be turned
into a rule that FORCES "appropriate" behavior (suppress this, always say that).
Deciding whether/how to use a recalled memory is the agent's emergent thinking,
and its output legitimately varies (warm, blunt, occasionally off). A filter
that enforces one "correct" behavior is itself a bias.
SoT: `naia-agent/.agents/context/naia-behavior-emergent-not-filtered.md`.

Feature added 2026-07-06 (session ed6b7ccc). Adversarial review corrected an
initial valence-vs-intensity conflation (a caller/bench that tags intensity into
the valence field inverts arousal for near-neutral memories) — hence the
semantics note above.
