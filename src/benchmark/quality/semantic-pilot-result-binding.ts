import type { MemoryUpdateContract } from "./memory-update-contract.js";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import {
	type Rfc3161TimestampEvidence,
	type Rfc3161TimestampTrustPolicy,
	validateRfc3161PriorExistence,
} from "./rfc3161-timestamp.js";
import type { SemanticAnalysisPlan } from "./semantic-analysis-plan.js";
import {
	type SemanticPilotCollectionPlan,
	buildSemanticPilotCollectionPacket,
} from "./semantic-pilot-collection-packet.js";
import {
	type SemanticPowerReview,
	type SemanticPowerReviewTrustPolicy,
	validateSemanticPowerReview,
} from "./semantic-power-review.js";
import type { SemanticSampleSizeAssumptions } from "./semantic-sample-size-simulation.js";

export type SemanticPilotResultBindingInput = {
	collectionPlan: SemanticPilotCollectionPlan;
	pilotContract: MemoryUpdateContract;
	publicContract: MemoryUpdateContract;
	assumptions: SemanticSampleSizeAssumptions;
	plan: SemanticAnalysisPlan;
	review: SemanticPowerReview;
	trustPolicy: SemanticPowerReviewTrustPolicy;
	forbiddenTrustIdentities?: Iterable<string>;
	forbiddenTrustPublicKeys?: Iterable<string>;
	timestampEvidence?: Rfc3161TimestampEvidence;
	timestampTrustPolicy?: Rfc3161TimestampTrustPolicy;
};

function sameIdentifiers(left: string[], right: string[]): boolean {
	const sortedLeft = [...left].sort();
	const sortedRight = [...right].sort();
	return (
		sortedLeft.length === sortedRight.length &&
		sortedLeft.every((value, index) => value === sortedRight[index])
	);
}

export function validateSemanticPilotResultBinding(
	input: SemanticPilotResultBindingInput,
): {
	powerReviewQualified: true;
	pilotCollectionBindingQualified: true;
	boundAssignmentCount: number;
	reviewedConstructionClusterCount: number;
	constructionCauseIndependenceVerified: false;
	priorAssignmentTimingVerified: boolean;
	timestampedAt?: string;
} {
	buildSemanticPilotCollectionPacket(input.collectionPlan);
	if (
		input.collectionPlan.publicContractSha256 !==
		evidenceObjectSha256(input.publicContract)
	)
		throw new Error("semantic pilot collection plan public contract mismatch");
	if (input.collectionPlan.powerReviewerId !== input.review.reviewer)
		throw new Error("semantic pilot planned power reviewer mismatch");
	if (
		input.review.collectionPlanSha256 !==
		evidenceObjectSha256(input.collectionPlan)
	)
		throw new Error("semantic pilot signed collection plan hash mismatch");

	const power = validateSemanticPowerReview(input);
	const assignments = new Map(
		input.collectionPlan.assignments.map((item) => [item.assignmentId, item]),
	);
	if (assignments.size !== input.collectionPlan.assignments.length)
		throw new Error("semantic pilot assignment IDs are duplicated");
	if (
		input.collectionPlan.assignments.length !== input.pilotContract.cases.length
	)
		throw new Error("semantic pilot assignment and result counts differ");
	const createdAt = Date.parse(input.collectionPlan.createdAt);
	if (!Number.isFinite(createdAt))
		throw new Error("semantic pilot assignment creation time is invalid");
	for (const result of input.pilotContract.cases) {
		const assignment = assignments.get(result.id);
		if (!assignment)
			throw new Error(`semantic pilot result has no assignment: ${result.id}`);
		const provenance = result.provenance;
		if (!provenance)
			throw new Error(
				`semantic pilot result provenance is missing: ${result.id}`,
			);
		if (assignment.language !== result.language)
			throw new Error(
				`semantic pilot assignment language mismatch: ${result.id}`,
			);
		if (assignment.decision !== result.expectedDecision)
			throw new Error(
				`semantic pilot assignment decision mismatch: ${result.id}`,
			);
		if (assignment.authorId !== provenance.authorId)
			throw new Error(
				`semantic pilot assignment author mismatch: ${result.id}`,
			);
		if (assignment.reviewerId !== provenance.reviewerId)
			throw new Error(
				`semantic pilot assignment reviewer mismatch: ${result.id}`,
			);
		if (assignment.constructionClusterId !== provenance.constructionClusterId)
			throw new Error(
				`semantic pilot assignment cluster mismatch: ${result.id}`,
			);
		const authoredAt = Date.parse(provenance.authoredAt);
		if (!Number.isFinite(authoredAt) || createdAt > authoredAt)
			throw new Error(
				`semantic pilot assignment was created after authorship: ${result.id}`,
			);
	}

	const reviewedClusters = new Map(
		input.review.constructionClusters.map((item) => [
			item.constructionClusterId,
			item,
		]),
	);
	for (const assignment of input.collectionPlan.assignments) {
		const reviewed = reviewedClusters.get(assignment.constructionClusterId);
		if (!reviewed)
			throw new Error(
				`semantic pilot planned cluster was not reviewed: ${assignment.constructionClusterId}`,
			);
		if (
			reviewed.language !== assignment.language ||
			!sameIdentifiers(reviewed.causeIds, assignment.causeIds)
		)
			throw new Error(
				`semantic pilot planned construction causes mismatch: ${assignment.constructionClusterId}`,
			);
	}
	if (Boolean(input.timestampEvidence) !== Boolean(input.timestampTrustPolicy))
		throw new Error(
			"RFC 3161 timestamp evidence and verifier trust policy must be supplied together",
		);
	const timestamp = input.timestampEvidence
		? validateRfc3161PriorExistence({
				collectionPlan: input.collectionPlan,
				evidence: input.timestampEvidence,
				trustPolicy: input.timestampTrustPolicy as Rfc3161TimestampTrustPolicy,
				earliestAuthoredAt: new Date(
					Math.min(
						...input.pilotContract.cases.map((item) =>
							Date.parse(item.provenance?.authoredAt ?? ""),
						),
					),
				).toISOString(),
			})
		: { priorAssignmentTimingVerified: false as const };
	return {
		...power,
		pilotCollectionBindingQualified: true,
		boundAssignmentCount: assignments.size,
		...timestamp,
	};
}
