import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import {
	type Rfc3161CommandRunner,
	type Rfc3161TimestampEvidence,
	type Rfc3161TimestampTrustPolicy,
	validateRfc3161TimestampBinding,
} from "./rfc3161-timestamp.js";
import {
	type SemanticPilotCollectionPlan,
	buildSemanticPilotCollectionPacket,
} from "./semantic-pilot-collection-packet.js";

export type SemanticPilotLaunchReceipt = {
	schemaVersion: "naia-memory-semantic-pilot-launch-receipt-v1";
	planSha256: string;
	packetSha256: string;
	timestampTokenSha256: string;
	timestampedAt: string;
	deliveryState: "DELIVERABLE_AFTER_TRUSTED_TIMESTAMP_VERIFICATION";
	disclosureControl: "COMMAND_ENFORCED_NOT_OUT_OF_BAND_PROOF";
	timestampTrustModel: "RFC3161_TOKEN_VERIFIED_AGAINST_OPERATOR_CONFIGURED_CA";
	receiptSha256: string;
};

export function validateSemanticPilotLaunchReceiptInternalConsistency(input: {
	collectionPlan: SemanticPilotCollectionPlan;
	receipt: SemanticPilotLaunchReceipt;
	timestampEvidence: Rfc3161TimestampEvidence;
	verifiedTimestampedAt: string;
}): {
	launchReceiptInternalConsistencyVerified: true;
	launchReceiptSha256: string;
} {
	if (
		typeof input.receipt !== "object" ||
		input.receipt === null ||
		Array.isArray(input.receipt) ||
		Object.keys(input.receipt).sort().join("\0") !==
			[
				"deliveryState",
				"disclosureControl",
				"packetSha256",
				"planSha256",
				"receiptSha256",
				"schemaVersion",
				"timestampTokenSha256",
				"timestampTrustModel",
				"timestampedAt",
			]
				.sort()
				.join("\0")
	)
		throw new Error("semantic pilot launch receipt shape is invalid");
	const packet = buildSemanticPilotCollectionPacket(input.collectionPlan);
	const { receiptSha256, ...receiptCore } = input.receipt;
	if (
		input.receipt.schemaVersion !==
			"naia-memory-semantic-pilot-launch-receipt-v1" ||
		input.receipt.deliveryState !==
			"DELIVERABLE_AFTER_TRUSTED_TIMESTAMP_VERIFICATION" ||
		input.receipt.disclosureControl !==
			"COMMAND_ENFORCED_NOT_OUT_OF_BAND_PROOF" ||
		input.receipt.timestampTrustModel !==
			"RFC3161_TOKEN_VERIFIED_AGAINST_OPERATOR_CONFIGURED_CA"
	)
		throw new Error("semantic pilot launch receipt shape is invalid");
	if (receiptSha256 !== evidenceObjectSha256(receiptCore))
		throw new Error("semantic pilot launch receipt hash mismatch");
	if (input.receipt.planSha256 !== packet.planSha256)
		throw new Error("semantic pilot launch plan hash mismatch");
	if (input.receipt.packetSha256 !== packet.packetSha256)
		throw new Error("semantic pilot launch packet hash mismatch");
	if (
		input.receipt.timestampTokenSha256 !== input.timestampEvidence.tokenSha256
	)
		throw new Error("semantic pilot launch timestamp token hash mismatch");
	if (input.receipt.timestampedAt !== input.verifiedTimestampedAt)
		throw new Error("semantic pilot launch timestamp time mismatch");
	return {
		launchReceiptInternalConsistencyVerified: true,
		launchReceiptSha256: receiptSha256,
	};
}

export function buildSemanticPilotLaunch(input: {
	collectionPlan: SemanticPilotCollectionPlan;
	timestampEvidence: Rfc3161TimestampEvidence;
	timestampTrustPolicy: Rfc3161TimestampTrustPolicy;
	commandRunner?: Rfc3161CommandRunner;
}) {
	const timestamp = validateRfc3161TimestampBinding({
		collectionPlan: input.collectionPlan,
		evidence: input.timestampEvidence,
		trustPolicy: input.timestampTrustPolicy,
		commandRunner: input.commandRunner,
	});
	const packet = buildSemanticPilotCollectionPacket(input.collectionPlan);
	const receiptCore = {
		schemaVersion: "naia-memory-semantic-pilot-launch-receipt-v1" as const,
		planSha256: packet.planSha256,
		packetSha256: packet.packetSha256,
		timestampTokenSha256: input.timestampEvidence.tokenSha256,
		timestampedAt: timestamp.timestampedAt,
		deliveryState: "DELIVERABLE_AFTER_TRUSTED_TIMESTAMP_VERIFICATION" as const,
		disclosureControl: "COMMAND_ENFORCED_NOT_OUT_OF_BAND_PROOF" as const,
		timestampTrustModel:
			"RFC3161_TOKEN_VERIFIED_AGAINST_OPERATOR_CONFIGURED_CA" as const,
	};
	const receipt: SemanticPilotLaunchReceipt = {
		...receiptCore,
		receiptSha256: evidenceObjectSha256(receiptCore),
	};
	return { receipt, packet };
}
