import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type MemoryUpdateContract,
	computeFamilySplitDigest,
} from "./memory-update-contract.js";
import {
	evidenceObjectSha256,
	evidenceSignaturePayload,
} from "./public-evidence-crypto.js";
import type { SemanticAnalysisPlan } from "./semantic-analysis-plan.js";
import {
	type SemanticPilotCollectionPlan,
	buildSemanticPilotParticipantPacket,
} from "./semantic-pilot-collection-packet.js";
import {
	type SemanticPilotDeliveryAcknowledgement,
	type SemanticPilotDeliveryAcknowledgementBundle,
	buildSemanticPilotDeliveryAcknowledgementBundle,
} from "./semantic-pilot-delivery-acknowledgement.js";
import { buildSemanticPilotLaunch } from "./semantic-pilot-launch.js";
import { validateSemanticPilotResultBinding } from "./semantic-pilot-result-binding.js";
import type { SemanticPowerReview } from "./semantic-power-review.js";
import type { SemanticSampleSizeAssumptions } from "./semantic-sample-size-simulation.js";

function fixture() {
	const languages = ["ko", "en", "ja"] as const;
	const decisions = ["update", "delete", "no-update"] as const;
	const pilotCases = languages.flatMap((language) =>
		decisions.map((decision) => ({
			id: `pilot-${language}-${decision}`,
			familyId: `pilot-family-${language}-${decision}`,
			split: "development" as const,
			language,
			turns: [
				{
					content: `pilot ${language} ${decision}`,
					at: "2026-01-02T00:00:00Z",
				},
			],
			query: `pilot query ${language} ${decision}`,
			expectedCurrentIds: ["current"],
			forbiddenStaleIds: ["stale"],
			expectedDeletedIds: decision === "delete" ? ["deleted"] : [],
			noUpdateIds: decision === "no-update" ? ["unchanged"] : [],
			expectedDecision: decision,
			provenance: {
				authorId: `pilot-author-${language}`,
				constructionClusterId: `pilot-cluster-${language}-${decision}`,
				authorNativeLanguages: [language],
				authoredAt: "2026-01-02T01:00:00Z",
				reviewerId: `pilot-reviewer-${language}`,
				reviewerNativeLanguages: [language],
				reviewedAt: "2026-01-02T02:00:00Z",
				reviewDecision: "accepted" as const,
			},
		})),
	);
	const makeContract = (cases: typeof pilotCases): MemoryUpdateContract => ({
		schemaVersion: "naia-memory-update-contract-v1",
		tier: "semantic-update-interpretation",
		construction: "independent-native-reviewed",
		familySplitFreeze: {
			frozenAt: "2026-01-02T03:00:00Z",
			digest: computeFamilySplitDigest(cases) as `sha256:${string}`,
		},
		cases,
	});
	const pilotContract = makeContract(pilotCases);
	const publicCases = pilotCases.map((item) => ({
		...item,
		id: item.id.replace("pilot", "public"),
		familyId: item.familyId.replace("pilot", "public"),
		split: "test" as const,
		turns: item.turns.map((turn) => ({
			...turn,
			content: `public ${turn.content}`,
		})),
		query: `public ${item.query}`,
		provenance: {
			...item.provenance,
			authorId: item.provenance.authorId.replace("pilot", "public"),
			reviewerId: item.provenance.reviewerId.replace("pilot", "public"),
			constructionClusterId: item.provenance.constructionClusterId.replace(
				"pilot",
				"public",
			),
		},
	}));
	const publicContract = makeContract(publicCases);
	const assumptions = {
		schemaVersion: "naia-memory-semantic-sample-size-assumptions-v4",
		languages: [...languages],
		competitors: ["mem0"],
		nullConstructionClusterExceedanceProbability: 0.5,
		alternativeConstructionClusterExceedanceProbability: {
			ko: { mem0: 0.7 },
			en: { mem0: 0.7 },
			ja: { mem0: 0.7 },
		},
		dependencyModel:
			"shared-uniform-within-cell-construction-cluster-shock-mixture",
		dependencyScenarios: [{ id: "independent", sharedCellShockProbability: 0 }],
		candidateIndependentConstructionClustersByLanguage: [
			{ ko: 20, en: 20, ja: 20 },
		],
		simulationIterations: 1000,
		seed: 1,
		statement: "FROZEN_BEFORE_CAMPAIGN_EXECUTION",
	} satisfies SemanticSampleSizeAssumptions;
	const plan = {
		sampleSizeAssumptionsSha256: evidenceObjectSha256(assumptions),
		signedAt: "2026-01-04T00:00:00Z",
	} as SemanticAnalysisPlan;
	const collectionPlan: SemanticPilotCollectionPlan = {
		schemaVersion: "naia-memory-semantic-pilot-collection-plan-v1",
		publicContractSha256: evidenceObjectSha256(publicContract),
		powerReviewerId: "external-power-reviewer",
		createdAt: "2026-01-01T00:00:00Z",
		assignments: pilotCases.map((item) => ({
			assignmentId: item.id,
			language: item.language,
			decision: item.expectedDecision,
			authorId: item.provenance.authorId,
			reviewerId: item.provenance.reviewerId,
			constructionClusterId: item.provenance.constructionClusterId,
			causeIds: [`source-${item.id}`, `editor-${item.id}`],
		})),
	};
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	const unsigned = {
		schemaVersion: "naia-memory-semantic-power-review-v1",
		reviewer: collectionPlan.powerReviewerId,
		pilotContractSha256: evidenceObjectSha256(pilotContract),
		publicContractSha256: evidenceObjectSha256(publicContract),
		assumptionsSha256: evidenceObjectSha256(assumptions),
		collectionPlanSha256: evidenceObjectSha256(collectionPlan),
		pilotCompletedAt: "2026-01-02T03:00:00Z",
		reviewedAt: "2026-01-03T00:00:00Z",
		purpose: "POWER_ASSUMPTION_ESTIMATION_ONLY",
		verdict: "APPROVED_FOR_PREREGISTRATION_ONLY",
		independenceClaim: "ATTESTED_NOT_EMPIRICALLY_VERIFIED",
		constructionClusters: collectionPlan.assignments.map((item) => ({
			constructionClusterId: item.constructionClusterId,
			language: item.language,
			causeIds: [...item.causeIds],
		})),
		statement: "PILOT_DISJOINTNESS_AND_CONSTRUCTION_CAUSES_REVIEWED",
	} as const;
	const review: SemanticPowerReview = {
		...unsigned,
		constructionClusters: [...unsigned.constructionClusters],
		signatureBase64: sign(
			null,
			evidenceSignaturePayload(unsigned),
			privateKey,
		).toString("base64"),
	};
	return {
		collectionPlan,
		pilotContract,
		publicContract,
		assumptions,
		plan,
		review,
		trustPolicy: {
			reviewerPublicKeys: {
				[review.reviewer]: publicKey
					.export({ type: "spki", format: "pem" })
					.toString(),
			},
		},
		privateKey,
	};
}

function resign(current: ReturnType<typeof fixture>): void {
	current.review.signatureBase64 = sign(
		null,
		evidenceSignaturePayload(current.review),
		current.privateKey,
	).toString("base64");
}

function resignPlanReview(current: ReturnType<typeof fixture>): void {
	current.review.collectionPlanSha256 = evidenceObjectSha256(
		current.collectionPlan,
	);
	resign(current);
}

function participantDeliveryEvidence(
	current: ReturnType<typeof fixture>,
	launchReceiptSha256: string,
	acknowledgedAt = "2026-01-01T01:00:00.000Z",
): {
	deliveryAcknowledgements: SemanticPilotDeliveryAcknowledgementBundle;
	participantTrustPolicy: {
		authorPublicKeysByLanguage: Record<string, Record<string, string>>;
		nativeReviewerPublicKeysByLanguage: Record<string, Record<string, string>>;
	};
} {
	const planSha256 = evidenceObjectSha256(current.collectionPlan);
	const authorPublicKeysByLanguage: Record<string, Record<string, string>> = {};
	const nativeReviewerPublicKeysByLanguage: Record<
		string,
		Record<string, string>
	> = {};
	const acknowledgements: SemanticPilotDeliveryAcknowledgement[] = [];
	for (const language of ["ko", "en", "ja"] as const) {
		for (const role of ["author", "native-reviewer"] as const) {
			const signer = `pilot-${role === "author" ? "author" : "reviewer"}-${language}`;
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
				planSha256,
				participantPacketSha256: buildSemanticPilotParticipantPacket(
					current.collectionPlan,
					role,
					signer,
				).participantPacketSha256,
				launchReceiptSha256,
				acknowledgedAt,
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
		deliveryAcknowledgements: buildSemanticPilotDeliveryAcknowledgementBundle({
			planSha256,
			launchReceiptSha256,
			acknowledgements,
		}),
		participantTrustPolicy: {
			authorPublicKeysByLanguage,
			nativeReviewerPublicKeysByLanguage,
		},
	};
}

describe("semantic pilot result binding", () => {
	it("binds a trusted prior timestamp and exact launch receipt through the result gate", () => {
		const current = fixture();
		const directory = mkdtempSync(join(tmpdir(), "naia-result-launch-"));
		const tokenPath = join(directory, "plan.tsr");
		const caPath = join(directory, "tsa-ca.pem");
		const token = Buffer.from("test timestamp response");
		const trustedCa = Buffer.from("test CA");
		writeFileSync(tokenPath, token);
		writeFileSync(caPath, trustedCa);
		const timestampEvidence = {
			schemaVersion: "naia-memory-rfc3161-timestamp-evidence-v1" as const,
			collectionPlanSha256: evidenceObjectSha256(current.collectionPlan),
			tokenSha256: createHash("sha256").update(token).digest("hex"),
			tokenPath,
		};
		const timestampTrustPolicy = {
			schemaVersion: "naia-memory-rfc3161-timestamp-trust-policy-v1" as const,
			trustedCaFilePath: caPath,
			trustedCaFileSha256: createHash("sha256").update(trustedCa).digest("hex"),
			requiredPolicyOid: "1.2.3.4",
		};
		const timestampCommandRunner = (args: string[]) =>
			args.includes("-verify")
				? { status: 0, stdout: "Verification: OK\n", stderr: "" }
				: {
						status: 0,
						stdout:
							"Status info:\nPolicy OID: 1.2.3.4\nTime stamp: Jan  1 00:00:00 2026 GMT\n",
						stderr: "",
					};
		const launch = buildSemanticPilotLaunch({
			collectionPlan: current.collectionPlan,
			timestampEvidence,
			timestampTrustPolicy,
			commandRunner: timestampCommandRunner,
		});
		const delivery = participantDeliveryEvidence(
			current,
			launch.receipt.receiptSha256,
		);

		expect(
			validateSemanticPilotResultBinding({
				...current,
				...delivery,
				timestampEvidence,
				timestampTrustPolicy,
				launchReceipt: launch.receipt,
				timestampCommandRunner,
			}),
		).toMatchObject({
			priorAssignmentTimingVerified: true,
			launchReceiptInternalConsistencyVerified: true,
			launchReceiptSha256: launch.receipt.receiptSha256,
			timestampedAt: "2026-01-01T00:00:00.000Z",
			participantDeliveryAcknowledgementSignaturesVerified: true,
			participantDeliveryChronologyClaimConsistent: true,
			acknowledgedParticipantSlotCount: 6,
		});

		const lateDelivery = participantDeliveryEvidence(
			current,
			launch.receipt.receiptSha256,
			"2026-01-03T00:00:00.000Z",
		);
		expect(() =>
			validateSemanticPilotResultBinding({
				...current,
				...lateDelivery,
				timestampEvidence,
				timestampTrustPolicy,
				launchReceipt: launch.receipt,
				timestampCommandRunner,
			}),
		).toThrow("chronology claim is inconsistent");
	});

	it("binds every completed result and reviewed cause to its prior assignment", () => {
		const current = fixture();
		expect(validateSemanticPilotResultBinding(current)).toMatchObject({
			powerReviewQualified: true,
			pilotCollectionBindingQualified: true,
			boundAssignmentCount: 9,
			constructionCauseIndependenceVerified: false,
			priorAssignmentTimingVerified: false,
			launchReceiptInternalConsistencyVerified: false,
		});
	});

	it("rejects an unsigned replacement collection plan", () => {
		const current = fixture();
		const assignment = current.collectionPlan.assignments[0];
		if (!assignment) throw new Error("assignment missing");
		assignment.authorId = "replacement-author";
		expect(() => validateSemanticPilotResultBinding(current)).toThrow(
			"semantic pilot signed collection plan hash mismatch",
		);
	});

	it("requires timestamp evidence, verifier trust policy, and receipt together", () => {
		const current = {
			...fixture(),
			timestampEvidence: {
				schemaVersion: "naia-memory-rfc3161-timestamp-evidence-v1" as const,
				collectionPlanSha256: "0".repeat(64),
				tokenSha256: "0".repeat(64),
				tokenPath: "unused.tsr",
			},
		};
		expect(() => validateSemanticPilotResultBinding(current)).toThrow(
			"evidence, verifier trust policy, and launch receipt must be supplied together",
		);
	});

	it("requires delivery acknowledgements and participant trust as a pair", () => {
		const current = fixture();
		expect(() =>
			validateSemanticPilotResultBinding({
				...current,
				participantTrustPolicy: {
					authorPublicKeysByLanguage: {},
					nativeReviewerPublicKeysByLanguage: {},
				},
			}),
		).toThrow("must be supplied together");
	});

	it.each([
		["language", "semantic pilot assignment language mismatch"],
		["decision", "semantic pilot assignment decision mismatch"],
		["author", "semantic pilot assignment author mismatch"],
		["reviewer", "semantic pilot assignment reviewer mismatch"],
		["cluster", "semantic pilot assignment cluster mismatch"],
	] as const)("rejects %s drift from the assignment", (field, message) => {
		const current = fixture();
		const assignment = current.collectionPlan.assignments[0];
		if (!assignment) throw new Error("assignment missing");
		if (field === "language") {
			const other = current.collectionPlan.assignments.find(
				(item) =>
					item.language === "en" && item.decision === assignment.decision,
			);
			if (!other) throw new Error("language swap assignment missing");
			[assignment.language, other.language] = [
				other.language,
				assignment.language,
			];
		}
		if (field === "decision") {
			const other = current.collectionPlan.assignments.find(
				(item) =>
					item.language === assignment.language && item.decision === "delete",
			);
			if (!other) throw new Error("decision swap assignment missing");
			[assignment.decision, other.decision] = [
				other.decision,
				assignment.decision,
			];
		}
		if (field === "author") assignment.authorId = "different-author";
		if (field === "reviewer") assignment.reviewerId = "different-reviewer";
		if (field === "cluster")
			assignment.constructionClusterId = "different-cluster";
		resignPlanReview(current);
		expect(() => validateSemanticPilotResultBinding(current)).toThrow(message);
	});

	it("rejects reviewed causes that differ from the collection plan", () => {
		const current = fixture();
		const cluster = current.review.constructionClusters[0];
		if (!cluster) throw new Error("cluster missing");
		cluster.causeIds = ["substituted-cause"];
		resign(current);
		expect(() => validateSemanticPilotResultBinding(current)).toThrow(
			"semantic pilot planned construction causes mismatch",
		);
	});

	it("rejects a result authored before the assignment plan", () => {
		const current = fixture();
		current.collectionPlan.createdAt = "2026-01-02T01:00:01Z";
		resignPlanReview(current);
		expect(() => validateSemanticPilotResultBinding(current)).toThrow(
			"semantic pilot assignment was created after authorship",
		);
	});

	it("rejects malformed collection and authorship timestamps", () => {
		const malformedPlan = fixture();
		malformedPlan.collectionPlan.createdAt = "not-a-date";
		resignPlanReview(malformedPlan);
		expect(() => validateSemanticPilotResultBinding(malformedPlan)).toThrow(
			"semantic pilot creation time is invalid",
		);

		const malformedResult = fixture();
		const result = malformedResult.pilotContract.cases[0];
		if (!result?.provenance) throw new Error("result provenance missing");
		result.provenance.authoredAt = "not-a-date";
		malformedResult.review.pilotContractSha256 = evidenceObjectSha256(
			malformedResult.pilotContract,
		);
		resign(malformedResult);
		expect(() => validateSemanticPilotResultBinding(malformedResult)).toThrow(
			"invalid provenance chronology",
		);
	});

	it("rejects duplicate assignment IDs before result matching", () => {
		const current = fixture();
		const first = current.collectionPlan.assignments[0];
		const second = current.collectionPlan.assignments[1];
		if (!first || !second) throw new Error("assignments missing");
		second.assignmentId = first.assignmentId;
		resignPlanReview(current);
		expect(() => validateSemanticPilotResultBinding(current)).toThrow(
			"semantic pilot assignment IDs must be unique",
		);
	});

	it("rejects a power reviewer different from the planned reviewer", () => {
		const current = fixture();
		current.collectionPlan.powerReviewerId = "different-power-reviewer";
		expect(() => validateSemanticPilotResultBinding(current)).toThrow(
			"semantic pilot planned power reviewer mismatch",
		);
	});
});
