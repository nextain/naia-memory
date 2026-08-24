import { createHash } from "node:crypto";
import { linkSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { MIRACL_EN_PREFLIGHT_RETRIEVAL_QUERIES } from "./miracl-en-primary-execution-policy.js";
import type { EnglishPreflightPassage } from "./miracl-en-primary-preflight.js";
import {
	MIRACL_EN_PREFLIGHT_PER_STRATUM,
	MIRACL_EN_PREFLIGHT_SAMPLE_SEED,
	MIRACL_EN_PREFLIGHT_STRATA,
	compareCanonicalText,
	englishPreflightStratumFor,
} from "./miracl-en-primary-sampling-contract.js";
import { MIRACL_MULTILINGUAL_CONTRACT } from "./miracl-multilingual-contract.js";
import type { NativeCorpusScanReceipt } from "./native-corpus-extract.js";
import type { NativeRuntimeSourceManifest } from "./native-runtime-source-manifest.js";
import { validateNativeRuntimeSourceManifest } from "./native-runtime-source-manifest.js";
import { parseQrelsTsv, parseTopicsTsv } from "./public-miracl-source.js";

export interface MiraclEnPrimarySampleReceipt {
	schemaVersion: 1;
	artifactClass: "miracl-en-primary-source-derived-sample-v1";
	claimBoundary: string;
	sourceLockSha256: string;
	corpus: NativeCorpusScanReceipt;
	inputs: {
		topicsSha256: string;
		qrelsSha256: string;
	};
	sample: {
		method: "sha256-seeded-length-stratified-ordinal-v1";
		seed: typeof MIRACL_EN_PREFLIGHT_SAMPLE_SEED;
		passages: EnglishPreflightPassage[];
		passagesSha256: string;
	};
	queries: {
		method: "sha256-seeded-topic-id-v1";
		seed: typeof MIRACL_EN_PREFLIGHT_SAMPLE_SEED;
		ids: string[];
		idsSha256: string;
		relevantByQuerySha256: string;
	};
	producerSourceManifest: NativeRuntimeSourceManifest;
}

const sha256 = (value: string | Uint8Array) =>
	createHash("sha256").update(value).digest("hex");

function canonicalPassages(
	passages: readonly EnglishPreflightPassage[],
): string {
	return `${passages
		.map(({ ordinal, docid, content }) =>
			JSON.stringify({ ordinal, docid, content }),
		)
		.join("\n")}\n`;
}

const expectedPassageCount =
	(MIRACL_EN_PREFLIGHT_STRATA.length - 1) * MIRACL_EN_PREFLIGHT_PER_STRATUM;

export function validateMiraclEnPassageStrata(
	passages: readonly EnglishPreflightPassage[],
): void {
	const stratumCounts = Array.from(
		{ length: MIRACL_EN_PREFLIGHT_STRATA.length - 1 },
		() => 0,
	);
	for (const passage of passages) {
		const stratum = englishPreflightStratumFor(
			Buffer.byteLength(passage.content, "utf8"),
		);
		stratumCounts[stratum] = (stratumCounts[stratum] ?? 0) + 1;
	}
	if (stratumCounts.some((count) => count !== MIRACL_EN_PREFLIGHT_PER_STRATUM))
		throw new Error("English source-derived passage strata are inconsistent");
}

export function selectMiraclEnPreflightQueryIds(
	topicsText: string,
	qrelsText: string,
): string[] {
	const topics = parseTopicsTsv(topicsText);
	const qrels = parseQrelsTsv(qrelsText);
	if (
		topics.size !== MIRACL_MULTILINGUAL_CONTRACT.en.topics.queryCount ||
		[...topics.keys()].some((id) => !qrels.has(id))
	)
		throw new Error("locked English topics/qrels query set mismatch");
	return [...topics.keys()]
		.sort((left, right) => {
			const leftRank = sha256(`${MIRACL_EN_PREFLIGHT_SAMPLE_SEED}\0${left}`);
			const rightRank = sha256(`${MIRACL_EN_PREFLIGHT_SAMPLE_SEED}\0${right}`);
			return (
				compareCanonicalText(leftRank, rightRank) ||
				compareCanonicalText(left, right)
			);
		})
		.slice(0, MIRACL_EN_PREFLIGHT_RETRIEVAL_QUERIES)
		.sort(compareCanonicalText);
}

export function miraclEnSelectedQrelsSha256(
	qrelsText: string,
	queryIds: readonly string[],
): string {
	const qrels = parseQrelsTsv(qrelsText);
	const rows = queryIds.map((queryId) => {
		const docids = qrels.get(queryId);
		if (!docids || docids.length === 0)
			throw new Error(`locked English qrels missing query ${queryId}`);
		return [queryId, [...new Set(docids)].sort(compareCanonicalText)] as const;
	});
	return sha256(`${JSON.stringify(rows)}\n`);
}

export function buildMiraclEnPrimarySampleReceipt(input: {
	sourceLockSha256: string;
	scan: NativeCorpusScanReceipt;
	topicsBytes: Uint8Array;
	qrelsBytes: Uint8Array;
	passages: readonly EnglishPreflightPassage[];
	producerSourceManifest: NativeRuntimeSourceManifest;
}): MiraclEnPrimarySampleReceipt {
	const contract = MIRACL_MULTILINGUAL_CONTRACT.en;
	if (
		input.sourceLockSha256 !== contract.corpus.expectedSourceLockSha256 ||
		input.scan.documentCount !== contract.corpus.expectedDocumentCount ||
		input.scan.docidsSha256 !== contract.corpus.expectedDocidsSha256 ||
		input.scan.compressedShardCount !== contract.corpus.shardCount ||
		input.scan.duplicateDocidCount !== 0
	)
		throw new Error("English corpus scan does not match the locked identity");
	if (
		sha256(input.topicsBytes) !== contract.topics.sha256 ||
		input.topicsBytes.byteLength !== contract.topics.size ||
		sha256(input.qrelsBytes) !== contract.qrels.sha256 ||
		input.qrelsBytes.byteLength !== contract.qrels.size
	)
		throw new Error("English topics/qrels bytes do not match the lock");
	if (input.passages.length !== expectedPassageCount)
		throw new Error("English source-derived passage sample count mismatch");
	const ordered = [...input.passages].sort(
		(left, right) => left.ordinal - right.ordinal,
	);
	if (canonicalPassages(ordered) !== canonicalPassages(input.passages))
		throw new Error("English source-derived passages are not ordinal ordered");
	validateNativeRuntimeSourceManifest(input.producerSourceManifest);
	const topicsText = new TextDecoder("utf-8", { fatal: true }).decode(
		input.topicsBytes,
	);
	const qrelsText = new TextDecoder("utf-8", { fatal: true }).decode(
		input.qrelsBytes,
	);
	const queryIds = selectMiraclEnPreflightQueryIds(topicsText, qrelsText);
	const receipt: MiraclEnPrimarySampleReceipt = {
		schemaVersion: 1,
		artifactClass: "miracl-en-primary-source-derived-sample-v1",
		claimBoundary:
			"Input provenance only; this receipt contains no embedding-quality, retrieval-quality, throughput, equivalence, multilingual-transfer, or public-comparison claim.",
		sourceLockSha256: input.sourceLockSha256,
		corpus: input.scan,
		inputs: {
			topicsSha256: sha256(input.topicsBytes),
			qrelsSha256: sha256(input.qrelsBytes),
		},
		sample: {
			method: "sha256-seeded-length-stratified-ordinal-v1",
			seed: MIRACL_EN_PREFLIGHT_SAMPLE_SEED,
			passages: ordered,
			passagesSha256: sha256(canonicalPassages(ordered)),
		},
		queries: {
			method: "sha256-seeded-topic-id-v1",
			seed: MIRACL_EN_PREFLIGHT_SAMPLE_SEED,
			ids: queryIds,
			idsSha256: sha256(`${queryIds.join("\n")}\n`),
			relevantByQuerySha256: miraclEnSelectedQrelsSha256(qrelsText, queryIds),
		},
		producerSourceManifest: input.producerSourceManifest,
	};
	validateMiraclEnPrimarySampleReceipt(receipt);
	return receipt;
}

export function canonicalMiraclEnPrimarySampleReceipt(
	receipt: MiraclEnPrimarySampleReceipt,
): string {
	return `${JSON.stringify(receipt, null, 2)}\n`;
}

export function validateMiraclEnPrimarySampleReceipt(
	value: unknown,
): asserts value is MiraclEnPrimarySampleReceipt {
	if (typeof value !== "object" || value === null)
		throw new Error("English source-derived sample receipt is not an object");
	const receipt = value as Partial<MiraclEnPrimarySampleReceipt>;
	const contract = MIRACL_MULTILINGUAL_CONTRACT.en;
	if (
		receipt.schemaVersion !== 1 ||
		receipt.artifactClass !== "miracl-en-primary-source-derived-sample-v1" ||
		receipt.sourceLockSha256 !== contract.corpus.expectedSourceLockSha256 ||
		receipt.corpus?.documentCount !== contract.corpus.expectedDocumentCount ||
		receipt.corpus.docidsSha256 !== contract.corpus.expectedDocidsSha256 ||
		receipt.corpus.compressedShardCount !== contract.corpus.shardCount ||
		receipt.corpus.duplicateDocidCount !== 0 ||
		receipt.inputs?.topicsSha256 !== contract.topics.sha256 ||
		receipt.inputs.qrelsSha256 !== contract.qrels.sha256 ||
		receipt.sample?.method !== "sha256-seeded-length-stratified-ordinal-v1" ||
		receipt.sample.seed !== MIRACL_EN_PREFLIGHT_SAMPLE_SEED ||
		receipt.sample.passages?.length !== expectedPassageCount ||
		receipt.queries?.method !== "sha256-seeded-topic-id-v1" ||
		receipt.queries.seed !== MIRACL_EN_PREFLIGHT_SAMPLE_SEED ||
		receipt.queries.ids?.length !== MIRACL_EN_PREFLIGHT_RETRIEVAL_QUERIES ||
		!receipt.queries.relevantByQuerySha256 ||
		!receipt.producerSourceManifest
	)
		throw new Error("English source-derived sample receipt shape mismatch");
	const passages = receipt.sample.passages;
	if (
		passages.some(
			(passage, index) =>
				!Number.isSafeInteger(passage.ordinal) ||
				passage.ordinal < 0 ||
				!passage.docid ||
				typeof passage.content !== "string" ||
				(index > 0 && passage.ordinal <= (passages[index - 1]?.ordinal ?? -1)),
		) ||
		new Set(passages.map(({ docid }) => docid)).size !== passages.length ||
		receipt.sample.passagesSha256 !== sha256(canonicalPassages(passages))
	)
		throw new Error("English source-derived passage sample is inconsistent");
	validateMiraclEnPassageStrata(passages);
	const queryIds = receipt.queries.ids;
	if (
		new Set(queryIds).size !== queryIds.length ||
		queryIds.some((id, index) =>
			index > 0 ? id <= (queryIds[index - 1] ?? "") : !id,
		) ||
		receipt.queries.idsSha256 !== sha256(`${queryIds.join("\n")}\n`)
	)
		throw new Error("English source-derived query sample is inconsistent");
	if (!/^[a-f0-9]{64}$/u.test(receipt.queries.relevantByQuerySha256))
		throw new Error("English source-derived qrels digest is inconsistent");
	validateNativeRuntimeSourceManifest(receipt.producerSourceManifest);
}

export function publishMiraclEnPrimarySampleReceipt(
	output: string,
	receipt: MiraclEnPrimarySampleReceipt,
): void {
	mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
	const temporary = `${output}.${process.pid}.tmp`;
	let temporaryCreated = false;
	try {
		writeFileSync(temporary, canonicalMiraclEnPrimarySampleReceipt(receipt), {
			flag: "wx",
			mode: 0o600,
		});
		temporaryCreated = true;
		linkSync(temporary, output);
	} finally {
		if (temporaryCreated) rmSync(temporary, { force: true });
	}
}
