import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type MemoryUpdateContract,
	computeFamilySplitDigest,
} from "./memory-update-contract.js";
import { canonicalEvidenceJson } from "./public-evidence-crypto.js";
import { runSemanticAttestationCollectorCli } from "./semantic-attestation-collector-cli.js";
import {
	type SemanticDetachedSignatureSet,
	assembleSemanticAttestationBundle,
} from "./semantic-attestation-collector.js";
import { runSemanticAttestationPacketCli } from "./semantic-attestation-packet-cli.js";
import { buildSemanticAttestationSigningPacket } from "./semantic-attestation-packet.js";
import {
	type SemanticPublicTrustPolicy,
	validateSemanticPublicAttestations,
} from "./semantic-public-attestation.js";

const roots: string[] = [];

function contract(): MemoryUpdateContract {
	const languages = ["ko", "en", "ja"] as const;
	const decisions = ["update", "delete", "no-update"] as const;
	const cases = Array.from({ length: 102 }, (_, index) => {
		const language = languages[index % 3] ?? "ko";
		const decision = decisions[Math.floor(index / 3) % 3] ?? "update";
		return {
			id: `public-${index}`,
			familyId: `family-public-${index}`,
			split: "test" as const,
			language,
			turns: [{ content: `content-${index}`, at: "2026-01-01T00:00:00Z" }],
			query: `query-${index}`,
			expectedCurrentIds: ["current"],
			forbiddenStaleIds: ["stale"],
			expectedDeletedIds: decision === "delete" ? ["deleted"] : [],
			noUpdateIds: decision === "no-update" ? ["unchanged"] : [],
			expectedDecision: decision,
			provenance: {
				authorId: `author-${language}`,
				authorNativeLanguages: [language],
				authoredAt: "2026-01-02T00:00:00Z",
				reviewerId: `reviewer-${language}`,
				reviewerNativeLanguages: [language],
				reviewedAt: "2026-01-03T00:00:00Z",
				reviewDecision: "accepted" as const,
			},
		};
	});
	return {
		schemaVersion: "naia-memory-update-contract-v1",
		tier: "semantic-update-interpretation",
		construction: "independent-native-reviewed",
		familySplitFreeze: {
			frozenAt: "2026-01-04T00:00:00Z",
			digest: computeFamilySplitDigest(cases) as `sha256:${string}`,
		},
		cases,
	};
}

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(
		roots.splice(0).map((path) => rm(path, { recursive: true })),
	);
});

describe("semantic attestation signing packet", () => {
	it("deterministically emits one exact payload per unique assignment", () => {
		const first = buildSemanticAttestationSigningPacket(
			contract(),
			"2026-01-05T00:00:00Z",
		);
		const second = buildSemanticAttestationSigningPacket(
			contract(),
			"2026-01-05T00:00:00Z",
		);
		expect(first).toEqual(second);
		expect(first.assignments).toHaveLength(6);
		expect(first.assignments.map((item) => item.assignmentId)).toEqual(
			[...first.assignments.map((item) => item.assignmentId)].sort(),
		);
		for (const assignment of first.assignments)
			expect(
				Buffer.from(assignment.signingPayloadBase64, "base64").toString(),
			).toBe(canonicalEvidenceJson(assignment.unsignedAttestation));
	});

	it("binds packet and payloads to contract mutations", () => {
		const original = contract();
		const first = buildSemanticAttestationSigningPacket(
			original,
			"2026-01-05T00:00:00Z",
		);
		const firstCase = original.cases[0];
		if (!firstCase) throw new Error("fixture case is missing");
		firstCase.query = "mutated";
		const second = buildSemanticAttestationSigningPacket(
			original,
			"2026-01-05T00:00:00Z",
		);
		expect(second.contractSha256).not.toBe(first.contractSha256);
		expect(second.packetSha256).not.toBe(first.packetSha256);
	});

	it("keeps control characters in signer identities structurally distinct", () => {
		const value = contract();
		const firstCase = value.cases[0];
		if (!firstCase?.provenance)
			throw new Error("fixture provenance is missing");
		firstCase.provenance.authorId = "author-ko\0delegated";
		const packet = buildSemanticAttestationSigningPacket(
			value,
			"2026-01-05T00:00:00Z",
		);
		expect(packet.assignments).toHaveLength(7);
		expect(
			new Set(packet.assignments.map((item) => item.assignmentId)).size,
		).toBe(7);
	});

	it("rejects invalid and pre-freeze signing timestamps", () => {
		expect(() =>
			buildSemanticAttestationSigningPacket(contract(), "invalid"),
		).toThrow("timestamps are invalid");
		expect(() =>
			buildSemanticAttestationSigningPacket(contract(), "2026-01-03T00:00:00Z"),
		).toThrow("predates the contract freeze");
	});

	it("runs through bounded contract intake and fails closed", async () => {
		const path = await mkdtemp(join(tmpdir(), "semantic-signing-packet-"));
		roots.push(path);
		const contractPath = join(path, "contract.json");
		await writeFile(contractPath, JSON.stringify(contract()));
		const output: string[] = [];
		vi.spyOn(process.stdout, "write").mockImplementation((value) => {
			output.push(String(value));
			return true;
		});
		expect(
			await runSemanticAttestationPacketCli([
				contractPath,
				"2026-01-05T00:00:00Z",
			]),
		).toBe(0);
		expect(JSON.parse(output.pop() ?? "{}").assignments).toHaveLength(6);
		expect(
			await runSemanticAttestationPacketCli([
				join(path, "missing.json"),
				"2026-01-05T00:00:00Z",
			]),
		).toBe(1);
		expect(JSON.parse(output.pop() ?? "{}").failure).toBe(
			"contract is unreadable",
		);
		expect(await runSemanticAttestationPacketCli([])).toBe(2);
	});
});

describe("semantic detached signature collection", () => {
	function signedCollection() {
		const value = contract();
		const packet = buildSemanticAttestationSigningPacket(
			value,
			"2026-01-05T00:00:00Z",
		);
		const trust: SemanticPublicTrustPolicy = {
			authorPublicKeysByLanguage: {},
			nativeReviewerPublicKeysByLanguage: {},
		};
		const signatures = packet.assignments.map((assignment) => {
			const { privateKey, publicKey } = generateKeyPairSync("ed25519");
			const unsigned = assignment.unsignedAttestation;
			const roleMap =
				unsigned.role === "author"
					? trust.authorPublicKeysByLanguage
					: trust.nativeReviewerPublicKeysByLanguage;
			roleMap[unsigned.language] ??= {};
			roleMap[unsigned.language][unsigned.signer] = publicKey
				.export({ type: "spki", format: "pem" })
				.toString();
			return {
				assignmentId: assignment.assignmentId,
				signatureBase64: sign(
					null,
					Buffer.from(assignment.signingPayloadBase64, "base64"),
					privateKey,
				).toString("base64"),
			};
		});
		const detached: SemanticDetachedSignatureSet = {
			schemaVersion: "naia-memory-semantic-detached-signatures-v1",
			packetSha256: packet.packetSha256,
			signatures,
		};
		return { value, packet, trust, detached };
	}

	it("assembles externally signed payloads accepted by the final gate", () => {
		const fixture = signedCollection();
		const bundle = assembleSemanticAttestationBundle(
			fixture.packet,
			fixture.detached,
			fixture.trust,
		);
		expect(bundle.attestations).toHaveLength(6);
		expect(() =>
			validateSemanticPublicAttestations(fixture.value, bundle, fixture.trust),
		).not.toThrow();
	});

	it("rejects packet substitution through assignment and packet-hash binding", () => {
		const fixture = signedCollection();
		const assignment = fixture.packet.assignments[0];
		if (!assignment) throw new Error("fixture assignment is missing");
		assignment.unsignedAttestation.signer = "substitute";
		expect(() =>
			assembleSemanticAttestationBundle(
				fixture.packet,
				fixture.detached,
				fixture.trust,
			),
		).toThrow("signing assignment binding is invalid");

		const hashMutation = signedCollection();
		hashMutation.packet.contractFrozenAt = "2026-01-04T01:00:00Z";
		expect(() =>
			assembleSemanticAttestationBundle(
				hashMutation.packet,
				hashMutation.detached,
				hashMutation.trust,
			),
		).toThrow("signing packet hash is invalid");
	});

	it("rejects missing, duplicate, forged, and cross-packet signatures", () => {
		const missing = signedCollection();
		missing.detached.signatures.pop();
		expect(() =>
			assembleSemanticAttestationBundle(
				missing.packet,
				missing.detached,
				missing.trust,
			),
		).toThrow("do not cover the packet");

		const duplicate = signedCollection();
		const firstSignature = duplicate.detached.signatures[0];
		if (!firstSignature) throw new Error("fixture signature is missing");
		duplicate.detached.signatures.push(firstSignature);
		expect(() =>
			assembleSemanticAttestationBundle(
				duplicate.packet,
				duplicate.detached,
				duplicate.trust,
			),
		).toThrow("signature is duplicated");

		const forged = signedCollection();
		const forgedSignature = forged.detached.signatures[0];
		if (!forgedSignature) throw new Error("fixture signature is missing");
		forgedSignature.signatureBase64 = Buffer.alloc(64).toString("base64");
		expect(() =>
			assembleSemanticAttestationBundle(
				forged.packet,
				forged.detached,
				forged.trust,
			),
		).toThrow("untrusted or invalid");

		const crossed = signedCollection();
		crossed.detached.packetSha256 = "0".repeat(64);
		expect(() =>
			assembleSemanticAttestationBundle(
				crossed.packet,
				crossed.detached,
				crossed.trust,
			),
		).toThrow("target another packet");
	});

	it("rejects trust-key reuse before assembling an intermediate bundle", () => {
		const fixture = signedCollection();
		const authorKey =
			fixture.trust.authorPublicKeysByLanguage.ko?.["author-ko"];
		if (!authorKey) throw new Error("fixture author key is missing");
		const reviewerKeys = fixture.trust.nativeReviewerPublicKeysByLanguage.ko;
		if (!reviewerKeys) throw new Error("fixture reviewer keys are missing");
		reviewerKeys["reviewer-ko"] = authorKey;
		expect(() =>
			assembleSemanticAttestationBundle(
				fixture.packet,
				fixture.detached,
				fixture.trust,
			),
		).toThrow("trust keys overlap across identities");
	});

	it("collects through bounded files and fails closed on unreadable intake", async () => {
		const fixture = signedCollection();
		const path = await mkdtemp(join(tmpdir(), "semantic-signature-collector-"));
		roots.push(path);
		const paths = ["packet.json", "signatures.json", "trust.json"].map((name) =>
			join(path, name),
		);
		const [packetPath, signaturesPath, trustPath] = paths;
		if (!packetPath || !signaturesPath || !trustPath)
			throw new Error("fixture paths are missing");
		await Promise.all([
			writeFile(packetPath, JSON.stringify(fixture.packet)),
			writeFile(signaturesPath, JSON.stringify(fixture.detached)),
			writeFile(trustPath, JSON.stringify(fixture.trust)),
		]);
		const output: string[] = [];
		vi.spyOn(process.stdout, "write").mockImplementation((value) => {
			output.push(String(value));
			return true;
		});
		expect(await runSemanticAttestationCollectorCli(paths)).toBe(0);
		expect(JSON.parse(output.pop() ?? "{}").attestations).toHaveLength(6);
		const labels = ["packet", "detached signatures", "trust policy"];
		for (const [index, label] of labels.entries()) {
			const unreadablePaths = [...paths];
			unreadablePaths[index] = join(path, `missing-${index}.json`);
			expect(await runSemanticAttestationCollectorCli(unreadablePaths)).toBe(1);
			expect(JSON.parse(output.pop() ?? "{}").failure).toBe(
				`${label} is unreadable`,
			);
		}
		const oversizedPath = join(path, "oversized-packet.json");
		await writeFile(oversizedPath, Buffer.alloc(16 * 1024 * 1024 + 1));
		expect(
			await runSemanticAttestationCollectorCli([
				oversizedPath,
				signaturesPath,
				trustPath,
			]),
		).toBe(1);
		expect(JSON.parse(output.pop() ?? "{}").failure).toBe(
			"packet exceeds the 16 MiB intake limit",
		);
		expect(await runSemanticAttestationCollectorCli([])).toBe(2);
	});
});
