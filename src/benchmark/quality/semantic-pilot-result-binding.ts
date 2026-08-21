import type { MemoryUpdateContract } from "./memory-update-contract.js";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import {
	type Rfc3161CommandRunner,
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
	type SemanticPilotDeliveryAcknowledgementBundle,
	validateSemanticPilotDeliveryAcknowledgements,
} from "./semantic-pilot-delivery-acknowledgement.js";
import {
	type SemanticPilotLaunchReceipt,
	validateSemanticPilotLaunchReceiptInternalConsistency,
} from "./semantic-pilot-launch.js";
import {
	type SemanticPowerReview,
	type SemanticPowerReviewTrustPolicy,
	validateSemanticPowerReview,
} from "./semantic-power-review.js";
import type { SemanticPublicTrustPolicy } from "./semantic-public-attestation.js";
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
	launchReceipt?: SemanticPilotLaunchReceipt;
	timestampCommandRunner?: Rfc3161CommandRunner;
	deliveryAcknowledgements?: SemanticPilotDeliveryAcknowledgementBundle;
	participantTrustPolicy?: SemanticPublicTrustPolicy;
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
	launchReceiptInternalConsistencyVerified: boolean;
	launchReceiptSha256?: string;
	timestampedAt?: string;
	participantDeliveryAcknowledgementSignaturesVerified: boolean;
	participantDeliveryChronologyClaimConsistent: boolean;
	acknowledgedParticipantSlotCount?: number;
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
	if (
		new Set([
			Boolean(input.timestampEvidence),
			Boolean(input.timestampTrustPolicy),
			Boolean(input.launchReceipt),
		]).size !== 1
	)
		throw new Error(
			"RFC 3161 timestamp evidence, verifier trust policy, and launch receipt must be supplied together",
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
				commandRunner: input.timestampCommandRunner,
			})
		: { priorAssignmentTimingVerified: false as const };
	const launch = input.launchReceipt
		? validateSemanticPilotLaunchReceiptInternalConsistency({
				collectionPlan: input.collectionPlan,
				receipt: input.launchReceipt,
				timestampEvidence: input.timestampEvidence as Rfc3161TimestampEvidence,
				verifiedTimestampedAt: timestamp.timestampedAt as string,
			})
		: { launchReceiptInternalConsistencyVerified: false as const };
	if (
		Boolean(input.deliveryAcknowledgements) !==
		Boolean(input.participantTrustPolicy)
	)
		throw new Error(
			"delivery acknowledgements and participant trust policy must be supplied together",
		);
	if (input.deliveryAcknowledgements && !input.launchReceipt)
		throw new Error("delivery acknowledgements require a launch receipt");
	const delivery = input.deliveryAcknowledgements
		? validateSemanticPilotDeliveryAcknowledgements({
				collectionPlan: input.collectionPlan,
				launchReceipt: input.launchReceipt as SemanticPilotLaunchReceipt,
				timestampEvidence: input.timestampEvidence as Rfc3161TimestampEvidence,
				verifiedTimestampedAt: timestamp.timestampedAt as string,
				bundle: input.deliveryAcknowledgements,
				trustPolicy: input.participantTrustPolicy as SemanticPublicTrustPolicy,
			})
		: { participantDeliveryAcknowledgementSignaturesVerified: false as const };
	if (input.deliveryAcknowledgements) {
		for (const acknowledgement of input.deliveryAcknowledgements
			.acknowledgements) {
			const participantCases = input.pilotContract.cases.filter(
				(item) =>
					item.language === acknowledgement.language &&
					(acknowledgement.role === "author"
						? item.provenance?.authorId === acknowledgement.signer
						: item.provenance?.reviewerId === acknowledgement.signer),
			);
			const deadlines = participantCases.map((item) =>
				Date.parse(
					acknowledgement.role === "author"
						? (item.provenance?.authoredAt ?? "")
						: (item.provenance?.reviewedAt ?? ""),
				),
			);
			if (
				deadlines.length === 0 ||
				deadlines.some((deadline) => !Number.isFinite(deadline)) ||
				Date.parse(acknowledgement.acknowledgedAt) > Math.min(...deadlines)
			)
				throw new Error(
					"semantic pilot delivery acknowledgement chronology claim is inconsistent",
				);
		}
	}
	return {
		...power,
		pilotCollectionBindingQualified: true,
		boundAssignmentCount: assignments.size,
		...timestamp,
		...launch,
		...delivery,
		participantDeliveryChronologyClaimConsistent: Boolean(
			input.deliveryAcknowledgements,
		),
	};
}
