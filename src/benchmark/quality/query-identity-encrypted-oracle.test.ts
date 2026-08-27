import { describe, expect, it } from "vitest";
import {
	createEncryptedQueryIdentityOracle,
	verifyEncryptedQueryIdentityOracleRelease,
} from "./query-identity-encrypted-oracle.js";
import type { QueryIdentityOracle } from "./query-identity-oracle.js";

const oracle: QueryIdentityOracle = {
	schemaVersion: "naia-memory-query-identity-oracle-v1",
	construction: "independent-native-reviewed",
	cases: [],
};

describe("encrypted query identity oracle", () => {
	it("recovers the exact canonical oracle and reports a bounded assurance", () => {
		const encrypted = createEncryptedQueryIdentityOracle({
			oracle,
			key: Buffer.alloc(32, 7),
			iv: Buffer.alloc(12, 9),
		});
		const verified = verifyEncryptedQueryIdentityOracleRelease({
			...encrypted,
			expectedEnvelopeSha256: encrypted.releaseKey.envelopeSha256,
		});
		expect(verified.oracle).toEqual(oracle);
		expect(verified.evidenceAssurance).toEqual({
			level: "launch-bound-encrypted-oracle-consistency",
			encryptedOracleEnvelopeIntegrityVerified: true,
			releasedKeyMatchesPrecommittedEnvelope: true,
			disclosedOracleMatchesEncryptedEnvelope: true,
			oracleKeyWithholdingVerified: false,
		});
	});

	it("rejects envelope substitution and launch-binding removal", () => {
		const first = createEncryptedQueryIdentityOracle({ oracle });
		const second = createEncryptedQueryIdentityOracle({ oracle });
		expect(() =>
			verifyEncryptedQueryIdentityOracleRelease({
				envelope: second.envelope,
				releaseKey: second.releaseKey,
				expectedEnvelopeSha256: first.releaseKey.envelopeSha256,
			}),
		).toThrow("launch receipt");
		expect(() =>
			verifyEncryptedQueryIdentityOracleRelease({
				envelope: second.envelope,
				releaseKey: first.releaseKey,
			}),
		).toThrow("envelope binding");
	});

	it("rejects ciphertext, authentication-tag, key, and commitment tampering", () => {
		const encrypted = createEncryptedQueryIdentityOracle({ oracle });
		for (const envelopePatch of [
			{ ciphertextBase64: Buffer.from("tampered").toString("base64") },
			{ authTagBase64: Buffer.alloc(16, 3).toString("base64") },
			{ keyCommitmentSha256: "0".repeat(64) },
		]) {
			const envelope = { ...encrypted.envelope, ...envelopePatch };
			const releaseKey = {
				...encrypted.releaseKey,
				envelopeSha256: encrypted.releaseKey.envelopeSha256,
			};
			expect(() =>
				verifyEncryptedQueryIdentityOracleRelease({ envelope, releaseKey }),
			).toThrow();
		}
		const releaseKey = {
			...encrypted.releaseKey,
			keyBase64: Buffer.alloc(32, 4).toString("base64"),
		};
		expect(() =>
			verifyEncryptedQueryIdentityOracleRelease({
				envelope: encrypted.envelope,
				releaseKey,
			}),
		).toThrow("commitment");
	});
});
