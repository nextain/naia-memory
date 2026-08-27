import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	evidenceObjectSha256,
	evidenceSignaturePayload,
} from "./public-evidence-crypto.js";
import { buildSemanticPilotParticipantPacket } from "./semantic-pilot-collection-packet.js";
import {
	type SemanticPilotDeliveryAcknowledgement,
	buildSemanticPilotDeliveryAcknowledgementBundle,
} from "./semantic-pilot-delivery-acknowledgement.js";
import type { writePowerReviewFixture } from "./semantic-public-gate-full-path-pilot.test-support.js";

export async function writeRealTimestampFixture(directory: string) {
	const caKey = join(directory, "ca.key");
	const caCert = join(directory, "ca.pem");
	const tsaKey = join(directory, "tsa.key");
	const tsaCsr = join(directory, "tsa.csr");
	const tsaCert = join(directory, "tsa.pem");
	const extensions = join(directory, "tsa-ext.cnf");
	const serial = join(directory, "tsa-serial");
	const config = join(directory, "tsa.cnf");
	await writeFile(
		extensions,
		"[tsa_ext]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,nonRepudiation\nextendedKeyUsage=critical,timeStamping\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n",
	);
	execFileSync(
		"openssl",
		[
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-nodes",
			"-keyout",
			caKey,
			"-out",
			caCert,
			"-days",
			"1",
			"-subj",
			"/CN=Naia public gate test CA",
		],
		{ stdio: "ignore" },
	);
	execFileSync(
		"openssl",
		[
			"req",
			"-newkey",
			"rsa:2048",
			"-nodes",
			"-keyout",
			tsaKey,
			"-out",
			tsaCsr,
			"-subj",
			"/CN=Naia public gate test TSA",
		],
		{ stdio: "ignore" },
	);
	execFileSync(
		"openssl",
		[
			"x509",
			"-req",
			"-in",
			tsaCsr,
			"-CA",
			caCert,
			"-CAkey",
			caKey,
			"-CAcreateserial",
			"-out",
			tsaCert,
			"-days",
			"1",
			"-sha256",
			"-extfile",
			extensions,
			"-extensions",
			"tsa_ext",
		],
		{ stdio: "ignore" },
	);
	await writeFile(serial, "01\n");
	await writeFile(
		config,
		`[tsa]\ndefault_tsa=tsa_config1\n[tsa_config1]\nserial=${serial}\nsigner_cert=${tsaCert}\ncerts=${caCert}\nsigner_key=${tsaKey}\nsigner_digest=sha256\ndefault_policy=1.2.3.4.1\ndigests=sha256\naccuracy=secs:1\nordering=yes\ntsa_name=yes\ness_cert_id_chain=yes\n`,
	);
	const trustPolicy = {
		schemaVersion: "naia-memory-rfc3161-timestamp-trust-policy-v1" as const,
		trustedCaFilePath: caCert,
		trustedCaFileSha256: createHash("sha256")
			.update(await readFile(caCert))
			.digest("hex"),
		requiredPolicyOid: "1.2.3.4.1",
	};
	const issue = async (digest: string, name: string) => {
		const queryPath = join(directory, `${name}.tsq`);
		const tokenPath = join(directory, `${name}.tsr`);
		execFileSync(
			"openssl",
			[
				"ts",
				"-query",
				"-digest",
				digest,
				"-sha256",
				"-cert",
				"-out",
				queryPath,
			],
			{ stdio: "ignore" },
		);
		execFileSync(
			"openssl",
			[
				"ts",
				"-reply",
				"-config",
				config,
				"-section",
				"tsa_config1",
				"-queryfile",
				queryPath,
				"-out",
				tokenPath,
			],
			{ stdio: "ignore" },
		);
		return {
			tokenPath,
			tokenSha256: createHash("sha256")
				.update(await readFile(tokenPath))
				.digest("hex"),
		};
	};
	return { trustPolicy, issue };
}

export function buildParticipantDelivery(
	collectionPlan: Awaited<
		ReturnType<typeof writePowerReviewFixture>
	>["collectionPlan"],
	launchReceiptSha256: string,
	acknowledgedAt: string,
) {
	const planSha256 = evidenceObjectSha256(collectionPlan);
	const authorPublicKeysByLanguage: Record<string, Record<string, string>> = {};
	const nativeReviewerPublicKeysByLanguage: Record<
		string,
		Record<string, string>
	> = {};
	const acknowledgements: SemanticPilotDeliveryAcknowledgement[] = [];
	for (const language of ["ko", "en", "ja"] as const) {
		for (const role of ["author", "native-reviewer"] as const) {
			const signer = `pilot-${role}-${language}`;
			const { privateKey, publicKey } = generateKeyPairSync("ed25519");
			const keys =
				role === "author"
					? authorPublicKeysByLanguage
					: nativeReviewerPublicKeysByLanguage;
			keys[language] = {
				[signer]: publicKey.export({ type: "spki", format: "pem" }).toString(),
			};
			const unsigned = {
				schemaVersion:
					"naia-memory-semantic-pilot-delivery-acknowledgement-v1" as const,
				signer,
				role,
				language,
				planSha256,
				participantPacketSha256: buildSemanticPilotParticipantPacket(
					collectionPlan,
					role,
					signer,
				).participantPacketSha256,
				launchReceiptSha256,
				acknowledgedAt,
				statement: "EXACT_COLLECTION_PACKET_HASH_ACKNOWLEDGED" as const,
			};
			acknowledgements.push({
				...unsigned,
				signatureBase64: sign(
					null,
					evidenceSignaturePayload(unsigned),
					privateKey,
				).toString("base64"),
			});
		}
	}
	return {
		bundle: buildSemanticPilotDeliveryAcknowledgementBundle({
			planSha256,
			launchReceiptSha256,
			acknowledgements,
		}),
		trustPolicy: {
			authorPublicKeysByLanguage,
			nativeReviewerPublicKeysByLanguage,
		},
	};
}
