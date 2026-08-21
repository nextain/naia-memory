import {
	MEMORY_UPDATE_LANGUAGES,
	SEMANTIC_DIAGNOSTIC_DECISIONS,
} from "./memory-update-contract.js";
import {
	canonicalEvidenceJson,
	evidenceObjectSha256,
} from "./public-evidence-crypto.js";

export type SemanticPilotAssignment = {
	assignmentId: string;
	language: "ko" | "en" | "ja";
	decision: "update" | "delete" | "no-update";
	authorId: string;
	reviewerId: string;
	constructionClusterId: string;
	causeIds: string[];
};

export type SemanticPilotCollectionPlan = {
	schemaVersion: "naia-memory-semantic-pilot-collection-plan-v1";
	publicContractSha256: string;
	powerReviewerId: string;
	createdAt: string;
	assignments: SemanticPilotAssignment[];
};

export type SemanticPilotCollectionPacket = {
	schemaVersion: "naia-memory-semantic-pilot-collection-packet-v1";
	planSha256: string;
	publicContractSha256: string;
	createdAt: string;
	purpose: "PILOT_COLLECTION_INSTRUCTIONS_ONLY";
	qualityClaim: "NOT_EVIDENCE_UNTIL_COMPLETED_REVIEWED_AND_SIGNED";
	authorPackets: Array<{
		participantId: string;
		assignments: Array<
			Omit<SemanticPilotAssignment, "authorId" | "reviewerId">
		>;
	}>;
	reviewerPackets: Array<{
		participantId: string;
		assignments: Array<
			Omit<SemanticPilotAssignment, "authorId" | "reviewerId">
		>;
	}>;
	packetSha256: string;
};

const SHA256 = /^[a-f0-9]{64}$/;

function assertUnique(values: string[], label: string): void {
	if (new Set(values).size !== values.length)
		throw new Error(`semantic pilot ${label} must be unique`);
}

function assertCanonicalIdentifier(
	value: unknown,
	label: string,
): asserts value is string {
	if (typeof value !== "string" || !value || value !== value.trim())
		throw new Error(`semantic pilot ${label} is invalid`);
}

function groupedPackets<T extends "authorId" | "reviewerId">(
	assignments: SemanticPilotAssignment[],
	role: T,
): Array<{
	participantId: string;
	assignments: Array<Omit<SemanticPilotAssignment, "authorId" | "reviewerId">>;
}> {
	const grouped = new Map<
		string,
		Array<Omit<SemanticPilotAssignment, "authorId" | "reviewerId">>
	>();
	for (const assignment of assignments) {
		const participantId = assignment[role];
		const {
			authorId: _authorId,
			reviewerId: _reviewerId,
			...sanitized
		} = assignment;
		const current = grouped.get(participantId) ?? [];
		current.push(sanitized);
		grouped.set(participantId, current);
	}
	return [...grouped]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([participantId, items]) => ({
			participantId,
			assignments: items.sort((left, right) =>
				left.assignmentId.localeCompare(right.assignmentId),
			),
		}));
}

export function buildSemanticPilotCollectionPacket(
	plan: SemanticPilotCollectionPlan,
): SemanticPilotCollectionPacket {
	if (plan === null || typeof plan !== "object" || Array.isArray(plan))
		throw new Error("semantic pilot plan root is invalid");
	if (plan.schemaVersion !== "naia-memory-semantic-pilot-collection-plan-v1")
		throw new Error("semantic pilot plan schema is invalid");
	assertCanonicalIdentifier(plan.powerReviewerId, "power reviewer");
	if (!SHA256.test(plan.publicContractSha256))
		throw new Error("semantic pilot public contract hash is invalid");
	if (!Number.isFinite(Date.parse(plan.createdAt)))
		throw new Error("semantic pilot creation time is invalid");
	if (!Array.isArray(plan.assignments) || plan.assignments.length === 0)
		throw new Error("semantic pilot assignments are empty");
	for (const item of plan.assignments) {
		if (item === null || typeof item !== "object" || Array.isArray(item))
			throw new Error("semantic pilot assignment content is invalid");
		assertCanonicalIdentifier(item.assignmentId, "assignment ID");
		assertCanonicalIdentifier(item.authorId, "author ID");
		assertCanonicalIdentifier(item.reviewerId, "reviewer ID");
		assertCanonicalIdentifier(
			item.constructionClusterId,
			"construction cluster",
		);
	}
	assertUnique(
		plan.assignments.map((item) => item.assignmentId),
		"assignment IDs",
	);
	assertUnique(
		plan.assignments.map((item) => item.constructionClusterId),
		"construction clusters",
	);
	const authors = new Set(plan.assignments.map((item) => item.authorId));
	const reviewers = new Set(plan.assignments.map((item) => item.reviewerId));
	if ([...authors].some((identity) => reviewers.has(identity)))
		throw new Error("semantic pilot author and reviewer roles overlap");
	if (authors.has(plan.powerReviewerId) || reviewers.has(plan.powerReviewerId))
		throw new Error("semantic pilot power reviewer overlaps collection roles");
	for (const item of plan.assignments) {
		if (
			!Array.isArray(item.causeIds) ||
			item.causeIds.length === 0 ||
			item.causeIds.some(
				(cause) =>
					typeof cause !== "string" || !cause || cause !== cause.trim(),
			) ||
			!MEMORY_UPDATE_LANGUAGES.includes(item.language) ||
			!SEMANTIC_DIAGNOSTIC_DECISIONS.includes(item.decision)
		)
			throw new Error("semantic pilot assignment content is invalid");
		assertUnique(item.causeIds, `${item.assignmentId} cause IDs`);
	}
	for (const language of MEMORY_UPDATE_LANGUAGES)
		for (const decision of SEMANTIC_DIAGNOSTIC_DECISIONS)
			if (
				!plan.assignments.some(
					(item) => item.language === language && item.decision === decision,
				)
			)
				throw new Error(
					`semantic pilot assignments require ${language}/${decision}`,
				);
	const planSha256 = evidenceObjectSha256(plan);
	const core = {
		schemaVersion: "naia-memory-semantic-pilot-collection-packet-v1" as const,
		planSha256,
		publicContractSha256: plan.publicContractSha256,
		createdAt: plan.createdAt,
		purpose: "PILOT_COLLECTION_INSTRUCTIONS_ONLY" as const,
		qualityClaim: "NOT_EVIDENCE_UNTIL_COMPLETED_REVIEWED_AND_SIGNED" as const,
		authorPackets: groupedPackets(plan.assignments, "authorId"),
		reviewerPackets: groupedPackets(plan.assignments, "reviewerId"),
	};
	// Exercise canonical serialization here so non-JSON values fail before delivery.
	canonicalEvidenceJson(core);
	return { ...core, packetSha256: evidenceObjectSha256(core) };
}
