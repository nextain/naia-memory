import { createPublicKey } from "node:crypto";
import {
	evidenceObjectSha256,
	hasValidEvidenceSignature,
} from "./public-evidence-crypto.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const STRICT_TIME =
	/^(?:\d{4})-(?:\d{2})-(?:\d{2})T(?:\d{2}):(?:\d{2}):(?:\d{2})\.\d{3}Z$/u;

export const SEMANTIC_QUALIFICATION_SUBJECTS = [
	"contract",
	"campaign",
	"analysisPlan",
	"authorization",
	"timestampEvidence",
	"executionEvidence",
	"adjudicationEvidence",
] as const;

type SemanticQualificationSubject =
	(typeof SEMANTIC_QUALIFICATION_SUBJECTS)[number];

export type SemanticCompetitiveQualification = {
	schemaVersion: "naia-memory-semantic-competitive-qualification-v1";
	verdict: "qualified";
	deploymentId: string;
	trustStoreSha256: string;
	gateKeyId: string;
	subjects: Record<`${SemanticQualificationSubject}Sha256`, string>;
	authorizationWindow: {
		authorizedAt: string;
		expiresAt: string;
	};
	issuedAt: string;
	statement: "COMPETITIVE_CANDIDATE_VERIFIED_AGAINST_DEPLOYMENT_TRUST_STORE";
	signatureBase64: string;
};

export type SemanticQualificationTrustAnchor = {
	deploymentId: string;
	trustStoreSha256: string;
	gatePublicKeys: Record<string, string>;
};

export type SemanticQualificationSubjects = Record<
	SemanticQualificationSubject,
	unknown
>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validTime(value: unknown): number {
	if (typeof value !== "string" || !STRICT_TIME.test(value)) return Number.NaN;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
		? parsed
		: Number.NaN;
}

function validEd25519Key(value: unknown): value is string {
	if (typeof value !== "string") return false;
	try {
		return createPublicKey(value).asymmetricKeyType === "ed25519";
	} catch {
		return false;
	}
}

export function isSemanticCompetitiveQualification(
	value: unknown,
): value is SemanticCompetitiveQualification {
	if (!isRecord(value) || !isRecord(value.subjects)) return false;
	const window = value.authorizationWindow;
	return (
		value.schemaVersion ===
			"naia-memory-semantic-competitive-qualification-v1" &&
		value.verdict === "qualified" &&
		typeof value.deploymentId === "string" &&
		value.deploymentId.trim().length > 0 &&
		typeof value.trustStoreSha256 === "string" &&
		SHA256.test(value.trustStoreSha256) &&
		typeof value.gateKeyId === "string" &&
		value.gateKeyId.trim().length > 0 &&
		SEMANTIC_QUALIFICATION_SUBJECTS.every((subject) =>
			SHA256.test(value.subjects[`${subject}Sha256`] as string),
		) &&
		isRecord(window) &&
		Number.isFinite(validTime(window.authorizedAt)) &&
		Number.isFinite(validTime(window.expiresAt)) &&
		validTime(window.authorizedAt) < validTime(window.expiresAt) &&
		Number.isFinite(validTime(value.issuedAt)) &&
		value.statement ===
			"COMPETITIVE_CANDIDATE_VERIFIED_AGAINST_DEPLOYMENT_TRUST_STORE" &&
		typeof value.signatureBase64 === "string"
	);
}

export function validateSemanticCompetitiveQualification(input: {
	qualification: SemanticCompetitiveQualification;
	trustAnchor: SemanticQualificationTrustAnchor;
	subjects: SemanticQualificationSubjects;
	executionReceipts: Array<{ startedAt: string; completedAt: string }>;
}): {
	competitiveQualificationVerified: true;
	deploymentId: string;
	trustStoreSha256: string;
	gateKeyId: string;
} {
	const { qualification, trustAnchor } = input;
	if (!isSemanticCompetitiveQualification(qualification))
		throw new Error("semantic competitive qualification shape is invalid");
	const gatePublicKey = trustAnchor.gatePublicKeys[qualification.gateKeyId];
	if (
		!trustAnchor.deploymentId.trim() ||
		!SHA256.test(trustAnchor.trustStoreSha256) ||
		Object.keys(trustAnchor.gatePublicKeys).length === 0 ||
		!Object.values(trustAnchor.gatePublicKeys).every(validEd25519Key) ||
		qualification.deploymentId !== trustAnchor.deploymentId ||
		qualification.trustStoreSha256 !== trustAnchor.trustStoreSha256 ||
		!hasValidEvidenceSignature(qualification, gatePublicKey)
	)
		throw new Error(
			"semantic competitive qualification is not signed by the pinned deployment",
		);
	for (const subject of SEMANTIC_QUALIFICATION_SUBJECTS) {
		if (
			qualification.subjects[`${subject}Sha256`] !==
			evidenceObjectSha256(input.subjects[subject])
		)
			throw new Error(
				`semantic competitive qualification subject mismatch: ${subject}`,
			);
	}
	const campaign = input.subjects.campaign;
	if (
		!isRecord(campaign) ||
		campaign.schemaVersion !== "naia-memory-semantic-campaign-v5" ||
		!isRecord(campaign.disclosure) ||
		campaign.disclosure.eligibility !== "competitive-candidate"
	)
		throw new Error(
			"semantic competitive qualification requires a v5 competitive candidate",
		);
	const authorization = input.subjects.authorization;
	if (
		!isRecord(authorization) ||
		authorization.authorizedAt !==
			qualification.authorizationWindow.authorizedAt ||
		authorization.expiresAt !== qualification.authorizationWindow.expiresAt
	)
		throw new Error(
			"semantic competitive qualification authorization window mismatch",
		);
	const authorizedAt = validTime(
		qualification.authorizationWindow.authorizedAt,
	);
	const expiresAt = validTime(qualification.authorizationWindow.expiresAt);
	const issuedAt = validTime(qualification.issuedAt);
	if (issuedAt < authorizedAt || issuedAt < expiresAt)
		throw new Error("semantic competitive qualification issuance is premature");
	if (input.executionReceipts.length === 0)
		throw new Error(
			"semantic competitive qualification has no execution receipts",
		);
	for (const receipt of input.executionReceipts) {
		const startedAt = validTime(receipt.startedAt);
		const completedAt = validTime(receipt.completedAt);
		if (
			!Number.isFinite(startedAt) ||
			!Number.isFinite(completedAt) ||
			startedAt < authorizedAt ||
			completedAt < startedAt ||
			completedAt >= expiresAt
		)
			throw new Error(
				"semantic competitive execution is outside the authorization window",
			);
	}
	return {
		competitiveQualificationVerified: true,
		deploymentId: qualification.deploymentId,
		trustStoreSha256: qualification.trustStoreSha256,
		gateKeyId: qualification.gateKeyId,
	};
}
