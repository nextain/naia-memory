import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
	buildNativeRuntimeExecutionIdentity,
	validateNativeRuntimeExecutionIdentity,
} from "./native-runtime-execution-identity.js";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "naia-runtime-identity-"));
	const executable = join(root, "node");
	const preload = join(root, "preload.cjs");
	const loader = join(root, "loader.mjs");
	writeFileSync(executable, "node-bytes");
	writeFileSync(preload, "preload-bytes");
	writeFileSync(loader, "loader-bytes");
	writeFileSync(
		join(root, "package.json"),
		JSON.stringify({ name: "runtime-fixture", version: "1.0.0" }),
	);
	return { executable, preload, loader };
}

describe("native runtime execution identity", () => {
	it("binds Node bytes, file-backed hooks, arguments, and runtime environment", () => {
		const files = fixture();
		const identity = buildNativeRuntimeExecutionIdentity({
			nodeVersion: "v26.3.0",
			execPath: files.executable,
			execArgv: [
				"--require",
				files.preload,
				`--import=${pathToFileURL(files.loader).href}`,
			],
			environment: {},
		});
		expect(identity.hooks).toHaveLength(2);
		expect(identity.hooks.map(({ argumentIndex }) => argumentIndex)).toEqual([
			0, 2,
		]);
		expect(identity.environment).toEqual({
			nodeOptions: null,
			nodePath: null,
			tsxTsconfigPath: null,
		});
		expect(() =>
			validateNativeRuntimeExecutionIdentity(identity),
		).not.toThrow();
	});

	it("binds the legacy experimental loader alias", () => {
		const files = fixture();
		const identity = buildNativeRuntimeExecutionIdentity({
			nodeVersion: "v26.3.0",
			execPath: files.executable,
			execArgv: [`--experimental-loader=${files.loader}`],
			environment: {},
		});
		expect(identity.hooks).toMatchObject([
			{
				flag: "--experimental-loader",
				argumentIndex: 0,
				specifier: files.loader,
			},
		]);
		expect(() =>
			validateNativeRuntimeExecutionIdentity(identity),
		).not.toThrow();
	});

	it("fails closed on environment overrides that can alter module loading", () => {
		const files = fixture();
		expect(() =>
			buildNativeRuntimeExecutionIdentity({
				nodeVersion: "v26.3.0",
				execPath: files.executable,
				execArgv: [],
				environment: { NODE_OPTIONS: `--require ${files.preload}` },
			}),
		).toThrow("environment overrides are not allowed");
	});

	it("rejects non-file hook specifiers and tampered receipts", () => {
		const files = fixture();
		expect(() =>
			buildNativeRuntimeExecutionIdentity({
				nodeVersion: "v26.3.0",
				execPath: files.executable,
				execArgv: ["--import", "tsx"],
				environment: {},
			}),
		).toThrow("not file-bindable");
		const identity = buildNativeRuntimeExecutionIdentity({
			nodeVersion: "v26.3.0",
			execPath: files.executable,
			execArgv: ["--require", files.preload],
			environment: {},
		});
		expect(() =>
			validateNativeRuntimeExecutionIdentity({
				...identity,
				nodeVersion: "v0.0.0",
			}),
		).toThrow("internally inconsistent");
	});

	it("rejects a rehashed receipt that substitutes the declared hook path", () => {
		const files = fixture();
		const identity = buildNativeRuntimeExecutionIdentity({
			nodeVersion: "v26.3.0",
			execPath: files.executable,
			execArgv: ["--require", files.preload],
			environment: {},
		});
		const hooks = identity.hooks.map((hook) => ({
			...hook,
			specifier: files.loader,
		}));
		const payload = {
			schemaVersion: identity.schemaVersion,
			nodeVersion: identity.nodeVersion,
			executable: identity.executable,
			execArgv: ["--require", files.loader],
			hooks,
			packageManifest: identity.packageManifest,
			environment: identity.environment,
		};
		const identitySha256 = createHash("sha256")
			.update(`${JSON.stringify(payload)}\n`)
			.digest("hex");
		expect(() =>
			validateNativeRuntimeExecutionIdentity({ ...payload, identitySha256 }),
		).toThrow("internally inconsistent");
	});
});
