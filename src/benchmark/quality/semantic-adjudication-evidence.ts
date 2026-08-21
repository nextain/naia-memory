import { createHash, createPublicKey } from "node:crypto";
import type { MemoryUpdateContract } from "./memory-update-contract.js";
import {
	evidenceObjectSha256,
	hasValidEvidenceSignature,
} from "./public-evidence-crypto.js";
import { scoreSemanticAdjudication } from "./semantic-adjudication-cli.js";

const SHA256 = /^[a-f0-9]{64}$/;

type AdjudicatorProfile =
	| { kind: "human"; nativeLanguages: string[] }
	| {
			kind: "model";
			languageCoverage: string[];
			provider: string;
			model: string;
			promptSha256: string;
	  };

export type SemanticAdjudicationReceipt = {
	schemaVersion: "naia-memory-semantic-adjudication-receipt-v1";
	adjudicatorId: string;
	contractSha256: string;
	campaignSha256: string;
	packetContentSha256: string;
	sealSha256: string;
	judgmentsFileSha256: string;
	completedAt: string;
	signedAt: string;
	statement: "BLINDED_JUDGMENTS_CONFIRMED";
	signatureBase64: string;
};

export type SemanticAdjudicationEvidenceBundle = {
	schemaVersion: "naia-memory-semantic-adjudication-evidence-bundle-v1";
	contractSha256: string;
	campaignSha256: string;
	packetContentSha256: string;
	sealSha256: string;
	judgmentsFileSha256: string;
	receipts: SemanticAdjudicationReceipt[];
};

export type SemanticAdjudicationTrustPolicy = {
	adjudicators: Record<
		string,
		{
			publicKey: string;
			independentOfEngines: string[];
			profile: AdjudicatorProfile;
		}
	>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256Bytes(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function validStrings(value: unknown): value is string[] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		new Set(value).size === value.length &&
		value.every((item) => typeof item === "string" && item.trim().length > 0)
	);
}

function isProfile(value: unknown): value is AdjudicatorProfile {
	if (!isRecord(value)) return false;
	if (value.kind === "human") return validStrings(value.nativeLanguages);
	return (
		value.kind === "model" &&
		validStrings(value.languageCoverage) &&
		typeof value.provider === "string" &&
		value.provider.trim().length > 0 &&
		typeof value.model === "string" &&
		value.model.trim().length > 0 &&
		typeof value.promptSha256 === "string" &&
		SHA256.test(value.promptSha256)
	);
}

function isEd25519Key(value: unknown): value is string {
	if (typeof value !== "string") return false;
	try {
		return createPublicKey(value).asymmetricKeyType === "ed25519";
	} catch {
		return false;
	}
}

export function isSemanticAdjudicationEvidenceBundle(
	value: unknown,
): value is SemanticAdjudicationEvidenceBundle {
	return (
		isRecord(value) &&
		value.schemaVersion ===
			"naia-memory-semantic-adjudication-evidence-bundle-v1" &&
		[
			"contractSha256",
			"campaignSha256",
			"packetContentSha256",
			"sealSha256",
			"judgmentsFileSha256",
		].every(
			(key) =>
				typeof value[key] === "string" && SHA256.test(value[key] as string),
		) &&
		Array.isArray(value.receipts) &&
		value.receipts.length > 0 &&
		value.receipts.every(
			(receipt) =>
				isRecord(receipt) &&
				receipt.schemaVersion ===
					"naia-memory-semantic-adjudication-receipt-v1" &&
				typeof receipt.adjudicatorId === "string" &&
				receipt.adjudicatorId.trim().length > 0 &&
				[
					"contractSha256",
					"campaignSha256",
					"packetContentSha256",
					"sealSha256",
					"judgmentsFileSha256",
				].every(
					(key) =>
						typeof receipt[key] === "string" &&
						SHA256.test(receipt[key] as string),
				) &&
				typeof receipt.completedAt === "string" &&
				typeof receipt.signedAt === "string" &&
				receipt.statement === "BLINDED_JUDGMENTS_CONFIRMED" &&
				typeof receipt.signatureBase64 === "string",
		)
	);
}

export function isSemanticAdjudicationTrustPolicy(
	value: unknown,
): value is SemanticAdjudicationTrustPolicy {
	return (
		isRecord(value) &&
		isRecord(value.adjudicators) &&
		Object.keys(value.adjudicators).length > 0 &&
		Object.entries(value.adjudicators).every(
			([identity, policy]) =>
				identity.trim().length > 0 &&
				isRecord(policy) &&
				isEd25519Key(policy.publicKey) &&
				validStrings(policy.independentOfEngines) &&
				isProfile(policy.profile),
		)
	);
}

function normalizedProfile(value: Record<string, unknown>): AdjudicatorProfile {
	if (value.kind === "model")
		return {
			kind: "model",
			languageCoverage: value.languageCoverage as string[],
			provider: String(value.provider),
			model: String(value.model),
			promptSha256: String(value.promptSha256),
		};
	return { kind: "human", nativeLanguages: value.nativeLanguages as string[] };
}

export function validateSemanticAdjudicationEvidence(input: {
	contract: MemoryUpdateContract;
	campaign: Record<string, unknown>;
	campaignBytes: Buffer;
	campaignDirectory: string;
	blindingSeed: string;
	packet: Parameters<typeof scoreSemanticAdjudication>[0]["packet"];
	seal: Parameters<typeof scoreSemanticAdjudication>[0]["seal"];
	judgmentsBytes: Buffer;
	bundle: SemanticAdjudicationEvidenceBundle;
	trustPolicy: SemanticAdjudicationTrustPolicy;
	forbiddenTrustIdentities?: Iterable<string>;
	forbiddenTrustPublicKeys?: Iterable<string>;
}) {
	const contractSha256 = evidenceObjectSha256(input.contract);
	const campaignSha256 = sha256Bytes(input.campaignBytes);
	const sealSha256 = evidenceObjectSha256(input.seal);
	const judgmentsFileSha256 = sha256Bytes(input.judgmentsBytes);
	const expected = {
		contractSha256,
		campaignSha256,
		packetContentSha256: input.packet.packetContentSha256,
		sealSha256,
		judgmentsFileSha256,
	};
	if (
		Object.entries(expected).some(
			([key, value]) => input.bundle[key as keyof typeof expected] !== value,
		)
	)
		throw new Error("semantic adjudication bundle is not bound to its inputs");
	const forbiddenIdentities = new Set(input.forbiddenTrustIdentities ?? []);
	const forbiddenKeys = new Set(
		[...(input.forbiddenTrustPublicKeys ?? [])].map((key) =>
			createPublicKey(key)
				.export({ type: "spki", format: "der" })
				.toString("base64"),
		),
	);
	const normalizedKeys = new Set<string>();
	for (const [identity, policy] of Object.entries(
		input.trustPolicy.adjudicators,
	)) {
		const normalized = createPublicKey(policy.publicKey)
			.export({ type: "spki", format: "der" })
			.toString("base64");
		if (normalizedKeys.has(normalized))
			throw new Error("semantic adjudication trust keys overlap");
		if (forbiddenIdentities.has(identity) || forbiddenKeys.has(normalized))
			throw new Error(
				"semantic adjudication trust overlaps another evidence role",
			);
		normalizedKeys.add(normalized);
	}
	const score = scoreSemanticAdjudication({
		contract: input.contract,
		campaign: input.campaign as Parameters<
			typeof scoreSemanticAdjudication
		>[0]["campaign"],
		campaignDirectory: input.campaignDirectory,
		blindingSeed: input.blindingSeed,
		contractSha256,
		campaignSha256,
		packet: input.packet,
		seal: input.seal,
		judgmentsBytes: input.judgmentsBytes,
	});
	const engines = (input.campaign.disclosure as { engines?: string[] })
		?.engines;
	if (!validStrings(engines))
		throw new Error("semantic adjudication campaign engines are invalid");
	const corpusIdentities = new Set(
		input.contract.cases.flatMap((item) =>
			item.provenance
				? [item.provenance.authorId, item.provenance.reviewerId]
				: [],
		),
	);
	const adjudicators = score.disclosure.adjudicators as Array<
		Record<string, unknown>
	>;
	if (input.bundle.receipts.length !== adjudicators.length)
		throw new Error("semantic adjudication receipts do not cover every judge");
	const byId = new Map(adjudicators.map((item) => [String(item.id), item]));
	const seen = new Set<string>();
	const frozenAt = Date.parse(input.contract.familySplitFreeze?.frozenAt ?? "");
	for (const receipt of input.bundle.receipts) {
		const adjudicator = byId.get(receipt.adjudicatorId);
		const policy = input.trustPolicy.adjudicators[receipt.adjudicatorId];
		const completedAt = Date.parse(receipt.completedAt);
		const signedAt = Date.parse(receipt.signedAt);
		if (
			!adjudicator ||
			!policy ||
			seen.has(receipt.adjudicatorId) ||
			corpusIdentities.has(receipt.adjudicatorId) ||
			Object.entries(expected).some(
				([key, value]) => receipt[key as keyof typeof expected] !== value,
			) ||
			policy.independentOfEngines.length !== engines.length ||
			engines.some((engine) => !policy.independentOfEngines.includes(engine)) ||
			evidenceObjectSha256(policy.profile) !==
				evidenceObjectSha256(normalizedProfile(adjudicator)) ||
			!Number.isFinite(frozenAt) ||
			!Number.isFinite(completedAt) ||
			!Number.isFinite(signedAt) ||
			completedAt < frozenAt ||
			receipt.completedAt !== adjudicator.completedAt ||
			signedAt < completedAt ||
			!hasValidEvidenceSignature(receipt, policy.publicKey)
		)
			throw new Error("semantic adjudication receipt content is invalid");
		seen.add(receipt.adjudicatorId);
	}
	const humanJudgedLanguages = [
		...new Set(
			adjudicators.flatMap((item) =>
				item.kind === "model" ? [] : (item.nativeLanguages as string[]),
			),
		),
	].sort();
	return {
		adjudicatorCount: adjudicators.length,
		humanJudgedLanguages,
		modelOnlyLanguages: [...new Set(score.samples.map((item) => item.language))]
			.filter((language) => !humanJudgedLanguages.includes(language))
			.sort(),
		score,
		evidenceScope: "signed-artifact-integrity-and-coverage" as const,
		blindnessVerified: false,
		organizationalIndependenceVerified: false,
		nativeLanguageStatusVerified: false,
		interRaterAgreementEvaluated: score.agreement !== null,
		disclosure:
			score.agreement === null
				? "Signatures prove artifact integrity, trusted-key control, role-key separation, and judgment coverage. They do not prove that adjudicators never saw the confidential seal, that the trust-policy issuer is organizationally independent, that declared native-language status was externally verified, or that multiple raters agreed."
				: "Signatures prove artifact integrity, trusted-key control, role-key separation, and complete eligible-rater coverage. Agreement is recomputed from signed per-rater judgments; it does not prove that adjudicators never saw the confidential seal, that the trust-policy issuer is organizationally independent, or that declared native-language status was externally verified.",
	};
}
