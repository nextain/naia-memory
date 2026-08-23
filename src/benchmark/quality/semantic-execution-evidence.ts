import { createHash, createPublicKey } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MemoryUpdateContract } from "./memory-update-contract.js";
import {
	evidenceObjectSha256,
	hasValidEvidenceSignature,
} from "./public-evidence-crypto.js";
import { hasValidSemanticComparisonLanes } from "./semantic-analysis-plan.js";
import {
	SUPPORTED_SEMANTIC_ENGINES,
	type SemanticCampaignRun,
	buildSemanticCampaignPlan,
	validateRawArtifact,
} from "./semantic-campaign-cli.js";

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_REVISION = /^[a-f0-9]{40}$/;

export type SemanticExecutionReceipt = {
	schemaVersion: "naia-memory-semantic-execution-receipt-v1";
	executor: string;
	engine: string;
	contractSha256: string;
	campaignSha256: string;
	campaignRunSetSha256: string;
	implementationRevision: string;
	workspaceClean: true;
	implementationArtifactSha256: string;
	configurationSha256: string;
	startedAt: string;
	completedAt: string;
	elapsedMs: number;
	estimatedCostUsd: number | null;
	costDisclosure: "measured" | "estimated" | "unknown";
	signedAt: string;
	statement: "EXECUTION_ARTIFACTS_CONFIRMED";
	signatureBase64: string;
};

export type SemanticExecutionEvidenceBundle = {
	schemaVersion: "naia-memory-semantic-execution-evidence-bundle-v1";
	contractSha256: string;
	campaignSha256: string;
	receipts: SemanticExecutionReceipt[];
};

export type SemanticExecutionTrustPolicy = {
	executorPublicKeys: Record<string, string>;
};

type CampaignManifest = {
	schemaVersion:
		| "naia-memory-semantic-campaign-v3"
		| "naia-memory-semantic-campaign-v4"
		| "naia-memory-semantic-campaign-v5";
	disclosure: {
		eligibility?: "diagnostic" | "competitive-candidate";
		executionSeed: string;
		repetitions: number;
		topK: number;
		engines: string[];
		analysisPlanSha256?: string | null;
		claimScope?: string;
		comparisonLanes?: unknown;
		crossLaneAggregation?: "prohibited";
		confirmatoryAuthorizationSha256?: string | null;
		analysisPlanTimestampEvidenceSha256?: string | null;
		analysisPlanTimestampTrustPolicyIdentitySha256?: string | null;
	};
	runs: Array<SemanticCampaignRun & { artifactSha256: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256Bytes(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function isEd25519Key(value: unknown): value is string {
	if (typeof value !== "string") return false;
	try {
		return createPublicKey(value).asymmetricKeyType === "ed25519";
	} catch {
		return false;
	}
}

export function isSemanticExecutionEvidenceBundle(
	value: unknown,
): value is SemanticExecutionEvidenceBundle {
	return (
		isRecord(value) &&
		value.schemaVersion ===
			"naia-memory-semantic-execution-evidence-bundle-v1" &&
		typeof value.contractSha256 === "string" &&
		SHA256.test(value.contractSha256) &&
		typeof value.campaignSha256 === "string" &&
		SHA256.test(value.campaignSha256) &&
		Array.isArray(value.receipts) &&
		value.receipts.every(
			(item) =>
				isRecord(item) &&
				item.schemaVersion === "naia-memory-semantic-execution-receipt-v1" &&
				typeof item.executor === "string" &&
				item.executor.trim().length > 0 &&
				typeof item.engine === "string" &&
				SUPPORTED_SEMANTIC_ENGINES.includes(
					item.engine as (typeof SUPPORTED_SEMANTIC_ENGINES)[number],
				) &&
				[
					"contractSha256",
					"campaignSha256",
					"campaignRunSetSha256",
					"implementationArtifactSha256",
					"configurationSha256",
				].every(
					(key) =>
						typeof item[key] === "string" && SHA256.test(item[key] as string),
				) &&
				typeof item.implementationRevision === "string" &&
				GIT_REVISION.test(item.implementationRevision) &&
				item.workspaceClean === true &&
				typeof item.startedAt === "string" &&
				typeof item.completedAt === "string" &&
				typeof item.signedAt === "string" &&
				typeof item.elapsedMs === "number" &&
				Number.isFinite(item.elapsedMs) &&
				item.elapsedMs >= 0 &&
				(item.estimatedCostUsd === null ||
					(typeof item.estimatedCostUsd === "number" &&
						Number.isFinite(item.estimatedCostUsd) &&
						item.estimatedCostUsd >= 0)) &&
				["measured", "estimated", "unknown"].includes(
					item.costDisclosure as string,
				) &&
				item.statement === "EXECUTION_ARTIFACTS_CONFIRMED" &&
				typeof item.signatureBase64 === "string",
		)
	);
}

export function isSemanticExecutionTrustPolicy(
	value: unknown,
): value is SemanticExecutionTrustPolicy {
	return (
		isRecord(value) &&
		isRecord(value.executorPublicKeys) &&
		Object.keys(value.executorPublicKeys).length > 0 &&
		Object.entries(value.executorPublicKeys).every(
			([identity, key]) => identity.trim().length > 0 && isEd25519Key(key),
		)
	);
}

function validateCampaign(
	contract: MemoryUpdateContract,
	campaign: CampaignManifest,
	campaignDirectory: string,
): void {
	const { disclosure, runs } = campaign;
	if (
		![
			"naia-memory-semantic-campaign-v3",
			"naia-memory-semantic-campaign-v4",
			"naia-memory-semantic-campaign-v5",
		].includes(campaign.schemaVersion) ||
		!disclosure?.executionSeed?.trim() ||
		!Array.isArray(disclosure.engines) ||
		disclosure.engines.length < 2 ||
		new Set(disclosure.engines).size !== disclosure.engines.length ||
		disclosure.engines.some(
			(engine) =>
				!SUPPORTED_SEMANTIC_ENGINES.includes(
					engine as (typeof SUPPORTED_SEMANTIC_ENGINES)[number],
				),
		) ||
		!Number.isInteger(disclosure.repetitions) ||
		disclosure.repetitions < disclosure.engines.length ||
		disclosure.repetitions % disclosure.engines.length !== 0 ||
		!Number.isInteger(disclosure.topK) ||
		disclosure.topK < 1 ||
		(campaign.schemaVersion === "naia-memory-semantic-campaign-v4" &&
			((disclosure.analysisPlanSha256 !== null &&
				(typeof disclosure.analysisPlanSha256 !== "string" ||
					!SHA256.test(disclosure.analysisPlanSha256))) ||
				(disclosure.claimScope === "diagnostic-characterization-only-v1"
					? disclosure.analysisPlanSha256 !== null ||
						disclosure.comparisonLanes !== null
					: ![
							"direct-lifecycle-competitive-report-v1",
							"declared-multi-class-competitive-report-v1",
						].includes(disclosure.claimScope ?? "") ||
						disclosure.analysisPlanSha256 == null ||
						!hasValidSemanticComparisonLanes(
							disclosure.comparisonLanes,
							disclosure.claimScope,
						)) ||
				disclosure.crossLaneAggregation !== "prohibited" ||
				disclosure.claimScope !== "diagnostic-characterization-only-v1")) ||
		(campaign.schemaVersion === "naia-memory-semantic-campaign-v5" &&
			(disclosure.claimScope === "diagnostic-characterization-only-v1"
				? disclosure.eligibility !== "diagnostic" ||
					disclosure.analysisPlanSha256 !== null ||
					disclosure.comparisonLanes !== null ||
					disclosure.confirmatoryAuthorizationSha256 !== null
				: ![
						"direct-lifecycle-competitive-report-v1",
						"declared-multi-class-competitive-report-v1",
					].includes(disclosure.claimScope ?? "") ||
					disclosure.eligibility !== "competitive-candidate" ||
					disclosure.analysisPlanSha256 == null ||
					!hasValidSemanticComparisonLanes(
						disclosure.comparisonLanes,
						disclosure.claimScope,
					) ||
					disclosure.crossLaneAggregation !== "prohibited" ||
					![
						disclosure.confirmatoryAuthorizationSha256,
						disclosure.analysisPlanTimestampEvidenceSha256,
						disclosure.analysisPlanTimestampTrustPolicyIdentitySha256,
					].every(
						(value) => typeof value === "string" && SHA256.test(value),
					))) ||
		!Array.isArray(runs)
	)
		throw new Error("semantic execution campaign shape is invalid");
	const expected = buildSemanticCampaignPlan(
		disclosure.executionSeed,
		disclosure.repetitions,
		disclosure.engines,
	);
	if (runs.length !== expected.length)
		throw new Error("semantic execution campaign coverage is incomplete");
	for (const [index, run] of runs.entries()) {
		const planned = expected[index];
		if (
			!planned ||
			run.repetition !== planned.repetition ||
			run.enginePosition !== planned.enginePosition ||
			run.engine !== planned.engine ||
			run.caseExecutionSeed !== planned.caseExecutionSeed ||
			run.outputFile !== planned.outputFile ||
			!SHA256.test(run.artifactSha256)
		)
			throw new Error("semantic execution campaign plan is invalid");
		const artifactPath = resolve(campaignDirectory, run.outputFile);
		if (!lstatSync(artifactPath).isFile())
			throw new Error(
				`semantic execution artifact is not a regular file: ${run.outputFile}`,
			);
		const bytes = readFileSync(artifactPath);
		if (sha256Bytes(bytes) !== run.artifactSha256)
			throw new Error(
				`semantic execution artifact hash mismatch: ${run.outputFile}`,
			);
		validateRawArtifact(artifactPath, run, contract.cases, disclosure.topK);
	}
}

export function semanticEngineRunSetSha256(
	campaign: CampaignManifest,
	engine: string,
): string {
	return evidenceObjectSha256(
		campaign.runs.filter((run) => run.engine === engine),
	);
}

export function validateSemanticExecutionEvidence(input: {
	contract: MemoryUpdateContract;
	campaign: unknown;
	campaignBytes: Buffer;
	campaignDirectory: string;
	bundle: SemanticExecutionEvidenceBundle;
	trustPolicy: SemanticExecutionTrustPolicy;
}): { engineCount: number; runCount: number; costComplete: boolean } {
	if (!isRecord(input.campaign))
		throw new Error("semantic execution campaign root must be an object");
	const campaign = input.campaign as CampaignManifest;
	validateCampaign(input.contract, campaign, input.campaignDirectory);
	const contractSha256 = evidenceObjectSha256(input.contract);
	const campaignSha256 = sha256Bytes(input.campaignBytes);
	if (
		input.bundle.contractSha256 !== contractSha256 ||
		input.bundle.campaignSha256 !== campaignSha256
	)
		throw new Error("semantic execution bundle is not bound to its inputs");
	const engines = campaign.disclosure.engines;
	if (input.bundle.receipts.length !== engines.length)
		throw new Error("semantic execution receipts do not cover every engine");
	const normalizedKeys = new Set<string>();
	for (const key of Object.values(input.trustPolicy.executorPublicKeys)) {
		const normalized = createPublicKey(key)
			.export({ type: "spki", format: "der" })
			.toString("base64");
		if (normalizedKeys.has(normalized))
			throw new Error(
				"semantic execution trust keys overlap across identities",
			);
		normalizedKeys.add(normalized);
	}
	const seen = new Set<string>();
	const frozenAt = Date.parse(input.contract.familySplitFreeze?.frozenAt ?? "");
	if (!Number.isFinite(frozenAt))
		throw new Error("semantic execution contract freeze timestamp is invalid");
	for (const receipt of input.bundle.receipts) {
		const startedAt = Date.parse(receipt.startedAt);
		const completedAt = Date.parse(receipt.completedAt);
		const signedAt = Date.parse(receipt.signedAt);
		if (
			!engines.includes(receipt.engine) ||
			seen.has(receipt.engine) ||
			receipt.contractSha256 !== contractSha256 ||
			receipt.campaignSha256 !== campaignSha256 ||
			receipt.campaignRunSetSha256 !==
				semanticEngineRunSetSha256(campaign, receipt.engine) ||
			!Number.isFinite(startedAt) ||
			!Number.isFinite(completedAt) ||
			!Number.isFinite(signedAt) ||
			startedAt < frozenAt ||
			completedAt < startedAt ||
			signedAt < completedAt ||
			receipt.elapsedMs !== completedAt - startedAt ||
			(receipt.costDisclosure === "unknown") !==
				(receipt.estimatedCostUsd === null)
		)
			throw new Error("semantic execution receipt content is invalid");
		if (
			!hasValidEvidenceSignature(
				receipt,
				input.trustPolicy.executorPublicKeys[receipt.executor],
			)
		)
			throw new Error(
				"semantic execution receipt signature is untrusted or invalid",
			);
		seen.add(receipt.engine);
	}
	return {
		engineCount: engines.length,
		runCount: campaign.runs.length,
		costComplete: input.bundle.receipts.every(
			(receipt) => receipt.costDisclosure !== "unknown",
		),
	};
}
