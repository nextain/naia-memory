import { generateKeyPairSync, sign } from "node:crypto";
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
	type SemanticPowerReview,
	isSemanticPowerReview,
	validateSemanticPowerReview,
} from "./semantic-power-review.js";
import type { SemanticSampleSizeAssumptions } from "./semantic-sample-size-simulation.js";

function contract(split: "development" | "test", prefix: string) {
	const cases = (["ko", "en", "ja"] as const).map((language) => ({
		id: `${prefix}-${language}`,
		familyId: `${prefix}-family-${language}`,
		split,
		language,
		turns: [{ content: `${prefix} ${language}`, at: "2026-01-01T00:00:00Z" }],
		query: `${prefix} query ${language}`,
		expectedCurrentIds: ["current"],
		forbiddenStaleIds: ["stale"],
		expectedDeletedIds: [],
		noUpdateIds: [],
		expectedDecision: "update" as const,
		provenance: {
			authorId: `${prefix}-author-${language}`,
			constructionClusterId: `${prefix}-cluster-${language}`,
			authorNativeLanguages: [language],
			authoredAt: "2026-01-01T01:00:00Z",
			reviewerId: `${prefix}-native-reviewer-${language}`,
			reviewerNativeLanguages: [language],
			reviewedAt: "2026-01-01T02:00:00Z",
			reviewDecision: "accepted" as const,
		},
	}));
	return {
		schemaVersion: "naia-memory-update-contract-v1",
		tier: "semantic-update-interpretation",
		construction: "independent-native-reviewed",
		familySplitFreeze: {
			frozenAt: "2026-01-01T04:00:00Z",
			digest: computeFamilySplitDigest(cases) as `sha256:${string}`,
		},
		cases,
	} satisfies MemoryUpdateContract;
}

function fixture() {
	const pilotContract = contract("development", "pilot");
	const publicContract = contract("test", "public");
	const assumptions = {
		schemaVersion: "naia-memory-semantic-sample-size-assumptions-v4",
		languages: ["ko", "en", "ja"],
		competitors: ["mem0"],
		nullConstructionClusterExceedanceProbability: 0.5,
		alternativeConstructionClusterExceedanceProbability: {
			ko: { mem0: 0.7 },
			en: { mem0: 0.7 },
			ja: { mem0: 0.7 },
		},
		dependencyModel:
			"shared-uniform-within-cell-construction-cluster-shock-mixture",
		dependencyScenarios: [
			{ id: "independent", sharedCellShockProbability: 0 },
			{ id: "shock", sharedCellShockProbability: 0.1 },
		],
		candidateIndependentConstructionClustersByLanguage: [
			{ ko: 20, en: 20, ja: 20 },
		],
		simulationIterations: 1000,
		seed: 1,
		statement: "FROZEN_BEFORE_CAMPAIGN_EXECUTION",
	} satisfies SemanticSampleSizeAssumptions;
	const plan = {
		sampleSizeAssumptionsSha256: evidenceObjectSha256(assumptions),
		signedAt: "2026-01-02T00:00:00Z",
	} as SemanticAnalysisPlan;
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	const unsigned = {
		schemaVersion: "naia-memory-semantic-power-review-v1",
		reviewer: "external-power-reviewer",
		pilotContractSha256: evidenceObjectSha256(pilotContract),
		publicContractSha256: evidenceObjectSha256(publicContract),
		assumptionsSha256: evidenceObjectSha256(assumptions),
		pilotCompletedAt: "2026-01-01T03:00:00Z",
		reviewedAt: "2026-01-01T05:00:00Z",
		purpose: "POWER_ASSUMPTION_ESTIMATION_ONLY",
		verdict: "APPROVED_FOR_PREREGISTRATION_ONLY",
		independenceClaim: "ATTESTED_NOT_EMPIRICALLY_VERIFIED",
		constructionClusters: pilotContract.cases.map((item) => ({
			constructionClusterId: item.provenance.constructionClusterId,
			language: item.language,
			causeIds: [`source-${item.language}`, `editor-${item.language}`],
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
	const trustPolicy = {
		reviewerPublicKeys: {
			"external-power-reviewer": publicKey
				.export({ type: "spki", format: "pem" })
				.toString(),
		},
	};
	return {
		pilotContract,
		publicContract,
		assumptions,
		plan,
		review,
		trustPolicy,
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

describe("semantic power review", () => {
	it("qualifies disjoint pilot assumptions and reviewed construction causes", () => {
		const current = fixture();
		expect(isSemanticPowerReview(current.review)).toBe(true);
		expect(validateSemanticPowerReview(current)).toEqual({
			powerReviewQualified: true,
			reviewedConstructionClusterCount: 3,
			constructionCauseIndependenceVerified: false,
		});
	});

	it("rejects pilot content reused by the public corpus", () => {
		const current = fixture();
		current.publicContract.cases[0] = {
			...current.publicContract.cases[0],
			turns: current.pilotContract.cases[0]?.turns ?? [],
			query: current.pilotContract.cases[0]?.query ?? "",
		};
		current.review.publicContractSha256 = evidenceObjectSha256(
			current.publicContract,
		);
		resign(current);
		expect(() => validateSemanticPowerReview(current)).toThrow(
			"pilot and public case content overlap",
		);
	});

	it("rejects normalized pilot content reused with case and punctuation changes", () => {
		const current = fixture();
		const pilot = current.pilotContract.cases[0];
		const publicCase = current.publicContract.cases[0];
		if (!pilot || !publicCase) throw new Error("fixture case is missing");
		publicCase.turns = pilot.turns.map((turn) => ({
			...turn,
			content: `  ${turn.content.toLocaleUpperCase()}!!! `,
		}));
		publicCase.query = ` ${pilot.query.toLocaleUpperCase()}? `;
		current.review.publicContractSha256 = evidenceObjectSha256(
			current.publicContract,
		);
		resign(current);
		expect(() => validateSemanticPowerReview(current)).toThrow(
			"pilot and public case content overlap",
		);
	});

	it("rejects a power reviewer who participated in the pilot corpus", () => {
		const current = fixture();
		const pilotAuthor = current.pilotContract.cases[0]?.provenance?.authorId;
		if (!pilotAuthor) throw new Error("fixture provenance is missing");
		current.review.reviewer = pilotAuthor;
		current.trustPolicy.reviewerPublicKeys[pilotAuthor] =
			current.trustPolicy.reviewerPublicKeys["external-power-reviewer"] ?? "";
		resign(current);
		expect(() => validateSemanticPowerReview(current)).toThrow(
			"power reviewer is a pilot corpus participant",
		);
	});

	it("rejects a reviewer who overlaps another benchmark role", () => {
		const current = fixture();
		expect(() =>
			validateSemanticPowerReview({
				...current,
				forbiddenTrustIdentities: ["external-power-reviewer"],
			}),
		).toThrow("power reviewer overlaps another role");
	});

	it("rejects pilot corpus staff reused by the public corpus", () => {
		const current = fixture();
		const pilotAuthor = current.pilotContract.cases[0]?.provenance?.authorId;
		if (!pilotAuthor || !current.publicContract.cases[0]?.provenance)
			throw new Error("fixture provenance is missing");
		current.publicContract.cases[0].provenance.authorId = pilotAuthor;
		current.review.publicContractSha256 = evidenceObjectSha256(
			current.publicContract,
		);
		resign(current);
		expect(() => validateSemanticPowerReview(current)).toThrow(
			"pilot and public corpus roles overlap",
		);
	});

	it("rejects review performed after analysis preregistration", () => {
		const current = fixture();
		current.plan.signedAt = "2026-01-01T04:30:00Z";
		expect(() => validateSemanticPowerReview(current)).toThrow(
			"power review chronology is invalid",
		);
	});

	it("rejects malformed pilot review chronology", () => {
		const current = fixture();
		if (!current.pilotContract.cases[0]?.provenance)
			throw new Error("fixture provenance is missing");
		current.pilotContract.cases[0].provenance.reviewedAt = "not-a-date";
		current.review.pilotContractSha256 = evidenceObjectSha256(
			current.pilotContract,
		);
		resign(current);
		expect(() => validateSemanticPowerReview(current)).toThrow(
			"invalid provenance chronology",
		);
	});

	it("rejects a development-split public corpus", () => {
		const current = fixture();
		for (const item of current.publicContract.cases) item.split = "development";
		current.publicContract.familySplitFreeze.digest = computeFamilySplitDigest(
			current.publicContract.cases,
		) as `sha256:${string}`;
		current.review.publicContractSha256 = evidenceObjectSha256(
			current.publicContract,
		);
		resign(current);
		expect(() => validateSemanticPowerReview(current)).toThrow(
			"public corpus must contain test cases only",
		);
	});

	it("rejects a power reviewer who participated in the public corpus", () => {
		const current = fixture();
		const publicAuthor = current.publicContract.cases[0]?.provenance?.authorId;
		if (!publicAuthor) throw new Error("fixture provenance is missing");
		current.review.reviewer = publicAuthor;
		current.trustPolicy.reviewerPublicKeys[publicAuthor] =
			current.trustPolicy.reviewerPublicKeys["external-power-reviewer"] ?? "";
		resign(current);
		expect(() => validateSemanticPowerReview(current)).toThrow(
			"power reviewer is a public corpus participant",
		);
	});
});
