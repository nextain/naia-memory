import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	evidenceObjectSha256,
	evidenceSignaturePayload,
} from "./public-evidence-crypto.js";
import {
	SEMANTIC_QUALIFICATION_SUBJECTS,
	type SemanticCompetitiveQualification,
	type SemanticQualificationSubjects,
	validateSemanticCompetitiveQualification,
} from "./semantic-competitive-qualification.js";

function fixture() {
	const gate = generateKeyPairSync("ed25519");
	const subjects = Object.fromEntries(
		SEMANTIC_QUALIFICATION_SUBJECTS.map((name) => [
			name,
			{ artifact: `${name}-value` },
		]),
	) as SemanticQualificationSubjects;
	subjects.campaign = {
		schemaVersion: "naia-memory-semantic-campaign-v5",
		disclosure: { eligibility: "competitive-candidate" },
	};
	subjects.authorization = {
		authorizedAt: "2026-08-24T01:00:00.000Z",
		expiresAt: "2026-08-24T03:00:00.000Z",
	};
	const unsigned = {
		schemaVersion: "naia-memory-semantic-competitive-qualification-v1" as const,
		verdict: "qualified" as const,
		deploymentId: "public-benchmark-sidecar-2026-08",
		trustStoreSha256: "1".repeat(64),
		gateKeyId: "gate-2026-08",
		subjects: Object.fromEntries(
			SEMANTIC_QUALIFICATION_SUBJECTS.map((name) => [
				`${name}Sha256`,
				evidenceObjectSha256(subjects[name]),
			]),
		) as SemanticCompetitiveQualification["subjects"],
		authorizationWindow: {
			authorizedAt: "2026-08-24T01:00:00.000Z",
			expiresAt: "2026-08-24T03:00:00.000Z",
		},
		issuedAt: "2026-08-24T03:00:00.000Z",
		statement:
			"COMPETITIVE_CANDIDATE_VERIFIED_AGAINST_DEPLOYMENT_TRUST_STORE" as const,
	};
	const qualification: SemanticCompetitiveQualification = {
		...unsigned,
		signatureBase64: sign(
			null,
			evidenceSignaturePayload(unsigned),
			gate.privateKey,
		).toString("base64"),
	};
	return {
		gatePrivateKey: gate.privateKey,
		qualification,
		subjects,
		trustAnchor: {
			deploymentId: unsigned.deploymentId,
			trustStoreSha256: unsigned.trustStoreSha256,
			gatePublicKeys: {
				[unsigned.gateKeyId]: gate.publicKey
					.export({ type: "spki", format: "pem" })
					.toString(),
			},
		},
		executionReceipts: [
			{
				startedAt: "2026-08-24T01:30:00.000Z",
				completedAt: "2026-08-24T02:30:00.000Z",
			},
		],
	};
}

function resign(current: ReturnType<typeof fixture>): void {
	const { signatureBase64: _, ...unsigned } = current.qualification;
	current.qualification.signatureBase64 = sign(
		null,
		evidenceSignaturePayload(unsigned),
		current.gatePrivateKey,
	).toString("base64");
}

function rebindAndResign(
	current: ReturnType<typeof fixture>,
	subject: (typeof SEMANTIC_QUALIFICATION_SUBJECTS)[number],
): void {
	current.qualification.subjects[`${subject}Sha256`] = evidenceObjectSha256(
		current.subjects[subject],
	);
	resign(current);
}

describe("semantic competitive qualification", () => {
	it("accepts only a pinned deployment signature over exact subject bytes", () => {
		const current = fixture();
		expect(validateSemanticCompetitiveQualification(current)).toMatchObject({
			competitiveQualificationVerified: true,
			deploymentId: current.trustAnchor.deploymentId,
		});
	});

	it("rejects a caller-owned gate key", () => {
		const current = fixture();
		const attacker = generateKeyPairSync("ed25519");
		current.trustAnchor.gatePublicKeys[current.qualification.gateKeyId] =
			attacker.publicKey.export({ type: "spki", format: "pem" }).toString();
		expect(() => validateSemanticCompetitiveQualification(current)).toThrow(
			"pinned deployment",
		);
	});

	it("rejects post-qualification artifact mutation", () => {
		const current = fixture();
		current.subjects.campaign = {
			schemaVersion: "naia-memory-semantic-campaign-v5",
			disclosure: { eligibility: "competitive-candidate", changed: true },
		};
		expect(() => validateSemanticCompetitiveQualification(current)).toThrow(
			"subject mismatch: campaign",
		);
	});

	it("rejects execution outside the authorization window", () => {
		const current = fixture();
		current.executionReceipts[0].completedAt = "2026-08-24T03:00:00.000Z";
		expect(() => validateSemanticCompetitiveQualification(current)).toThrow(
			"outside the authorization window",
		);
	});

	it("rejects a re-signed qualification for a legacy campaign", () => {
		const current = fixture();
		current.subjects.campaign = {
			schemaVersion: "naia-memory-semantic-campaign-v4",
			disclosure: { eligibility: "competitive-candidate" },
		};
		rebindAndResign(current, "campaign");
		expect(() => validateSemanticCompetitiveQualification(current)).toThrow(
			"requires a v5 competitive candidate",
		);
	});

	it("rejects a re-signed authorization window mismatch", () => {
		const current = fixture();
		current.subjects.authorization = {
			authorizedAt: "2026-08-24T01:00:00.000Z",
			expiresAt: "2026-08-24T04:00:00.000Z",
		};
		rebindAndResign(current, "authorization");
		expect(() => validateSemanticCompetitiveQualification(current)).toThrow(
			"authorization window mismatch",
		);
	});

	it("rejects execution started before authorization", () => {
		const current = fixture();
		current.executionReceipts[0].startedAt = "2026-08-24T00:59:59.999Z";
		expect(() => validateSemanticCompetitiveQualification(current)).toThrow(
			"outside the authorization window",
		);
	});

	it("rejects a qualification issued before the authorization window closes", () => {
		const current = fixture();
		current.qualification.issuedAt = "2026-08-24T02:59:59.999Z";
		resign(current);
		expect(() => validateSemanticCompetitiveQualification(current)).toThrow(
			"issuance is premature",
		);
	});
});
