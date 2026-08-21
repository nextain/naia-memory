import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	evidenceObjectSha256,
	evidenceSignaturePayload,
} from "./public-evidence-crypto.js";
import {
	type SemanticPilotCollectionPlan,
	buildSemanticPilotCollectionPacket,
	buildSemanticPilotParticipantPacket,
} from "./semantic-pilot-collection-packet.js";
import {
	type SemanticPilotDeliveryAcknowledgement,
	validateSemanticPilotDeliveryAcknowledgements,
} from "./semantic-pilot-delivery-acknowledgement.js";
import type { SemanticPilotLaunchReceipt } from "./semantic-pilot-launch.js";

function fixture() {
	const languages = ["ko", "en", "ja"] as const;
	const collectionPlan: SemanticPilotCollectionPlan = {
		schemaVersion: "naia-memory-semantic-pilot-collection-plan-v1",
		publicContractSha256: "a".repeat(64),
		powerReviewerId: "power-reviewer",
		createdAt: "2026-01-01T00:00:00.000Z",
		assignments: languages.flatMap((language) =>
			["update", "delete", "no-update"].map((decision) => ({
				assignmentId: `${language}-${decision}`,
				language,
				decision: decision as "update" | "delete" | "no-update",
				authorId: `author-${language}`,
				reviewerId: `reviewer-${language}`,
				constructionClusterId: `cluster-${language}-${decision}`,
				causeIds: [`cause-${language}-${decision}`],
			})),
		),
	};
	const packet = buildSemanticPilotCollectionPacket(collectionPlan);
	const timestampEvidence = {
		tokenSha256: "b".repeat(64),
	};
	const launchReceiptCore = {
		schemaVersion: "naia-memory-semantic-pilot-launch-receipt-v1" as const,
		planSha256: packet.planSha256,
		packetSha256: packet.packetSha256,
		timestampTokenSha256: timestampEvidence.tokenSha256,
		timestampedAt: "2026-01-01T00:00:00.000Z",
		deliveryState: "DELIVERABLE_AFTER_TRUSTED_TIMESTAMP_VERIFICATION" as const,
		disclosureControl: "COMMAND_ENFORCED_NOT_OUT_OF_BAND_PROOF" as const,
		timestampTrustModel:
			"RFC3161_TOKEN_VERIFIED_AGAINST_OPERATOR_CONFIGURED_CA" as const,
	};
	const launchReceipt: SemanticPilotLaunchReceipt = {
		...launchReceiptCore,
		receiptSha256: evidenceObjectSha256(launchReceiptCore),
	};
	const authorPublicKeysByLanguage: Record<string, Record<string, string>> = {};
	const nativeReviewerPublicKeysByLanguage: Record<
		string,
		Record<string, string>
	> = {};
	const acknowledgements: SemanticPilotDeliveryAcknowledgement[] = [];
	for (const language of languages) {
		for (const role of ["author", "native-reviewer"] as const) {
			const signer = `${role === "author" ? "author" : "reviewer"}-${language}`;
			const { privateKey, publicKey } = generateKeyPairSync("ed25519");
			const keys =
				role === "author"
					? authorPublicKeysByLanguage
					: nativeReviewerPublicKeysByLanguage;
			keys[language] = {
				[signer]: publicKey.export({ type: "spki", format: "pem" }).toString(),
			};
			const unsigned = {
				schemaVersion:
					"naia-memory-semantic-pilot-delivery-acknowledgement-v1" as const,
				signer,
				role,
				language,
				planSha256: packet.planSha256,
				participantPacketSha256: buildSemanticPilotParticipantPacket(
					collectionPlan,
					role,
					signer,
				).participantPacketSha256,
				launchReceiptSha256: launchReceipt.receiptSha256,
				acknowledgedAt: "2026-01-01T01:00:00.000Z",
				statement: "EXACT_COLLECTION_PACKET_HASH_ACKNOWLEDGED" as const,
			};
			acknowledgements.push({
				...unsigned,
				signatureBase64: sign(
					null,
					evidenceSignaturePayload(unsigned),
					privateKey,
				).toString("base64"),
			});
		}
	}
	return {
		collectionPlan,
		launchReceipt,
		timestampEvidence,
		verifiedTimestampedAt: launchReceipt.timestampedAt,
		trustPolicy: {
			authorPublicKeysByLanguage,
			nativeReviewerPublicKeysByLanguage,
		},
		bundle: {
			schemaVersion:
				"naia-memory-semantic-pilot-delivery-acknowledgement-bundle-v1" as const,
			planSha256: packet.planSha256,
			launchReceiptSha256: launchReceipt.receiptSha256,
			acknowledgements,
		},
	};
}

describe("semantic pilot delivery acknowledgements", () => {
	it("requires trusted signatures from every assigned participant", () => {
		const current = fixture();
		expect(validateSemanticPilotDeliveryAcknowledgements(current)).toEqual({
			participantDeliveryAcknowledgementSignaturesVerified: true,
			acknowledgedParticipantSlotCount: 6,
		});
	});

	it("rejects missing participants and recomputed unsigned substitutions", () => {
		const missing = fixture();
		missing.bundle.acknowledgements.pop();
		expect(() =>
			validateSemanticPilotDeliveryAcknowledgements(missing),
		).toThrow("do not cover all participants");
		const substituted = fixture();
		substituted.bundle.acknowledgements[0].participantPacketSha256 = "c".repeat(
			64,
		);
		expect(() =>
			validateSemanticPilotDeliveryAcknowledgements(substituted),
		).toThrow("content is invalid");
	});

	it("rejects a different participant packet, unknown fields, and non-canonical time", () => {
		const swapped = fixture();
		swapped.bundle.acknowledgements[0].participantPacketSha256 =
			swapped.bundle.acknowledgements[2].participantPacketSha256;
		expect(() =>
			validateSemanticPilotDeliveryAcknowledgements(swapped),
		).toThrow("content is invalid");
		const extra = fixture();
		Object.assign(extra.bundle.acknowledgements[0], { unbound: true });
		expect(() => validateSemanticPilotDeliveryAcknowledgements(extra)).toThrow(
			"content is invalid",
		);
		const time = fixture();
		time.bundle.acknowledgements[0].acknowledgedAt = "2026-01-01 01:00:00";
		expect(() => validateSemanticPilotDeliveryAcknowledgements(time)).toThrow(
			"content is invalid",
		);
	});

	it("rejects acknowledgements claimed before launch and invalid launch time", () => {
		const beforeLaunch = fixture();
		beforeLaunch.bundle.acknowledgements[0].acknowledgedAt =
			"2025-12-31T23:59:59.999Z";
		expect(() =>
			validateSemanticPilotDeliveryAcknowledgements(beforeLaunch),
		).toThrow("content is invalid");
		const invalidLaunch = fixture();
		invalidLaunch.launchReceipt.receiptSha256 = "c".repeat(64);
		expect(() =>
			validateSemanticPilotDeliveryAcknowledgements(invalidLaunch),
		).toThrow("launch receipt hash mismatch");
	});

	it("rejects duplicate roles and signatures from the wrong trusted key", () => {
		const duplicate = fixture();
		duplicate.bundle.acknowledgements.push(
			duplicate.bundle.acknowledgements[0],
		);
		expect(() =>
			validateSemanticPilotDeliveryAcknowledgements(duplicate),
		).toThrow("duplicated");
		const wrongKey = fixture();
		wrongKey.trustPolicy.authorPublicKeysByLanguage.ko["author-ko"] =
			generateKeyPairSync("ed25519")
				.publicKey.export({
					type: "spki",
					format: "pem",
				})
				.toString();
		expect(() =>
			validateSemanticPilotDeliveryAcknowledgements(wrongKey),
		).toThrow("signature is untrusted or invalid");
	});
});
