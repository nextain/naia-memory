import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	NATIVE_RUNTIME_SOURCE_MANIFEST_SCHEMA,
	buildNativeRuntimeSourceManifest,
	verifyNativeRuntimeSourceManifest,
} from "./native-runtime-source-manifest.js";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "naia-source-manifest-"));
	mkdirSync(join(root, "src"));
	writeFileSync(
		join(root, "src", "entry.ts"),
		'import { value } from "./dependency.js";\nexport { value };\n',
	);
	writeFileSync(
		join(root, "src", "dependency.ts"),
		"export const value = 1;\n",
	);
	writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
	return root;
}

describe("native runtime source manifest", () => {
	it("pins a deterministic transitive closure and additional inputs", () => {
		const root = fixture();
		const manifest = buildNativeRuntimeSourceManifest({
			root,
			entryPoint: "src/entry.ts",
			additionalInputs: ["pnpm-lock.yaml"],
		});
		expect(manifest.schemaVersion).toBe(NATIVE_RUNTIME_SOURCE_MANIFEST_SCHEMA);
		expect(manifest.entryPoint).toBe("src/entry.ts");
		expect(manifest.additionalInputs).toEqual(["pnpm-lock.yaml"]);
		expect(manifest.files.map(({ path }) => path)).toEqual([
			"pnpm-lock.yaml",
			"src/dependency.ts",
			"src/entry.ts",
		]);
		expect(manifest.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(() =>
			verifyNativeRuntimeSourceManifest(root, manifest),
		).not.toThrow();
	});

	it("binds imported and additional file bytes", () => {
		const root = fixture();
		const manifest = buildNativeRuntimeSourceManifest({
			root,
			entryPoint: "src/entry.ts",
			additionalInputs: ["pnpm-lock.yaml"],
		});
		writeFileSync(
			join(root, "src", "dependency.ts"),
			"export const value = 2;\n",
		);
		expect(() => verifyNativeRuntimeSourceManifest(root, manifest)).toThrow(
			"manifest changed",
		);
		const fresh = buildNativeRuntimeSourceManifest({
			root,
			entryPoint: "src/entry.ts",
			additionalInputs: ["pnpm-lock.yaml"],
		});
		writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '10.0'\n");
		expect(() => verifyNativeRuntimeSourceManifest(root, fresh)).toThrow(
			"manifest changed",
		);
	});

	it("rejects deletion of a declared additional input from expected evidence", () => {
		const root = fixture();
		const manifest = buildNativeRuntimeSourceManifest({
			root,
			entryPoint: "src/entry.ts",
			additionalInputs: ["pnpm-lock.yaml"],
		});
		const downgraded = { ...manifest, additionalInputs: [] };
		expect(() => verifyNativeRuntimeSourceManifest(root, downgraded)).toThrow(
			"internally inconsistent",
		);
	});

	it("accepts semantically identical JSON with reordered entry keys", () => {
		const root = fixture();
		const manifest = buildNativeRuntimeSourceManifest({
			root,
			entryPoint: "src/entry.ts",
			additionalInputs: ["pnpm-lock.yaml"],
		});
		const reparsed = JSON.parse(
			JSON.stringify({
				...manifest,
				files: manifest.files.map(({ path, sha256 }) => ({ sha256, path })),
			}),
		) as typeof manifest;
		expect(() =>
			verifyNativeRuntimeSourceManifest(root, reparsed),
		).not.toThrow();
	});

	it("includes static import.meta.url resources and triple-slash references", () => {
		const root = fixture();
		writeFileSync(join(root, "src", "worker.ts"), "export {};\n");
		writeFileSync(join(root, "src", "types.ts"), "declare const marker: 1;\n");
		writeFileSync(
			join(root, "src", "entry.ts"),
			'/// <reference path="./types.ts" />\nnew URL("./worker.js", import.meta.url);\n',
		);
		const manifest = buildNativeRuntimeSourceManifest({
			root,
			entryPoint: "src/entry.ts",
		});
		expect(manifest.files.map(({ path }) => path)).toEqual([
			"src/entry.ts",
			"src/types.ts",
			"src/worker.ts",
		]);
	});

	it("fails closed on a non-static dynamic import", () => {
		const root = fixture();
		writeFileSync(
			join(root, "src", "entry.ts"),
			'const name = "dependency"; import(`./${name}.js`);\n',
		);
		expect(() =>
			buildNativeRuntimeSourceManifest({ root, entryPoint: "src/entry.ts" }),
		).toThrow("not statically bindable");
	});

	it("handles cycles without duplicate entries", () => {
		const root = fixture();
		writeFileSync(
			join(root, "src", "dependency.ts"),
			'import "./entry.js";\nexport const value = 1;\n',
		);
		const manifest = buildNativeRuntimeSourceManifest({
			root,
			entryPoint: "src/entry.ts",
		});
		expect(manifest.files).toHaveLength(2);
	});

	it("rejects a source symlink that escapes the repository", () => {
		const root = fixture();
		const outside = mkdtempSync(join(tmpdir(), "naia-source-outside-"));
		writeFileSync(join(outside, "escape.ts"), "export const value = 3;\n");
		symlinkSync(join(outside, "escape.ts"), join(root, "src", "escape.ts"));
		writeFileSync(join(root, "src", "entry.ts"), 'import "./escape.js";\n');
		expect(() =>
			buildNativeRuntimeSourceManifest({ root, entryPoint: "src/entry.ts" }),
		).toThrow("escapes repository root");
	});

	it("rejects ambiguous source resolution", () => {
		const root = fixture();
		writeFileSync(
			join(root, "src", "dependency.js"),
			"export const value = 9;\n",
		);
		expect(() =>
			buildNativeRuntimeSourceManifest({ root, entryPoint: "src/entry.ts" }),
		).toThrow("exactly one source");
	});
});
