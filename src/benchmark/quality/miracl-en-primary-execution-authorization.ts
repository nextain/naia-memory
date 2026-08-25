import { createHash } from "node:crypto";
import {
	constants,
	closeSync,
	existsSync,
	fstatSync,
	openSync,
	readFileSync,
	readSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	prepareMiraclCorpusIdentityScan,
	readMiraclSourceReceipt,
} from "./miracl-corpus-identity.js";
import {
	MIRACL_EN_PREFLIGHT_RETRIEVAL_QUERIES,
	MIRACL_EN_PRIMARY_EXECUTION,
	MIRACL_EN_PRIMARY_EXPECTED_POLICY_SHA256,
	miraclEnPrimaryExecutionPolicy,
} from "./miracl-en-primary-execution-policy.js";
import {
	type MiraclEnPrimarySampleReceipt,
	MiraclEnPrimarySampleSourceVerifier,
	miraclEnSelectedQrelsSha256,
	miraclEnSelectedRelevantDocidsSha256,
	selectMiraclEnPreflightQueryIds,
	validateMiraclEnPrimarySampleReceipt,
} from "./miracl-en-primary-sample-receipt.js";
import { MIRACL_MULTILINGUAL_CONTRACT } from "./miracl-multilingual-contract.js";
import {
	miraclSourceRoot,
	parseMiraclSourceLockReceipt,
} from "./miracl-multilingual-download.js";
import { scanNativeCorpusDocuments } from "./native-corpus-extract.js";
import { MIRACL_EMBEDDING_POLICY } from "./native-full-corpus-evidence.js";
import {
	type NativeRuntimeSourceManifest,
	validateNativeRuntimeSourceManifest,
	verifyNativeRuntimeSourceManifest,
} from "./native-runtime-source-manifest.js";
import {
	MIRACL_EN_QDRANT_CONTAINER_NAME,
	MIRACL_EN_QDRANT_MINIMUM_FREE_BYTES,
	parseQdrantServiceBindingReceipt,
	qdrantServiceBindingSha256,
} from "./qdrant-service-binding.js";
import { MIRACL_EN_QDRANT_DEFAULT_PORT } from "./qdrant-service-launch-plan.js";

export const MIRACL_EN_PRIMARY_OUTPUT =
	"reports/quality/miracl-en-full-corpus-vector-exact-true-batch.json";
export const MIRACL_EN_PRIMARY_TREC = `${MIRACL_EN_PRIMARY_OUTPUT}.trec`;
export const MIRACL_EN_PRIMARY_CHECKPOINT =
	"/var/mnt/hdd/naia-memory-benchmark/checkpoints/miracl-en-full-primary-batch-v1";
export const MIRACL_EN_PRIMARY_CLAIM_BOUNDARY =
	"one preregistered MIRACL-en execution of the frozen padded-array-batch-v1 passage engine with per-item-v1 queries; establishes no equivalence or noninferiority to per-item passage inference, no throughput claim, no multilingual transfer claim, and no public-comparison eligibility";

interface EnglishPrimaryPreflight {
	schemaVersion?: unknown;
	artifactClass?: unknown;
	verdict?: unknown;
	language?: unknown;
	claimBoundary?: unknown;
	sourceLockSha256?: unknown;
	corpusDocidsSha256?: unknown;
	sample?: {
		method?: unknown;
		seed?: unknown;
		documentCount?: unknown;
		ordinalsSha256?: unknown;
		passagesSha256?: unknown;
		lengthStrata?: unknown;
	};
	execution?: {
		embeddingExecutionPolicySha256?: unknown;
		producerSourceSha256?: unknown;
		producerSourceManifest?: NativeRuntimeSourceManifest;
		vectorArtifactSha256?: unknown;
	};
	checks?: {
		finiteDimensions?: unknown;
		repeatBitIdentical?: unknown;
		orderSensitivityReported?: unknown;
		lengthStratifiedDeltasReported?: unknown;
		retrievalDeltasReported?: unknown;
		throughputReported?: unknown;
	};
	observed?: {
		retrieval?: {
			method?: unknown;
			queryCount?: unknown;
			queryIdsSha256?: unknown;
			relevantByQuerySha256?: unknown;
			corpusPassagesSha256?: unknown;
			rankingArtifactSha256?: unknown;
		};
	};
	claimEligibility?: {
		public?: unknown;
		equivalence?: unknown;
		noninferiority?: unknown;
		throughput?: unknown;
		multilingualTransfer?: unknown;
		sota?: unknown;
	};
}

function canonical(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function canonicalReceipt(
	value: unknown,
	bytes: Uint8Array,
	name: string,
): void {
	if (sha256(bytes) !== sha256(canonical(value)))
		throw new Error(`${name} is not canonical`);
}

function digest(value: unknown, name: string): asserts value is string {
	if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))
		throw new Error(`${name} is not a SHA-256 digest`);
}

export function authorizeMiraclEnPrimaryExecution(input: {
	preflight: EnglishPrimaryPreflight;
	preflightBytes: Uint8Array;
	sampleReceipt: unknown;
	sampleReceiptBytes: Uint8Array;
	sourceReceipt: unknown;
	sourceReceiptBytes: Uint8Array;
	qdrantReceipt: unknown;
	qdrantReceiptBytes: Uint8Array;
	evaluationSourceSha256: string;
	authorizationSourceSha256: string;
	vectorArtifactSha256: string;
}) {
	canonicalReceipt(input.preflight, input.preflightBytes, "English preflight");
	canonicalReceipt(
		input.sampleReceipt,
		input.sampleReceiptBytes,
		"English source-derived sample receipt",
	);
	canonicalReceipt(
		input.sourceReceipt,
		input.sourceReceiptBytes,
		"source receipt",
	);
	canonicalReceipt(
		input.qdrantReceipt,
		input.qdrantReceiptBytes,
		"Qdrant receipt",
	);
	digest(input.evaluationSourceSha256, "evaluation source");
	digest(input.authorizationSourceSha256, "authorization source");
	digest(input.vectorArtifactSha256, "preflight vector artifact file");
	if (!input.preflight.execution?.producerSourceManifest)
		throw new Error("preflight producer source manifest is required");
	validateNativeRuntimeSourceManifest(
		input.preflight.execution.producerSourceManifest,
	);
	const contract = MIRACL_MULTILINGUAL_CONTRACT.en;
	validateMiraclEnPrimarySampleReceipt(input.sampleReceipt);
	const sourceReceipt = parseMiraclSourceLockReceipt("en", input.sourceReceipt);
	const expectedCompressedBytes = sourceReceipt.files
		.slice(2)
		.reduce((total, file) => total + file.size, 0);
	const qdrantReceipt = parseQdrantServiceBindingReceipt(input.qdrantReceipt);
	const policy = miraclEnPrimaryExecutionPolicy(MIRACL_EMBEDDING_POLICY);
	if (
		policy.embeddingExecutionPolicySha256 !==
		MIRACL_EN_PRIMARY_EXPECTED_POLICY_SHA256
	)
		throw new Error("frozen English primary policy digest drifted");
	const qdrantPort = new URL(qdrantReceipt.qdrantUrl).port;
	if (
		qdrantPort !== MIRACL_EN_QDRANT_DEFAULT_PORT ||
		qdrantReceipt.container.name !== MIRACL_EN_QDRANT_CONTAINER_NAME ||
		qdrantReceipt.storage.minimumFreeBytes !==
			MIRACL_EN_QDRANT_MINIMUM_FREE_BYTES ||
		qdrantReceipt.storage.freeBytes < MIRACL_EN_QDRANT_MINIMUM_FREE_BYTES ||
		!qdrantReceipt.storage.hostPath.startsWith("/var/mnt/hdd/") ||
		sourceReceipt.sourceLockSha256 !==
			contract.corpus.expectedSourceLockSha256 ||
		input.sampleReceipt.sourceLockSha256 !== sourceReceipt.sourceLockSha256 ||
		input.sampleReceipt.corpus.compressedBytes !== expectedCompressedBytes ||
		input.preflight.schemaVersion !== 1 ||
		input.preflight.artifactClass !== "miracl-en-primary-preflight-v1" ||
		input.preflight.verdict !== "PASS" ||
		input.preflight.language !== "en" ||
		input.preflight.claimBoundary !== MIRACL_EN_PRIMARY_CLAIM_BOUNDARY ||
		input.preflight.sourceLockSha256 !==
			contract.corpus.expectedSourceLockSha256 ||
		input.preflight.corpusDocidsSha256 !==
			contract.corpus.expectedDocidsSha256 ||
		input.preflight.sample?.method !==
			"sha256-seeded-length-stratified-ordinal-v1" ||
		input.preflight.sample.seed !== "naia-miracl-en-primary-v1" ||
		input.preflight.sample.documentCount !== 8_192 ||
		input.preflight.sample.lengthStrata !== 8 ||
		input.preflight.sample.passagesSha256 !==
			input.sampleReceipt.sample.passagesSha256 ||
		input.preflight.execution?.embeddingExecutionPolicySha256 !==
			policy.embeddingExecutionPolicySha256 ||
		input.preflight.execution.producerSourceSha256 !==
			input.preflight.execution.producerSourceManifest.manifestSha256 ||
		input.preflight.execution.vectorArtifactSha256 !==
			input.vectorArtifactSha256 ||
		input.preflight.checks?.finiteDimensions !== true ||
		input.preflight.checks?.repeatBitIdentical !== true ||
		input.preflight.checks?.orderSensitivityReported !== true ||
		input.preflight.checks?.lengthStratifiedDeltasReported !== true ||
		input.preflight.checks?.retrievalDeltasReported !== true ||
		input.preflight.checks?.throughputReported !== true ||
		input.preflight.observed?.retrieval?.method !==
			"query-ranking-qrels-recomputation-v1" ||
		!Number.isSafeInteger(input.preflight.observed.retrieval.queryCount) ||
		input.preflight.observed.retrieval.queryCount !==
			MIRACL_EN_PREFLIGHT_RETRIEVAL_QUERIES ||
		input.preflight.observed.retrieval.queryIdsSha256 !==
			input.sampleReceipt.queries.idsSha256 ||
		input.preflight.observed.retrieval.relevantByQuerySha256 !==
			input.sampleReceipt.queries.relevantByQuerySha256 ||
		input.preflight.observed.retrieval.corpusPassagesSha256 !==
			input.sampleReceipt.retrievalCorpus.passagesSha256 ||
		input.preflight.claimEligibility?.public !== false ||
		input.preflight.claimEligibility?.equivalence !== false ||
		input.preflight.claimEligibility?.noninferiority !== false ||
		input.preflight.claimEligibility?.throughput !== false ||
		input.preflight.claimEligibility?.multilingualTransfer !== false ||
		input.preflight.claimEligibility?.sota !== false
	)
		throw new Error("qualified English primary preflight PASS is required");
	digest(input.preflight.sample?.ordinalsSha256, "preflight ordinals");
	digest(input.preflight.sample?.passagesSha256, "preflight passages");
	digest(input.preflight.execution?.producerSourceSha256, "preflight producer");
	digest(
		input.preflight.observed?.retrieval?.rankingArtifactSha256,
		"preflight retrieval rankings",
	);
	digest(
		input.preflight.observed?.retrieval?.queryIdsSha256,
		"preflight retrieval query identities",
	);
	digest(
		input.preflight.observed?.retrieval?.relevantByQuerySha256,
		"preflight retrieval qrels",
	);
	digest(
		input.preflight.observed?.retrieval?.corpusPassagesSha256,
		"preflight retrieval corpus",
	);
	return {
		schemaVersion: 1 as const,
		artifactClass: "miracl-en-primary-execution-authorization-v1" as const,
		verdict: "AUTHORIZED" as const,
		language: "en" as const,
		claimBoundary: MIRACL_EN_PRIMARY_CLAIM_BOUNDARY,
		oneTimeDisclosureRule:
			"if any later MIRACL-en execution mode is run, every completed mode result must be disclosed regardless of score",
		mixedEngineVisibility: {
			ko: "per-item-v1",
			en: "padded-array-batch-v1-passages+per-item-v1-queries",
			ar: "per-item-v1",
		},
		identity: {
			sourceLockSha256: contract.corpus.expectedSourceLockSha256,
			corpusDocumentCount: contract.corpus.expectedDocumentCount,
			corpusDocidsSha256: contract.corpus.expectedDocidsSha256,
			topicsSha256: contract.topics.sha256,
			qrelsSha256: contract.qrels.sha256,
			model: MIRACL_EMBEDDING_POLICY.model,
			modelRevision: MIRACL_EMBEDDING_POLICY.revision,
			...MIRACL_EN_PRIMARY_EXECUTION,
			embeddingExecutionPolicySha256: policy.embeddingExecutionPolicySha256,
		},
		artifacts: {
			preflightSha256: sha256(input.preflightBytes),
			preflightVectorArtifactSha256: input.vectorArtifactSha256,
			sourceDerivedSampleSha256: sha256(input.sampleReceiptBytes),
			sourceReceiptSha256: sha256(input.sourceReceiptBytes),
			qdrantServiceReceiptSha256: qdrantServiceBindingSha256(qdrantReceipt),
			evaluationSourceSha256: input.evaluationSourceSha256,
			authorizationSourceSha256: input.authorizationSourceSha256,
		},
		launch: {
			outputPath: MIRACL_EN_PRIMARY_OUTPUT,
			trecPath: MIRACL_EN_PRIMARY_TREC,
			checkpointDirectory: MIRACL_EN_PRIMARY_CHECKPOINT,
			qdrantUrl: qdrantReceipt.qdrantUrl,
			collectionName: `naia_miracl_en_${contract.corpus.expectedSourceLockSha256.slice(0, 8)}_${policy.embeddingExecutionPolicySha256.slice(0, 8)}`,
			cpuOnly: true as const,
		},
		publicClaimEligible: false as const,
	};
}

function parse(bytes: Uint8Array, name: string): unknown {
	try {
		return JSON.parse(Buffer.from(bytes).toString("utf8"));
	} catch {
		throw new Error(`${name} is invalid JSON`);
	}
}

function sha256FileSync(path: string): string {
	const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	const hash = createHash("sha256");
	const buffer = Buffer.allocUnsafe(1024 * 1024);
	try {
		const before = fstatSync(descriptor, { bigint: true });
		if (!before.isFile())
			throw new Error(
				"English preflight vector artifact is not a regular file",
			);
		for (;;) {
			const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
			if (bytesRead === 0) break;
			hash.update(buffer.subarray(0, bytesRead));
		}
		const after = fstatSync(descriptor, { bigint: true });
		if (
			before.size !== after.size ||
			before.mtimeNs !== after.mtimeNs ||
			before.ctimeNs !== after.ctimeNs
		)
			throw new Error(
				"English preflight vector artifact changed while hashing",
			);
	} finally {
		closeSync(descriptor);
	}
	return hash.digest("hex");
}

export function verifyMiraclEnPreflightVectorArtifact(
	path: string,
	expectedSha256: string,
): string {
	digest(expectedSha256, "expected preflight vector artifact");
	const actualSha256 = sha256FileSync(path);
	if (actualSha256 !== expectedSha256)
		throw new Error("English preflight vector artifact digest mismatch");
	return actualSha256;
}

export async function verifyMiraclEnPrimarySampleAgainstLockedCorpus(input: {
	sourceRoot: string;
	sourceReceiptPath: string;
	sampleReceipt: unknown;
	duplicateWorkDirectory?: string;
}): Promise<void> {
	validateMiraclEnPrimarySampleReceipt(input.sampleReceipt);
	const prepared = prepareMiraclCorpusIdentityScan({
		language: "en",
		sourceRoot: input.sourceRoot,
		sourceReceipt: readMiraclSourceReceipt(input.sourceReceiptPath),
	});
	if (prepared.sourceLockSha256 !== input.sampleReceipt.sourceLockSha256)
		throw new Error("English source-derived sample source lock changed");
	const verifier = new MiraclEnPrimarySampleSourceVerifier(input.sampleReceipt);
	const scan = await scanNativeCorpusDocuments(
		prepared.shards,
		(document, ordinal) => verifier.consider(document, ordinal),
		{
			duplicateWorkDirectory:
				input.duplicateWorkDirectory ?? dirname(input.sourceRoot),
			expectedCompressedShards: prepared.expectedCompressedShards,
		},
	);
	verifier.finish(scan);
}

export function verifyMiraclEnPrimaryExecutionFiles(
	environment: NodeJS.ProcessEnv,
	root = process.cwd(),
): {
	sampleReceipt: MiraclEnPrimarySampleReceipt;
	sourceReceiptPath: string;
	sourceRoot: string;
} {
	if (environment.MIRACL_LANGUAGE !== "en")
		throw new Error(
			"English primary authorization requires MIRACL_LANGUAGE=en",
		);
	if (environment.MIRACL_EN_PRIMARY_EXECUTION !== "1")
		throw new Error("explicit English primary execution opt-in is required");
	if (environment.MIRACL_MULTILINGUAL_AUTHORIZATION)
		throw new Error(
			"candidate and primary authorizations are mutually exclusive",
		);
	if (environment.CUDA_VISIBLE_DEVICES !== "")
		throw new Error("English primary execution must be CPU-only");
	const paths = {
		preflight:
			environment.MIRACL_EN_PRIMARY_PREFLIGHT ??
			"reports/quality/miracl-en-primary-preflight/evidence.json",
		vectors:
			environment.MIRACL_EN_PRIMARY_PREFLIGHT_VECTORS ??
			`${environment.MIRACL_EN_PRIMARY_PREFLIGHT ?? "reports/quality/miracl-en-primary-preflight/evidence.json"}.vectors.f32`,
		sample:
			environment.MIRACL_EN_PRIMARY_SAMPLE_RECEIPT ??
			"reports/quality/miracl-en-primary-preflight/source-derived-sample.json",
		source:
			environment.MIRACL_SOURCE_RECEIPT ??
			`${environment.MIRACL_SOURCE_DIR ?? miraclSourceRoot("en")}/source-lock-receipt.json`,
		qdrant: environment.MIRACL_QDRANT_SERVICE_RECEIPT,
		authorization:
			environment.MIRACL_EN_PRIMARY_AUTHORIZATION ??
			"reports/quality/miracl-en-primary-execution-authorization.json",
	};
	if (!paths.qdrant) throw new Error("Qdrant service receipt is required");
	if (
		(environment.MIRACL_FULL_OUTPUT ?? MIRACL_EN_PRIMARY_OUTPUT) !==
			MIRACL_EN_PRIMARY_OUTPUT ||
		(environment.MIRACL_FULL_CHECKPOINT_DIR ?? MIRACL_EN_PRIMARY_CHECKPOINT) !==
			MIRACL_EN_PRIMARY_CHECKPOINT
	)
		throw new Error("English primary output/checkpoint paths are pinned");
	if (existsSync(resolve(root, MIRACL_EN_PRIMARY_OUTPUT)))
		throw new Error("English primary result already exists");
	if (existsSync(resolve(root, MIRACL_EN_PRIMARY_TREC)))
		throw new Error("English primary TREC output already exists");
	const sourceReceiptPath = resolve(root, paths.source);
	const sourceRoot = resolve(
		root,
		environment.MIRACL_SOURCE_DIR ?? miraclSourceRoot("en"),
	);
	if (dirname(sourceReceiptPath) !== sourceRoot)
		throw new Error(
			"English source receipt and execution source root must be identical",
		);
	const preflightBytes = readFileSync(resolve(root, paths.preflight));
	const sampleReceiptBytes = readFileSync(resolve(root, paths.sample));
	const sourceReceiptBytes = readFileSync(resolve(root, paths.source));
	const qdrantReceiptBytes = readFileSync(resolve(root, paths.qdrant));
	const authorizationBytes = readFileSync(resolve(root, paths.authorization));
	const sampleReceipt = parse(
		sampleReceiptBytes,
		"English source-derived sample receipt",
	);
	validateMiraclEnPrimarySampleReceipt(sampleReceipt);
	const preflight = parse(
		preflightBytes,
		"English preflight",
	) as EnglishPrimaryPreflight;
	if (!preflight.execution?.producerSourceManifest)
		throw new Error("preflight producer source manifest is required");
	verifyNativeRuntimeSourceManifest(
		root,
		preflight.execution.producerSourceManifest,
	);
	verifyNativeRuntimeSourceManifest(root, sampleReceipt.producerSourceManifest);
	const contract = MIRACL_MULTILINGUAL_CONTRACT.en;
	const topicsBytes = readFileSync(join(sourceRoot, contract.topics.path));
	const qrelsBytes = readFileSync(join(sourceRoot, contract.qrels.path));
	if (
		topicsBytes.byteLength !== contract.topics.size ||
		sha256(topicsBytes) !== contract.topics.sha256 ||
		qrelsBytes.byteLength !== contract.qrels.size ||
		sha256(qrelsBytes) !== contract.qrels.sha256
	)
		throw new Error("English locked topics/qrels bytes changed");
	const sourceQueryIds = selectMiraclEnPreflightQueryIds(
		topicsBytes.toString("utf8"),
		qrelsBytes.toString("utf8"),
	);
	if (
		JSON.stringify(sampleReceipt.queries.ids) !== JSON.stringify(sourceQueryIds)
	)
		throw new Error("English source-derived query identities changed");
	if (
		sampleReceipt.queries.relevantByQuerySha256 !==
		miraclEnSelectedQrelsSha256(qrelsBytes.toString("utf8"), sourceQueryIds)
	)
		throw new Error("English source-derived qrels changed");
	if (
		sampleReceipt.retrievalCorpus.relevantDocidsSha256 !==
		miraclEnSelectedRelevantDocidsSha256(
			qrelsBytes.toString("utf8"),
			sourceQueryIds,
		)
	)
		throw new Error("English source-derived relevant passages changed");
	const expected = authorizeMiraclEnPrimaryExecution({
		preflight,
		preflightBytes,
		sampleReceipt,
		sampleReceiptBytes,
		sourceReceipt: parse(sourceReceiptBytes, "source receipt"),
		sourceReceiptBytes,
		qdrantReceipt: parse(qdrantReceiptBytes, "Qdrant receipt"),
		qdrantReceiptBytes,
		evaluationSourceSha256: sha256(
			readFileSync(
				resolve(
					root,
					"src/benchmark/quality/native-full-corpus-evaluation-cli.ts",
				),
			),
		),
		authorizationSourceSha256: sha256(
			readFileSync(
				resolve(
					root,
					"src/benchmark/quality/miracl-en-primary-execution-authorization.ts",
				),
			),
		),
		vectorArtifactSha256: verifyMiraclEnPreflightVectorArtifact(
			resolve(root, paths.vectors),
			preflight.execution.vectorArtifactSha256 as string,
		),
	});
	const actual = parse(authorizationBytes, "English primary authorization");
	canonicalReceipt(actual, authorizationBytes, "English primary authorization");
	if (canonical(actual) !== canonical(expected))
		throw new Error("English primary authorization mismatch");
	return { sampleReceipt, sourceReceiptPath, sourceRoot };
}

export async function verifyMiraclEnPrimaryExecutionLaunch(
	environment: NodeJS.ProcessEnv,
	root = process.cwd(),
): Promise<void> {
	const verified = verifyMiraclEnPrimaryExecutionFiles(environment, root);
	await verifyMiraclEnPrimarySampleAgainstLockedCorpus({
		sourceRoot: verified.sourceRoot,
		sourceReceiptPath: verified.sourceReceiptPath,
		sampleReceipt: verified.sampleReceipt,
		duplicateWorkDirectory:
			environment.MIRACL_DUPLICATE_WORK_DIR ?? dirname(verified.sourceRoot),
	});
}
