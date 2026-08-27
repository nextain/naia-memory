import type { MemoryUpdateContract } from "./memory-update-contract.js";
import {
	canonicalEvidenceJson,
	evidenceObjectSha256,
} from "./public-evidence-crypto.js";
import type { SemanticPublicAttestation } from "./semantic-public-attestation.js";

type UnsignedAttestation = Omit<SemanticPublicAttestation, "signatureBase64">;

export type SemanticAttestationSigningPacket = {
	schemaVersion: "naia-memory-semantic-signing-packet-v1";
	contractSha256: string;
	contractFrozenAt: string;
	signedAt: string;
	assignments: Array<{
		assignmentId: string;
		unsignedAttestation: UnsignedAttestation;
		signingPayloadBase64: string;
	}>;
	packetSha256: string;
};

export function buildSemanticAttestationSigningPacket(
	contract: MemoryUpdateContract,
	signedAt: string,
): SemanticAttestationSigningPacket {
	const signingTime = Date.parse(signedAt);
	const frozenAt = contract.familySplitFreeze?.frozenAt;
	const freezeTime = Date.parse(frozenAt ?? "");
	if (!Number.isFinite(signingTime) || !Number.isFinite(freezeTime))
		throw new Error("semantic signing packet timestamps are invalid");
	if (signingTime < freezeTime)
		throw new Error("semantic signing packet predates the contract freeze");
	const contractSha256 = evidenceObjectSha256(contract);
	const assignments = new Map<string, UnsignedAttestation>();
	for (const current of contract.cases.filter(
		(item) => item.split === "test",
	)) {
		if (!current.provenance)
			throw new Error(`${current.id}: provenance is missing`);
		for (const [role, signer, statement] of [
			["author", current.provenance.authorId, "AUTHORSHIP_CONFIRMED"],
			[
				"native-reviewer",
				current.provenance.reviewerId,
				"NATIVE_REVIEW_ACCEPTED",
			],
		] as const) {
			const assignmentId = JSON.stringify([role, current.language, signer]);
			assignments.set(assignmentId, {
				schemaVersion: "naia-memory-semantic-attestation-v1",
				signer,
				role,
				language: current.language,
				contractSha256,
				signedAt,
				statement,
			});
		}
	}
	const packetCore = {
		schemaVersion: "naia-memory-semantic-signing-packet-v1" as const,
		contractSha256,
		contractFrozenAt: frozenAt as string,
		signedAt,
		assignments: [...assignments.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([assignmentId, unsignedAttestation]) => ({
				assignmentId,
				unsignedAttestation,
				signingPayloadBase64: Buffer.from(
					canonicalEvidenceJson(unsignedAttestation),
				).toString("base64"),
			})),
	};
	return { ...packetCore, packetSha256: evidenceObjectSha256(packetCore) };
}
