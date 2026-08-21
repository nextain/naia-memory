import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import type { Rfc3161CommandRunner } from "./rfc3161-timestamp.js";
import type { SemanticPilotCollectionPlan } from "./semantic-pilot-collection-packet.js";
import { buildSemanticPilotLaunch } from "./semantic-pilot-launch.js";

function fixture() {
	const directory = mkdtempSync(join(tmpdir(), "naia-pilot-launch-"));
	const token = Buffer.from("timestamp token");
	const ca = Buffer.from("trusted ca");
	const tokenPath = join(directory, "token.tsr");
	const caPath = join(directory, "ca.pem");
	writeFileSync(tokenPath, token);
	writeFileSync(caPath, ca);
	const plan: SemanticPilotCollectionPlan = {
		schemaVersion: "naia-memory-semantic-pilot-collection-plan-v1",
		publicContractSha256: "a".repeat(64),
		powerReviewerId: "power-reviewer",
		createdAt: "2026-08-21T00:00:00Z",
		assignments: (["ko", "en", "ja"] as const).flatMap((language) =>
			(["update", "delete", "no-update"] as const).map((decision) => ({
				assignmentId: `${language}-${decision}`,
				language,
				decision,
				authorId: `author-${language}`,
				reviewerId: `reviewer-${language}`,
				constructionClusterId: `cluster-${language}-${decision}`,
				causeIds: [`cause-${language}-${decision}`],
			})),
		),
	};
	const commandRunner: Rfc3161CommandRunner = (args) =>
		args.includes("-verify")
			? { status: 0, stdout: "Verification: OK\n", stderr: "" }
			: {
					status: 0,
					stdout:
						"Status info:\nPolicy OID: 1.2.3.4\nTime stamp: Aug 21 00:00:00 2026 GMT\n",
					stderr: "",
				};
	return {
		plan,
		commandRunner,
		timestampEvidence: {
			schemaVersion: "naia-memory-rfc3161-timestamp-evidence-v1" as const,
			collectionPlanSha256: evidenceObjectSha256(plan),
			tokenSha256: createHash("sha256").update(token).digest("hex"),
			tokenPath,
		},
		timestampTrustPolicy: {
			schemaVersion: "naia-memory-rfc3161-timestamp-trust-policy-v1" as const,
			trustedCaFilePath: caPath,
			trustedCaFileSha256: createHash("sha256").update(ca).digest("hex"),
			requiredPolicyOid: "1.2.3.4",
		},
	};
}

describe("semantic pilot launch gate", () => {
	it("reveals assignments only after trusted timestamp verification", () => {
		const current = fixture();
		const launch = buildSemanticPilotLaunch({
			collectionPlan: current.plan,
			timestampEvidence: current.timestampEvidence,
			timestampTrustPolicy: current.timestampTrustPolicy,
			commandRunner: current.commandRunner,
		});
		expect(launch.receipt).toMatchObject({
			deliveryState: "DELIVERABLE_AFTER_TRUSTED_TIMESTAMP_VERIFICATION",
			disclosureControl: "COMMAND_ENFORCED_NOT_OUT_OF_BAND_PROOF",
			timestampTrustModel:
				"RFC3161_TOKEN_VERIFIED_AGAINST_OPERATOR_CONFIGURED_CA",
			timestampedAt: "2026-08-21T00:00:00.000Z",
		});
		expect(launch.packet.authorPackets).toHaveLength(3);
		expect(launch.receipt.packetSha256).toBe(launch.packet.packetSha256);
	});

	it("fails closed before returning packets when timestamp verification fails", () => {
		const current = fixture();
		expect(() =>
			buildSemanticPilotLaunch({
				collectionPlan: current.plan,
				timestampEvidence: current.timestampEvidence,
				timestampTrustPolicy: current.timestampTrustPolicy,
				commandRunner: () => ({ status: 1, stdout: "", stderr: "bad" }),
			}),
		).toThrow("signature or message imprint is invalid");
	});

	it("binds launch to the exact collection plan", () => {
		const current = fixture();
		const firstAssignment = current.plan.assignments[0];
		if (!firstAssignment) throw new Error("fixture assignment missing");
		firstAssignment.causeIds = ["changed"];
		expect(() =>
			buildSemanticPilotLaunch({
				collectionPlan: current.plan,
				timestampEvidence: current.timestampEvidence,
				timestampTrustPolicy: current.timestampTrustPolicy,
				commandRunner: current.commandRunner,
			}),
		).toThrow("collection plan hash mismatch");
	});
});
