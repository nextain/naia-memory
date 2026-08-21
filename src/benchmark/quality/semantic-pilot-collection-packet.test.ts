import { describe, expect, it } from "vitest";
import {
	type SemanticPilotCollectionPlan,
	buildSemanticPilotCollectionPacket,
} from "./semantic-pilot-collection-packet.js";

function plan(): SemanticPilotCollectionPlan {
	const assignments = (["ko", "en", "ja"] as const).flatMap((language) =>
		(["update", "delete", "no-update"] as const).map((decision) => ({
			assignmentId: `${language}-${decision}-1`,
			language,
			decision,
			authorId: `author-${language}`,
			reviewerId: `reviewer-${language}`,
			constructionClusterId: `cluster-${language}-${decision}-1`,
			causeIds: [`cause-${decision}`],
		})),
	);
	return {
		schemaVersion: "naia-memory-semantic-pilot-collection-plan-v1",
		publicContractSha256: "a".repeat(64),
		powerReviewerId: "power-reviewer",
		createdAt: "2026-08-21T00:00:00Z",
		assignments,
	};
}

function assignmentAt(
	current: SemanticPilotCollectionPlan,
	index: number,
): SemanticPilotCollectionPlan["assignments"][number] {
	const assignment = current.assignments[index];
	if (!assignment) throw new Error(`missing fixture assignment ${index}`);
	return assignment;
}

describe("semantic pilot collection packet", () => {
	it("builds deterministic role-separated packets bound to the public contract", () => {
		const current = plan();
		const packet = buildSemanticPilotCollectionPacket(current);
		expect(packet).toEqual(buildSemanticPilotCollectionPacket(current));
		for (const rolePacket of [
			...packet.authorPackets,
			...packet.reviewerPackets,
		]) {
			expect(rolePacket.assignments.length).toBeGreaterThan(0);
			for (const assignment of rolePacket.assignments) {
				expect(assignment).not.toHaveProperty("authorId");
				expect(assignment).not.toHaveProperty("reviewerId");
			}
		}
		expect(packet.purpose).toBe("PILOT_COLLECTION_INSTRUCTIONS_ONLY");
		expect(packet.qualityClaim).toBe(
			"NOT_EVIDENCE_UNTIL_COMPLETED_REVIEWED_AND_SIGNED",
		);
		expect(packet.planSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(packet.packetSha256).toMatch(/^[a-f0-9]{64}$/);
	});

	it("rejects whitespace-variant identifiers before uniqueness checks", () => {
		const current = plan();
		assignmentAt(current, 1).assignmentId =
			` ${assignmentAt(current, 0).assignmentId}`;
		expect(() => buildSemanticPilotCollectionPacket(current)).toThrow(
			"assignment ID is invalid",
		);
	});

	it("rejects collection-role overlap", () => {
		const current = plan();
		assignmentAt(current, 0).reviewerId = "author-en";
		expect(() => buildSemanticPilotCollectionPacket(current)).toThrow(
			"author and reviewer roles overlap",
		);
	});

	it("rejects power-reviewer overlap", () => {
		const current = plan();
		current.powerReviewerId = "reviewer-ko";
		expect(() => buildSemanticPilotCollectionPacket(current)).toThrow(
			"power reviewer overlaps collection roles",
		);
	});

	it("rejects reused construction clusters", () => {
		const current = plan();
		assignmentAt(current, 1).constructionClusterId = assignmentAt(
			current,
			0,
		).constructionClusterId;
		expect(() => buildSemanticPilotCollectionPacket(current)).toThrow(
			"construction clusters must be unique",
		);
	});

	it("rejects malformed or duplicate cause IDs", () => {
		const current = plan();
		assignmentAt(current, 0).causeIds = ["same", "same"];
		expect(() => buildSemanticPilotCollectionPacket(current)).toThrow(
			"cause IDs must be unique",
		);
	});

	it("rejects unsupported runtime language and incomplete coverage", () => {
		const current = plan();
		assignmentAt(current, 0).language = "fr" as "ko";
		expect(() => buildSemanticPilotCollectionPacket(current)).toThrow(
			"assignment content is invalid",
		);
		const missing = plan();
		missing.assignments = missing.assignments.filter(
			(item) => !(item.language === "ja" && item.decision === "no-update"),
		);
		expect(() => buildSemanticPilotCollectionPacket(missing)).toThrow(
			"assignments require ja/no-update",
		);
	});
});
