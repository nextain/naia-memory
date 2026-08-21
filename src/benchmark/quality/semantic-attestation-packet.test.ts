import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type MemoryUpdateContract,
	computeFamilySplitDigest,
} from "./memory-update-contract.js";
import { canonicalEvidenceJson } from "./public-evidence-crypto.js";
import { runSemanticAttestationPacketCli } from "./semantic-attestation-packet-cli.js";
import { buildSemanticAttestationSigningPacket } from "./semantic-attestation-packet.js";

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
