# MIRACL Korean native candidate-pool evidence

Date: 2026-08-22 (Asia/Seoul)

Status: candidate construction PASS; Naia effectiveness NOT YET MEASURED;
public-comparison gate NO-GO

## Result

The preregistered Korean diagnostic pool was constructed from the locked
MIRACL v1.0 Korean corpus and two independent full-corpus top-100 runs. All
frozen construction gates passed without changing the preregistration:

- 213 judged development queries, exactly 100 lexical and 100 dense results
  per query
- 20,015 retained documents: 503 judged positives and 19,512 hard negatives
- 21,300 accepted query-source hard-negative assignments
- global unique assignment ratio `0.916056338028169` (gate: at least `0.50`)
- lexical and dense contribution minimum: 50 each for every query
- random filler: 0; duplicate corpus identifiers: 0
- candidate document-list SHA-256:
  `e758692d71d0ab640927f3d9aaad741b88952b22e25707130adfe8e6d903ef08`
- receipt SHA-256:
  `8fd2c5f35d4b2d71fef26a14b159fe46cc95ce68bf2dfcea939a338d663cd64f`

The raw BM25 run SHA-256 is
`517009cac948e05307baf125d0faf176ccf9fde3532acf255b3c7d09e0a5dbb1`;
the raw mContriever run SHA-256 is
`8d1b8a316cd7ff9f652c2c3ed5d9bbcf2ef26e9fb26036e41280f66c2ad5c09f`.
The dense receipt names the Pyserini catalog commit and archive MD5. Its
MS-MARCO-only training independence is explicitly recorded as an upstream
provenance assertion, not as a property verified from model weights by this
code.

## Claim boundary

This is a label-conditioned hard-negative diagnostic. It is not an official
full-corpus MIRACL result and cannot be compared directly with MIRACL
leaderboard scores. The official full-corpus source runs measured recall@100 /
nDCG@10 of `0.8579 / 0.4533` for BM25 and `0.8753 / 0.4829` for mContriever.
Those values qualify the source runs; they are not Naia scores.

The receipt is the commit marker for the artifact pair. A document-list file
without its matching receipt is incomplete and invalid. Per-file rename is
atomic, but the pair is not a filesystem transaction; a hard process kill in
the rename window can leave an orphan document list. The receipt and raw input
hashes detect this state, but they are not a digital signature against an
attacker who can replace every artifact.

## Adversarial review

OpenCode (`deepseek-v4-pro`) performed two focused review rounds. Round one
found two material issues, both fixed and reverified:

1. Qrels accepted generic whitespace instead of the locked tab/Q0 format.
2. Dense training independence could be mistaken for code-verified provenance.

Round two challenged lexical-first overlap handling, hash semantics, and
two-file atomicity. Lexical-first is the preregistered rule: a document already
accepted from lexical deliberately does not count toward dense's 50 unique
contributions. `poolSha256` is explicitly a content hash, while the receipt
binds the corpus, labels, canonical runs, raw runs, and revisions. The
transaction limitation is accepted and disclosed above; it cannot inflate a
score and an absent receipt fails closed.

Claude headless review was attempted but is `NOT_RUN`: the local client is not
authenticated (`Not logged in; run /login`). Recovery mode also prevents a
formal review-pass CLEAN claim.

Verification after fixes: 11 focused tests passed, Biome passed, TypeScript
type-check passed, and CPU-only reconstruction reproduced the same candidate
document-list hash.

## Next gate

Extract the 20,015 locked documents, run Naia's unchanged retrieval path on all
213 Korean queries, and report paired query-level recall/nDCG with uncertainty
against both source runs. No public competitiveness claim is permitted before
that effectiveness result and a separate multilingual validation stage.
