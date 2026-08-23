import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CLI = resolve(
	"src/benchmark/quality/semantic-competitive-qualification-trust-anchor-cli.ts",
);

function publicKey(): string {
	return generateKeyPairSync("ed25519")
		.publicKey.export({ type: "spki", format: "pem" })
		.toString();
}

function fixture() {
	const directory = mkdtempSync(join(tmpdir(), "qualification-anchor-cli-"));
	const policyPath = join(directory, "policy.json");
	const modulePath = join(directory, "generated.ts");
	const policy = {
		schemaVersion:
			"naia-memory-semantic-qualification-public-deployment-policy-v1",
		deploymentId: "production-2026-08",
		gateKeyId: "qualification-gate-1",
		gatePublicKeyPem: publicKey(),
		verifierPolicy: {
			authorizerPublicKeys: { release: publicKey() },
			approvedAnalysisPlanTrustPolicySha256: "b".repeat(64),
			approvedTimestampTrustPolicyIdentitySha256: "c".repeat(64),
		},
		analysisPlanTrustPolicy: {
			administratorPublicKeys: { research: publicKey() },
		},
		timestampTrustPolicyIdentity: {
			schemaVersion: 1,
			trustedCaFileSha256: "a".repeat(64),
			requiredPolicyOid: "1.2.3.4",
		},
	};
	writeFileSync(policyPath, JSON.stringify(policy));
	return { modulePath, policy, policyPath };
}

function run(...args: string[]) {
	return spawnSync("pnpm", ["exec", "tsx", CLI, ...args], {
		encoding: "utf8",
	});
}

describe("semantic qualification trust-anchor CLI", () => {
	it("atomically provisions and verifies the generated module", () => {
		const { modulePath, policyPath } = fixture();
		expect(run(policyPath, "--output", modulePath).status).toBe(0);
		const generated = readFileSync(modulePath, "utf8");
		expect(generated).toContain("production-2026-08");
		const checked = run(policyPath, "--check", modulePath);
		expect(checked.status).toBe(0);
		expect(checked.stdout).toBe("");
	});

	it("fails closed when the policy or generated module drifts", () => {
		const { modulePath, policy, policyPath } = fixture();
		execFileSync("pnpm", [
			"exec",
			"tsx",
			CLI,
			policyPath,
			"--output",
			modulePath,
		]);
		writeFileSync(
			policyPath,
			JSON.stringify({ ...policy, deploymentId: "production-2026-09" }),
		);
		const drifted = run(policyPath, "--check", modulePath);
		expect(drifted.status).toBe(1);
		expect(drifted.stderr).toContain("drifted from public deployment policy");
	});

	it("rejects a missing module and ambiguous invocation", () => {
		const { modulePath, policyPath } = fixture();
		expect(run(policyPath, "--check", modulePath).stderr).toContain(
			"missing or unreadable",
		);
		expect(run(policyPath, "--output").stderr).toContain("usage:");
		expect(run(policyPath, "--check", modulePath, "extra").stderr).toContain(
			"usage:",
		);
	});

	it("refuses to overwrite the approved deployment policy", () => {
		const { policyPath } = fixture();
		const before = readFileSync(policyPath, "utf8");
		const result = run(policyPath, "--output", policyPath);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain(
			"module path must differ from public deployment policy path",
		);
		expect(readFileSync(policyPath, "utf8")).toBe(before);
	});

	it("rejects symbolic-link output aliases", () => {
		const { modulePath, policyPath } = fixture();
		const before = readFileSync(policyPath, "utf8");
		symlinkSync(policyPath, modulePath);
		const result = run(policyPath, "--output", modulePath);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("must not be a symbolic link");
		expect(readFileSync(policyPath, "utf8")).toBe(before);
	});

	it("never renders unrecognized private material", () => {
		const { modulePath, policy, policyPath } = fixture();
		const marker = "PRIVATE-KEY-MATERIAL-MUST-NOT-LEAK";
		writeFileSync(
			policyPath,
			JSON.stringify({ ...policy, privateKey: marker }),
		);
		expect(run(policyPath, "--output", modulePath).status).toBe(0);
		expect(readFileSync(modulePath, "utf8")).not.toContain(marker);
	});
});
