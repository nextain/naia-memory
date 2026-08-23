import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { trustPolicy } from "./public-evidence-fixture.js";
import { evaluatePublicEvidenceV10Bundle } from "./public-evidence-v10-cli.js";

const roots: string[] = [];
async function root() {
	const value = await mkdtemp(join(tmpdir(), "naia-v10-cli-"));
	roots.push(value);
	return value;
}
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((path) => rm(path, { recursive: true })),
	);
});

describe("public evidence v10 verifier intake", () => {
	it("rejects verifier trust and CA supplied inside the evidence bundle", async () => {
		const evidence = await root();
		await writeFile(join(evidence, "envelope.json"), "{}");
		await writeFile(join(evidence, "trust.json"), "{}");
		await writeFile(join(evidence, "tsa.pem"), "ca");
		expect(
			await evaluatePublicEvidenceV10Bundle(
				join(evidence, "envelope.json"),
				join(evidence, "trust.json"),
				join(evidence, "tsa.pem"),
			),
		).toEqual({
			promotable: false,
			failures: [
				"v10 trust policy must be outside the submitted evidence root",
			],
		});
	});

	it("rejects a symlinked verifier trust policy that resolves into evidence", async () => {
		const evidence = await root();
		const verifier = await root();
		await writeFile(join(evidence, "envelope.json"), "{}");
		await writeFile(join(evidence, "trust.json"), "{}");
		await writeFile(join(verifier, "tsa.pem"), "ca");
		await symlink(
			join(evidence, "trust.json"),
			join(verifier, "trust-link.json"),
		);
		const result = await evaluatePublicEvidenceV10Bundle(
			join(evidence, "envelope.json"),
			join(verifier, "trust-link.json"),
			join(verifier, "tsa.pem"),
		);
		expect(result.failures).toContain(
			"v10 trust policy must be outside the submitted evidence root",
		);
	});

	it("validates verifier-owned policy and CA before evaluating evidence", async () => {
		const evidence = await root();
		const verifier = await root();
		await writeFile(join(evidence, "envelope.json"), "{}");
		await writeFile(
			join(verifier, "trust.json"),
			JSON.stringify({
				core: trustPolicy,
				custodyTimestamp: {
					schemaVersion: "naia-memory-rfc3161-timestamp-trust-policy-v1",
					trustedCaFilePath: "tsa.pem",
					trustedCaFileSha256: "0".repeat(64),
					requiredPolicyOid: "1.2.3.4",
				},
			}),
		);
		await writeFile(join(verifier, "tsa.pem"), "wrong-ca");
		expect(
			await evaluatePublicEvidenceV10Bundle(
				join(evidence, "envelope.json"),
				join(verifier, "trust.json"),
				join(verifier, "tsa.pem"),
			),
		).toEqual({
			promotable: false,
			failures: ["v10 trusted CA hash mismatch"],
		});
	});
});
