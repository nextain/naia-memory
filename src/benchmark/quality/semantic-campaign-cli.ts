import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { benchmarkReceiptFromDatasetHashes } from "../provenance.js";
import {
	type MemoryUpdateCase,
	type MemoryUpdateContract,
	validateMemoryUpdateContract,
} from "./memory-update-contract.js";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import {
	type Rfc3161DigestTimestampEvidence,
	type Rfc3161TimestampTrustPolicy,
	isRfc3161DigestTimestampEvidence,
	isRfc3161TimestampTrustPolicy,
	rfc3161TrustPolicyIdentity,
} from "./rfc3161-timestamp.js";
import {
	type SemanticAnalysisPlan,
	type SemanticAnalysisPlanTrustPolicy,
	isSemanticAnalysisPlan,
	isSemanticAnalysisPlanTrustPolicy,
	validateSemanticAnalysisPlan,
} from "./semantic-analysis-plan.js";
import type { SemanticConfirmatoryExecutionAuthorization } from "./semantic-confirmatory-execution-authorization.js";
import {
	expectedSemanticRetrievalSurface,
	providerConfig,
	runSemanticRawCli,
} from "./semantic-raw-cli.js";
import type { SemanticEngine } from "./semantic-raw-cli.js";
import { benchmarkEvidenceHmacKey } from "./semantic-embedding-route-evidence.js";
import {
	DEFAULT_SEMANTIC_ENGINES,
	DIAGNOSTIC_SEMANTIC_ENGINES,
	SUPPORTED_SEMANTIC_ENGINES,
	resolveSemanticCampaignMatrix,
} from "./semantic-campaign-matrix.js";

export {
	DEFAULT_SEMANTIC_ENGINES,
	DIAGNOSTIC_SEMANTIC_ENGINES,
	SUPPORTED_SEMANTIC_ENGINES,
	resolveSemanticCampaignMatrix,
} from "./semantic-campaign-matrix.js";

export function semanticComparisonLaneDisclosure(
	analysisPlan: SemanticAnalysisPlan | null,
) {
	return {
		comparisonLanes: analysisPlan?.comparisonLanes ?? null,
		comparisonLaneInterpretationPolicy: analysisPlan
			? analysisPlan.schemaVersion ===
				"naia-memory-semantic-analysis-plan-v6"
				? "schema-bound-known-lanes-v1"
				: "signed-v5-extensions-preserved-uninterpreted-v1"
			: null,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type SemanticCampaignCliArgs = {
	contractPath: string;
	outputDir: string;
	topK: number;
	executionSeed: string;
	repetitions: number;
	engines: SemanticEngine[];
	analysisPlanPath?: string;
	analysisPlanTrustPolicyPath?: string;
	confirmatoryAuthorizationPath?: string;
	analysisPlanTimestampEvidencePath?: string;
	analysisPlanTimestampTrustPolicyPath?: string;
};

export type SemanticCampaignRun = {
	repetition: number;
	enginePosition: number;
	engine: string;
	caseExecutionSeed: string;
	outputFile: string;
};

export type SemanticCampaignDependencies = {
	runSemanticRawCli: typeof runSemanticRawCli;
	providerConfig?: typeof providerConfig;
};

export function preflightSemanticCampaignRouteEvidence(
	analysisPlan: Pick<SemanticAnalysisPlan, "schemaVersion"> | undefined,
	getProviderConfig: typeof providerConfig = providerConfig,
): void {
	if (
		analysisPlan?.schemaVersion !== "naia-memory-semantic-analysis-plan-v6"
	)
		return;
	benchmarkEvidenceHmacKey(getProviderConfig().apiKey);
}

function sha256(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fileSha256(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function capturedJson(path: string): {
	bytes: Buffer;
	bytesSha256: string;
	value: unknown;
} {
	const bytes = readFileSync(path);
	return {
		bytes,
		bytesSha256: createHash("sha256").update(bytes).digest("hex"),
		value: JSON.parse(bytes.toString("utf8")),
	};
}

export function validateRawArtifact(
	path: string,
	expected: SemanticCampaignRun,
	expectedCases: MemoryUpdateCase[],
	expectedTopK: number,
	requireIndependentRouteBinding = false,
): void {
	const artifact = JSON.parse(readFileSync(path, "utf8")) as {
		schemaVersion?: unknown;
		disclosure?: {
			engine?: unknown;
			executionSeed?: unknown;
			topK?: unknown;
			inferencePolicy?: unknown;
			mutationAuthorizationPolicy?: unknown;
			llmModel?: unknown;
			embeddingModel?: unknown;
			embeddingRevision?: unknown;
			embeddingDimensions?: unknown;
			authScheme?: unknown;
			endpoint?: unknown;
			endpointRouteHmacSha256?: unknown;
			endpointRouteBindingPolicy?: unknown;
		};
		cases?: Array<{
			caseId?: unknown;
			executionPosition?: unknown;
			language?: unknown;
			fixtureSha256?: unknown;
			engineInputSha256?: unknown;
			ingestionPolicy?: unknown;
			temporalInputPolicy?: unknown;
			retrievalSurface?: unknown;
			ingestionReceipts?: unknown;
			nativeState?: unknown;
			retrieved?: unknown;
			outputSha256?: unknown;
		}>;
	};
	const expectedById = new Map(expectedCases.map((item) => [item.id, item]));
	if (
		!SUPPORTED_SEMANTIC_ENGINES.includes(
			expected.engine as (typeof SUPPORTED_SEMANTIC_ENGINES)[number],
		)
	)
		throw new Error("invalid semantic campaign engine");
	const expectedRetrievalSurface = expectedSemanticRetrievalSurface(
		expected.engine as SemanticEngine,
	);
	const routeBindingInvalid =
		requireIndependentRouteBinding &&
		["naia", "mem0", "plain-vector"].includes(expected.engine) &&
		(typeof artifact.disclosure?.endpointRouteHmacSha256 !== "string" ||
			!/^[0-9a-f]{64}$/.test(artifact.disclosure.endpointRouteHmacSha256) ||
			artifact.disclosure.endpointRouteBindingPolicy !==
				"independent-key-hmac-sha256-observed-openai-embedding-route-v3");
	if (
		artifact.schemaVersion !== "naia-memory-semantic-raw-artifact-v2" ||
		routeBindingInvalid ||
		artifact.disclosure?.engine !== expected.engine ||
		artifact.disclosure.executionSeed !== expected.caseExecutionSeed ||
		artifact.disclosure.topK !== expectedTopK ||
		(expected.engine === "plain-vector" &&
			(artifact.disclosure.inferencePolicy !== "embedding-only-no-llm-v1" ||
				artifact.disclosure.mutationAuthorizationPolicy !==
					"none-immutable-turn-baseline-v1" ||
				typeof artifact.disclosure.embeddingModel !== "string" ||
				artifact.disclosure.embeddingModel.trim().length === 0 ||
				typeof artifact.disclosure.embeddingRevision !== "string" ||
				artifact.disclosure.embeddingRevision.trim().length === 0 ||
				!Number.isInteger(artifact.disclosure.embeddingDimensions) ||
				Number(artifact.disclosure.embeddingDimensions) < 1 ||
				artifact.disclosure.authScheme !== "bearer" ||
				typeof artifact.disclosure.endpoint !== "string" ||
				!/^https?:\/\/[^/?#]+(?::\d+)?$/.test(artifact.disclosure.endpoint) ||
				typeof artifact.disclosure.endpointRouteHmacSha256 !== "string" ||
				!/^[0-9a-f]{64}$/.test(artifact.disclosure.endpointRouteHmacSha256) ||
				artifact.disclosure.endpointRouteBindingPolicy !==
					"independent-key-hmac-sha256-observed-openai-embedding-route-v3" ||
				Object.hasOwn(artifact.disclosure, "llmModel"))) ||
		!Array.isArray(artifact.cases) ||
		artifact.cases.length !== expectedCases.length ||
		new Set(artifact.cases.map((item) => item.caseId)).size !==
			expectedCases.length ||
		artifact.cases.some((item, index) => {
			const benchmarkCase =
				typeof item.caseId === "string"
					? expectedById.get(item.caseId)
					: undefined;
			const nativeState = Array.isArray(item.nativeState)
				? (item.nativeState as Array<{
						nativeId?: unknown;
						content?: unknown;
					}>)
				: [];
			const retrieved = Array.isArray(item.retrieved)
				? (item.retrieved as Array<{
						nativeId?: unknown;
						content?: unknown;
					}>)
				: [];
			const expectedBaselineState = benchmarkCase?.turns.map(
				(turn, turnIndex) => ({
					nativeId: `turn-${String(turnIndex + 1).padStart(6, "0")}`,
					content: turn.content,
				}),
			);
			const baselineReceipts = Array.isArray(item.ingestionReceipts)
				? item.ingestionReceipts
				: [];
			const baselineStateInvalid =
				expected.engine === "plain-vector" &&
				(expectedBaselineState === undefined ||
					baselineReceipts.length !== expectedBaselineState.length ||
					baselineReceipts.some(
						(receipt) =>
							!isRecord(receipt) ||
							Object.keys(receipt).length !== 2 ||
							!Object.hasOwn(receipt, "outcome") ||
							!Object.hasOwn(receipt, "nativeOperationCount") ||
							receipt.outcome !== "native-operations" ||
							receipt.nativeOperationCount !== 1,
					) ||
					JSON.stringify(nativeState) !==
						JSON.stringify(expectedBaselineState) ||
					new Set(nativeState.map((memory) => memory.nativeId)).size !==
						nativeState.length ||
					new Set(retrieved.map((memory) => memory.nativeId)).size !==
						retrieved.length ||
					retrieved.some(
						(memory) =>
							nativeState.find((native) => native.nativeId === memory.nativeId)
								?.content !== memory.content,
					));
			const nativeIds = new Set(nativeState.map((memory) => memory.nativeId));
			return (
				benchmarkCase === undefined ||
				baselineStateInvalid ||
				item.executionPosition !== index + 1 ||
				item.language !== benchmarkCase.language ||
				item.fixtureSha256 !==
					sha256({
						language: benchmarkCase.language,
						turns: benchmarkCase.turns,
						query: benchmarkCase.query,
					}) ||
				item.engineInputSha256 !==
					sha256({
						language: benchmarkCase.language,
						turns: benchmarkCase.turns.map((turn) => ({
							content: turn.content,
						})),
						query: benchmarkCase.query,
					}) ||
				(item.ingestionPolicy !== "sequential-turn-commit-v1" &&
					item.ingestionPolicy !== "sequential-turn-settled-bank-v1") ||
				item.temporalInputPolicy !== "engine-default-ingest-time-v1" ||
				item.retrievalSurface !== expectedRetrievalSurface ||
				!Array.isArray(item.ingestionReceipts) ||
				!Array.isArray(item.nativeState) ||
				!Array.isArray(item.retrieved) ||
				!Number.isInteger(artifact.disclosure?.topK) ||
				Number(artifact.disclosure?.topK) < 1 ||
				retrieved.length > Number(artifact.disclosure?.topK) ||
				nativeState.some(
					(memory) =>
						typeof memory.nativeId !== "string" ||
						typeof memory.content !== "string",
				) ||
				retrieved.some(
					(memory) =>
						typeof memory.nativeId !== "string" ||
						typeof memory.content !== "string" ||
						!nativeIds.has(memory.nativeId),
				) ||
				item.outputSha256 !==
					sha256({
						ingestionReceipts: item.ingestionReceipts,
						nativeState: item.nativeState,
						retrieved: item.retrieved,
					})
			);
		})
	)
		throw new Error(`invalid semantic raw artifact: ${expected.outputFile}`);
}

export function parseSemanticCampaignCliArgs(
	args: string[],
): SemanticCampaignCliArgs {
	const values = new Map<string, string>();
	for (const arg of args) {
		const match = /^--([^=]+)=(.+)$/.exec(arg);
		if (!match) throw new Error(`invalid argument: ${arg}`);
		if (
			![
				"contract",
				"output-dir",
				"top-k",
				"seed",
				"repetitions",
				"engines",
				"analysis-plan",
				"analysis-plan-trust-policy",
				"confirmatory-authorization",
				"analysis-plan-timestamp-evidence",
				"analysis-plan-timestamp-trust-policy",
			].includes(match[1])
		)
			throw new Error(`unknown argument: --${match[1]}`);
		if (values.has(match[1]))
			throw new Error(`duplicate argument: --${match[1]}`);
		values.set(match[1], match[2]);
	}
	const contractPath = values.get("contract");
	const outputDir = values.get("output-dir");
	const executionSeed = values.get("seed");
	if (!contractPath || !outputDir || !executionSeed?.trim())
		throw new Error(
			"--contract, --output-dir, and non-blank --seed are required",
		);
	const topK = Number(values.get("top-k") ?? "5");
	if (!Number.isInteger(topK) || topK < 1)
		throw new Error("--top-k must be a positive integer");
	const defaultEngines = values.has("analysis-plan")
		? DEFAULT_SEMANTIC_ENGINES
		: DIAGNOSTIC_SEMANTIC_ENGINES;
	const requestedEngines = (values.get("engines") ?? defaultEngines.join(","))
		.split(",")
		.map((engine) => engine.trim());
	if (
		requestedEngines.length < 2 ||
		requestedEngines.some(
			(engine) =>
				!SUPPORTED_SEMANTIC_ENGINES.includes(
					engine as (typeof SUPPORTED_SEMANTIC_ENGINES)[number],
				),
		) ||
		new Set(requestedEngines).size !== requestedEngines.length
	)
		throw new Error(
			`--engines must select at least two unique engines from ${SUPPORTED_SEMANTIC_ENGINES.join(", ")}`,
		);
	const engines = requestedEngines as SemanticEngine[];
	if (!values.has("analysis-plan") && engines.includes("plain-vector"))
		throw new Error(
			"plain-vector campaigns require a signed v6 --analysis-plan",
		);
	const repetitions = Number(
		values.get("repetitions") ?? String(engines.length),
	);
	const matrixKnownAtParse =
		!values.has("analysis-plan") || values.has("engines");
	if (
		!Number.isInteger(repetitions) ||
		repetitions < 1 ||
		(matrixKnownAtParse &&
			(repetitions < engines.length || repetitions % engines.length !== 0))
	)
		throw new Error(
			`--repetitions must be a positive multiple of the ${engines.length}-engine matrix of at least ${engines.length}`,
		);
	return {
		contractPath,
		outputDir,
		topK,
		executionSeed,
		repetitions,
		engines,
		analysisPlanPath: values.get("analysis-plan"),
		analysisPlanTrustPolicyPath: values.get("analysis-plan-trust-policy"),
		confirmatoryAuthorizationPath: values.get("confirmatory-authorization"),
		analysisPlanTimestampEvidencePath: values.get(
			"analysis-plan-timestamp-evidence",
		),
		analysisPlanTimestampTrustPolicyPath: values.get(
			"analysis-plan-timestamp-trust-policy",
		),
	};
}

function loadCampaignAnalysisPlan(
	path: string | undefined,
	trustPolicyPath: string | undefined,
	contract: MemoryUpdateContract,
	engines: readonly string[] | undefined,
):
	| {
			plan: SemanticAnalysisPlan;
			trustPolicy: SemanticAnalysisPlanTrustPolicy;
			datasetHashes: Record<string, string>;
	  }
	| undefined {
	if (!path && !trustPolicyPath) return undefined;
	if (!path || !trustPolicyPath)
		throw new Error(
			"--analysis-plan and --analysis-plan-trust-policy must be supplied together",
		);
	const capturedPlan = capturedJson(path);
	const plan = capturedPlan.value;
	if (!isSemanticAnalysisPlan(plan))
		throw new Error(
			"--analysis-plan must contain a valid semantic analysis plan",
		);
	if (plan.contractSha256 !== evidenceObjectSha256(contract))
		throw new Error("semantic analysis plan contract binding is invalid");
	if (engines && JSON.stringify(plan.engines) !== JSON.stringify(engines))
		throw new Error("semantic analysis plan engine order is invalid");
	const campaignEngines = engines ?? plan.engines;
	const capturedTrustPolicy = capturedJson(trustPolicyPath);
	const trustPolicy = capturedTrustPolicy.value;
	if (!isSemanticAnalysisPlanTrustPolicy(trustPolicy))
		throw new Error("semantic analysis plan trust policy is invalid");
	validateSemanticAnalysisPlan({
		contract,
		plan,
		trustPolicy: trustPolicy as SemanticAnalysisPlanTrustPolicy,
		campaign: {
			schemaVersion: "naia-memory-semantic-campaign-v4",
			disclosure: {
				engines: [...campaignEngines],
				analysisPlanSha256: evidenceObjectSha256(plan),
				claimScope: plan.claimScope,
				comparisonLanes: plan.comparisonLanes,
				crossLaneAggregation: plan.crossLaneAggregation,
			},
		},
		firstExecutionStartedAt: new Date().toISOString(),
	});
	return {
		plan,
		trustPolicy: trustPolicy as SemanticAnalysisPlanTrustPolicy,
		datasetHashes: {
			[path]: capturedPlan.bytesSha256,
			[trustPolicyPath]: capturedTrustPolicy.bytesSha256,
		},
	};
}

export function buildSemanticCampaignPlan(
	executionSeed: string,
	repetitions: number,
	engines: readonly string[] = DIAGNOSTIC_SEMANTIC_ENGINES,
): SemanticCampaignRun[] {
	if (!executionSeed.trim())
		throw new Error("campaign execution seed is required");
	if (
		engines.length < 2 ||
		engines.some((engine) => typeof engine !== "string" || !engine.trim()) ||
		new Set(engines).size !== engines.length
	)
		throw new Error("campaign engines must contain at least two unique names");
	if (
		!Number.isInteger(repetitions) ||
		repetitions < engines.length ||
		repetitions % engines.length !== 0
	)
		throw new Error(
			`campaign repetitions must be a positive multiple of the ${engines.length}-engine matrix of at least ${engines.length}`,
		);
	const offset =
		Number.parseInt(
			sha256({ executionSeed, scope: "engine-order" }).slice(0, 8),
			16,
		) % engines.length;
	const firstOrder = engines.map(
		(_engine, index) => engines[(index + offset) % engines.length],
	);
	const plan: SemanticCampaignRun[] = [];
	for (let repetition = 1; repetition <= repetitions; repetition += 1) {
		const rotation = (repetition - 1) % engines.length;
		const order = firstOrder.map(
			(_engine, index) => firstOrder[(index + rotation) % engines.length],
		);
		const caseExecutionSeed = sha256({
			executionSeed,
			scope: "case-order",
			repetition,
		});
		for (const [engineIndex, engine] of order.entries())
			plan.push({
				repetition,
				enginePosition: engineIndex + 1,
				engine,
				caseExecutionSeed,
				outputFile: `repetition-${String(repetition).padStart(2, "0")}-${engine}.json`,
			});
	}
	return plan;
}

export async function runSemanticCampaignCli(
	args: string[],
	dependencies: SemanticCampaignDependencies = { runSemanticRawCli, providerConfig },
): Promise<void> {
	const enginesExplicit = args.some((arg) => arg.startsWith("--engines="));
	const parsed = parseSemanticCampaignCliArgs(args);
	const contractPath = resolve(parsed.contractPath);
	const outputDir = resolve(parsed.outputDir);
	const capturedContract = capturedJson(contractPath);
	const contract = capturedContract.value as MemoryUpdateContract;
	validateMemoryUpdateContract(contract);
	if (contract.tier !== "semantic-update-interpretation")
		throw new Error("semantic campaign requires a semantic-update contract");
	const analysisPlanPath = parsed.analysisPlanPath
		? resolve(parsed.analysisPlanPath)
		: undefined;
	const analysisPlanTrustPolicyPath = parsed.analysisPlanTrustPolicyPath
		? resolve(parsed.analysisPlanTrustPolicyPath)
		: undefined;
	const analysisPlanBundle = loadCampaignAnalysisPlan(
		analysisPlanPath,
		analysisPlanTrustPolicyPath,
		contract,
		enginesExplicit ? parsed.engines : undefined,
	);
	const analysisPlan = analysisPlanBundle?.plan;
	const matrix = resolveSemanticCampaignMatrix(args, parsed, analysisPlan);
	const campaignEngines = matrix.engines;
	const campaignRepetitions = matrix.repetitions;
	preflightSemanticCampaignRouteEvidence(
		analysisPlan,
		dependencies.providerConfig ?? providerConfig,
	);
	let confirmatoryEvidence:
		| {
				authorization: SemanticConfirmatoryExecutionAuthorization;
				timestampEvidence: Rfc3161DigestTimestampEvidence;
				timestampTrustPolicy: Rfc3161TimestampTrustPolicy;
				datasetHashes: Record<string, string>;
		  }
		| undefined;
	const suppliedConfirmatoryPaths = [
		parsed.confirmatoryAuthorizationPath,
		parsed.analysisPlanTimestampEvidencePath,
		parsed.analysisPlanTimestampTrustPolicyPath,
	];
	if (!analysisPlanBundle && suppliedConfirmatoryPaths.some(Boolean))
		throw new Error(
			"confirmatory authorization evidence requires an analysis plan",
		);
	if (analysisPlanBundle) {
		const requiredPaths = suppliedConfirmatoryPaths;
		if (requiredPaths.some((path) => !path))
			throw new Error(
				"confirmatory authorization and analysis-plan timestamp evidence are required",
			);
		const authorizationPath = resolve(requiredPaths[0] as string);
		const timestampEvidencePath = resolve(requiredPaths[1] as string);
		const timestampTrustPolicyPath = resolve(requiredPaths[2] as string);
		const capturedAuthorization = capturedJson(authorizationPath);
		const capturedTimestampEvidence = capturedJson(timestampEvidencePath);
		const capturedTimestampTrustPolicy = capturedJson(timestampTrustPolicyPath);
		const authorization =
			capturedAuthorization.value as SemanticConfirmatoryExecutionAuthorization;
		const timestampEvidence = capturedTimestampEvidence.value;
		const timestampTrustPolicy = capturedTimestampTrustPolicy.value;
		if (!isRfc3161DigestTimestampEvidence(timestampEvidence))
			throw new Error("analysis-plan timestamp evidence is invalid");
		if (!isRfc3161TimestampTrustPolicy(timestampTrustPolicy))
			throw new Error("analysis-plan timestamp trust policy is invalid");
		confirmatoryEvidence = {
			authorization,
			timestampEvidence: timestampEvidence as Rfc3161DigestTimestampEvidence,
			timestampTrustPolicy: timestampTrustPolicy as Rfc3161TimestampTrustPolicy,
			datasetHashes: {
				[authorizationPath]: capturedAuthorization.bytesSha256,
				[timestampEvidencePath]: capturedTimestampEvidence.bytesSha256,
				[timestampTrustPolicyPath]: capturedTimestampTrustPolicy.bytesSha256,
			},
		};
	}
	mkdirSync(dirname(outputDir), { recursive: true });
	mkdirSync(outputDir, { mode: 0o700 });
	const capturedContractPath = resolve(outputDir, ".campaign-contract.json");
	writeFileSync(capturedContractPath, capturedContract.bytes, {
		flag: "wx",
		mode: 0o600,
	});
	const plan = buildSemanticCampaignPlan(
		parsed.executionSeed,
		campaignRepetitions,
		campaignEngines,
	);
	for (const run of plan) {
		await dependencies.runSemanticRawCli([
			`--engine=${run.engine}`,
			`--contract=${capturedContractPath}`,
			`--output=${resolve(outputDir, run.outputFile)}`,
			`--top-k=${parsed.topK}`,
			`--seed=${run.caseExecutionSeed}`,
		]);
		validateRawArtifact(
			resolve(outputDir, run.outputFile),
			run,
			contract.cases,
			parsed.topK,
			analysisPlan?.schemaVersion === "naia-memory-semantic-analysis-plan-v6",
		);
	}
	const enginePositionCounts = Object.fromEntries(
		campaignEngines.map((engine) => [
			engine,
			Object.fromEntries(
				Array.from({ length: campaignEngines.length }, (_unused, index) => [
					String(index + 1),
					plan.filter(
						(run) => run.engine === engine && run.enginePosition === index + 1,
					).length,
				]),
			),
		]),
	);
	const disclosure = {
		eligibility: analysisPlan
			? ("competitive-candidate" as const)
			: ("diagnostic" as const),
		executionSeed: parsed.executionSeed,
		repetitions: campaignRepetitions,
		topK: parsed.topK,
		engines: campaignEngines,
		analysisPlanSha256: analysisPlan
			? evidenceObjectSha256(analysisPlan)
			: null,
		analysisPlanSchemaVersion: analysisPlan?.schemaVersion ?? null,
		confirmatoryAuthorizationSha256: confirmatoryEvidence
			? evidenceObjectSha256(confirmatoryEvidence.authorization)
			: null,
		analysisPlanTimestampEvidenceSha256: confirmatoryEvidence
			? evidenceObjectSha256(confirmatoryEvidence.timestampEvidence)
			: null,
		analysisPlanTimestampTrustPolicyIdentitySha256: confirmatoryEvidence
			? evidenceObjectSha256(
					rfc3161TrustPolicyIdentity(confirmatoryEvidence.timestampTrustPolicy),
				)
			: null,
		claimScope:
			analysisPlan?.claimScope ?? "diagnostic-characterization-only-v1",
		...semanticComparisonLaneDisclosure(analysisPlan),
		crossLaneAggregation: analysisPlan?.crossLaneAggregation ?? "prohibited",
		retrievalBaselinePolicy: campaignEngines.includes("plain-vector")
			? {
					engine: "plain-vector",
					retrievalSurface: "baseline-immutable-turn-vector-search-v1",
					inferencePolicy: "embedding-only-no-llm-v1",
					mutationAuthorizationPolicy: "none-immutable-turn-baseline-v1",
				}
			: null,
		engineOrderPolicy: "seeded-n-engine-latin-rotation-v2",
		caseOrderPolicy: "shared-seeded-per-repetition-v1",
		enginePositionCounts,
		languageCaseCounts: Object.fromEntries(
			["ko", "en", "ja"].map((language) => [
				language,
				contract.cases.filter((item) => item.language === language).length,
			]),
		),
		generalizationBoundary:
			"Generated diagnostic cases only; repetitions measure execution stability, not held-out generalization.",
		configurationPolicy:
			"Engine-native surfaces are observed with disclosed native configurations. Plain-vector is a separate immutable-turn retrieval baseline using embedding-only inference, no LLM, and no mutation authorization. Letta exposes always-active non-persona core blocks first, followed by its query-ranked archival search results, and preserves the complete core-plus-archive state for identity validation. Graphiti is split into projected-current and native-historical comparator IDs; their scores must not be merged. Historical retrieval is validated against complete group history obtained independently from query output. Component-level parity and a single retrieval leaderboard are not claimed.",
	};
	const manifest = {
		schemaVersion: "naia-memory-semantic-campaign-v5",
		interpretation:
			"Balanced execution manifest over unscored raw artifacts; not quality evidence by itself.",
		receipt: benchmarkReceiptFromDatasetHashes(
			{
				[contractPath]: capturedContract.bytesSha256,
				...(analysisPlanBundle?.datasetHashes ?? {}),
				...(confirmatoryEvidence?.datasetHashes ?? {}),
			},
			disclosure,
			[
				"src/benchmark/quality/semantic-campaign-cli.ts",
				"src/benchmark/quality/semantic-raw-cli.ts",
				"src/benchmark/quality/memory-semantic-runner.ts",
				"src/benchmark/quality/bridge-graphiti-semantic.ts",
				"src/benchmark/quality/bridge-graphiti-historical-semantic.ts",
				"src/benchmark/quality/graphiti-rest-semantic-client.ts",
				"tools/graphiti-benchmark-sidecar/router.py",
				"tools/graphiti-benchmark-sidecar/pin.json",
				"src/benchmark/quality/bridge-hindsight-semantic.ts",
				"src/benchmark/quality/bridge-letta-semantic.ts",
				"src/benchmark/quality/bridge-mem0-semantic.ts",
				"src/benchmark/quality/bridge-naia-semantic.ts",
				"src/benchmark/quality/bridge-plain-vector-semantic.ts",
			],
		),
		disclosure,
		runs: plan.map((run) => ({
			...run,
			artifactSha256: fileSha256(resolve(outputDir, run.outputFile)),
		})),
	};
	const manifestPath = resolve(outputDir, "campaign.json");
	const temporaryPath = `${manifestPath}.${randomUUID()}.tmp`;
	writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
	renameSync(temporaryPath, manifestPath);
	process.stdout.write(`${manifestPath}\n`);
}

const invokedPath = process.argv[1]
	? pathToFileURL(resolve(process.argv[1])).href
	: undefined;
if (invokedPath === import.meta.url)
	runSemanticCampaignCli(process.argv.slice(2)).catch((error) => {
		process.stderr.write(
			`${error instanceof Error ? error.message : "semantic campaign failed"}\n`,
		);
		process.exitCode = 1;
	});
