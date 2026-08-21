import { hasValidEvidenceSignature } from "./public-evidence-crypto.js";
import type { Rfc3161TimestampEvidence } from "./rfc3161-timestamp.js";
import type { SemanticPilotCollectionPlan } from "./semantic-pilot-collection-packet.js";
import {
	buildSemanticPilotCollectionPacket,
	buildSemanticPilotParticipantPacket,
} from "./semantic-pilot-collection-packet.js";
import type { SemanticPilotLaunchReceipt } from "./semantic-pilot-launch.js";
import { validateSemanticPilotLaunchReceiptInternalConsistency } from "./semantic-pilot-launch.js";
import type { SemanticPublicTrustPolicy } from "./semantic-public-attestation.js";
import { validateSemanticPublicTrustPolicy } from "./semantic-public-attestation.js";

export type SemanticPilotDeliveryAcknowledgement = {
	schemaVersion: "naia-memory-semantic-pilot-delivery-acknowledgement-v1";
	signer: string;
	role: "author" | "native-reviewer";
	language: "ko" | "en" | "ja";
	planSha256: string;
	participantPacketSha256: string;
	launchReceiptSha256: string;
	acknowledgedAt: string;
	statement: "EXACT_COLLECTION_PACKET_HASH_ACKNOWLEDGED";
	signatureBase64: string;
};

export type SemanticPilotDeliveryAcknowledgementBundle = {
	schemaVersion: "naia-memory-semantic-pilot-delivery-acknowledgement-bundle-v1";
	planSha256: string;
	launchReceiptSha256: string;
	acknowledgements: SemanticPilotDeliveryAcknowledgement[];
};

function participantKey(
	role: string,
	language: string,
	signer: string,
): string {
	return JSON.stringify([role, language, signer]);
}

const UTC_RFC3339_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function hasExactKeys(value: object, expected: string[]): boolean {
	return (
		JSON.stringify(Object.keys(value).sort()) ===
		JSON.stringify([...expected].sort())
	);
}

export function validateSemanticPilotDeliveryAcknowledgements(input: {
	collectionPlan: SemanticPilotCollectionPlan;
	launchReceipt: SemanticPilotLaunchReceipt;
	timestampEvidence: Rfc3161TimestampEvidence;
	verifiedTimestampedAt: string;
	bundle: SemanticPilotDeliveryAcknowledgementBundle;
	trustPolicy: SemanticPublicTrustPolicy;
}): {
	participantDeliveryAcknowledgementSignaturesVerified: true;
	acknowledgedParticipantSlotCount: number;
} {
	if (
		typeof input.bundle !== "object" ||
		input.bundle === null ||
		Array.isArray(input.bundle)
	)
		throw new Error(
			"semantic pilot delivery acknowledgement bundle binding is invalid",
		);
	const packet = buildSemanticPilotCollectionPacket(input.collectionPlan);
	validateSemanticPilotLaunchReceiptInternalConsistency({
		collectionPlan: input.collectionPlan,
		receipt: input.launchReceipt,
		timestampEvidence: input.timestampEvidence,
		verifiedTimestampedAt: input.verifiedTimestampedAt,
	});
	const receiptSha256 = input.launchReceipt.receiptSha256;
	if (
		!UTC_RFC3339_TIME.test(input.launchReceipt.timestampedAt) ||
		!Number.isFinite(Date.parse(input.launchReceipt.timestampedAt))
	)
		throw new Error("semantic pilot launch receipt timestamp is invalid");
	if (
		input.bundle.schemaVersion !==
			"naia-memory-semantic-pilot-delivery-acknowledgement-bundle-v1" ||
		!hasExactKeys(input.bundle, [
			"schemaVersion",
			"planSha256",
			"launchReceiptSha256",
			"acknowledgements",
		]) ||
		input.bundle.planSha256 !== packet.planSha256 ||
		input.bundle.launchReceiptSha256 !== receiptSha256 ||
		!Array.isArray(input.bundle.acknowledgements)
	)
		throw new Error(
			"semantic pilot delivery acknowledgement bundle binding is invalid",
		);
	validateSemanticPublicTrustPolicy(input.trustPolicy);
	const expected = new Set<string>();
	for (const assignment of input.collectionPlan.assignments) {
		expected.add(
			participantKey("author", assignment.language, assignment.authorId),
		);
		expected.add(
			participantKey(
				"native-reviewer",
				assignment.language,
				assignment.reviewerId,
			),
		);
	}
	const seen = new Set<string>();
	for (const acknowledgement of input.bundle.acknowledgements) {
		if (
			acknowledgement === null ||
			typeof acknowledgement !== "object" ||
			Array.isArray(acknowledgement)
		)
			throw new Error(
				"semantic pilot delivery acknowledgement content is invalid",
			);
		const key = participantKey(
			acknowledgement.role,
			acknowledgement.language,
			acknowledgement.signer,
		);
		if (
			!hasExactKeys(acknowledgement, [
				"schemaVersion",
				"signer",
				"role",
				"language",
				"planSha256",
				"participantPacketSha256",
				"launchReceiptSha256",
				"acknowledgedAt",
				"statement",
				"signatureBase64",
			]) ||
			acknowledgement.schemaVersion !==
				"naia-memory-semantic-pilot-delivery-acknowledgement-v1" ||
			!expected.has(key) ||
			acknowledgement.planSha256 !== packet.planSha256 ||
			acknowledgement.participantPacketSha256 !==
				buildSemanticPilotParticipantPacket(
					input.collectionPlan,
					acknowledgement.role,
					acknowledgement.signer,
				).participantPacketSha256 ||
			acknowledgement.launchReceiptSha256 !== receiptSha256 ||
			acknowledgement.statement !==
				"EXACT_COLLECTION_PACKET_HASH_ACKNOWLEDGED" ||
			!UTC_RFC3339_TIME.test(acknowledgement.acknowledgedAt) ||
			!Number.isFinite(Date.parse(acknowledgement.acknowledgedAt)) ||
			Date.parse(acknowledgement.acknowledgedAt) <
				Date.parse(input.launchReceipt.timestampedAt)
		)
			throw new Error(
				"semantic pilot delivery acknowledgement content is invalid",
			);
		if (seen.has(key))
			throw new Error("semantic pilot delivery acknowledgement is duplicated");
		seen.add(key);
		const publicKey =
			acknowledgement.role === "author"
				? input.trustPolicy.authorPublicKeysByLanguage[
						acknowledgement.language
					]?.[acknowledgement.signer]
				: input.trustPolicy.nativeReviewerPublicKeysByLanguage[
						acknowledgement.language
					]?.[acknowledgement.signer];
		if (!hasValidEvidenceSignature(acknowledgement, publicKey))
			throw new Error(
				"semantic pilot delivery acknowledgement signature is untrusted or invalid",
			);
	}
	if (
		seen.size !== expected.size ||
		[...expected].some((key) => !seen.has(key))
	)
		throw new Error(
			"semantic pilot delivery acknowledgements do not cover all participants",
		);
	return {
		participantDeliveryAcknowledgementSignaturesVerified: true,
		acknowledgedParticipantSlotCount: seen.size,
	};
}
