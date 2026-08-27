import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildNativeRuntimePackageManifest,
	validateNativeRuntimePackageManifest,
	validateNativeRuntimePackageManifestHooks,
	verifyNativeRuntimePackageManifest,
} from "./native-runtime-package-manifest.js";

function packageFixture() {
	const root = mkdtempSync(join(tmpdir(), "naia-package-manifest-"));
	const packages = join(root, "node_modules");
	const hookPackage = join(packages, "hook-package");
	const dependency = join(packages, "dependency");
	mkdirSync(join(hookPackage, "dist"), { recursive: true });
	mkdirSync(dependency, { recursive: true });
	writeFileSync(
		join(hookPackage, "package.json"),
		JSON.stringify({
			name: "hook-package",
			version: "1.0.0",
			dependencies: { dependency: "1.0.0" },
			optionalDependencies: { absent: "1.0.0" },
		}),
	);
	writeFileSync(
		join(hookPackage, "dist", "hook.mjs"),
		"import('dependency');\n",
	);
	writeFileSync(
		join(dependency, "package.json"),
		JSON.stringify({ name: "dependency", version: "1.0.0", main: "index.js" }),
	);
	writeFileSync(join(dependency, "index.js"), "export const value = 1;\n");
	writeFileSync(
		join(root, "package.json"),
		JSON.stringify({
			name: "producer",
			version: "1.0.0",
			dependencies: { dependency: "1.0.0" },
		}),
	);
	return { root, hook: join(hookPackage, "dist", "hook.mjs"), dependency };
}

describe("native runtime package manifest", () => {
	it("binds full package bytes, dependencies, and missing optional packages", () => {
		const fixture = packageFixture();
		const manifest = buildNativeRuntimePackageManifest([fixture.hook]);
		expect(manifest.packages.map(({ name }) => name)).toEqual([
			"dependency",
			"hook-package",
		]);
		expect(
			manifest.packages.find(({ name }) => name === "hook-package")
				?.missingOptionalDependencies,
		).toEqual(["absent"]);
		expect(
			manifest.packages.find(({ name }) => name === "hook-package")
				?.resolvedDependencies,
		).toEqual([
			{ kind: "required", name: "dependency", root: fixture.dependency },
		]);
		expect(() => validateNativeRuntimePackageManifest(manifest)).not.toThrow();
		const hookFile = manifest.packages
			.find(({ name }) => name === "hook-package")
			?.files.find(({ path }) => path === "dist/hook.mjs");
		expect(() =>
			validateNativeRuntimePackageManifestHooks(manifest, [
				{ path: fixture.hook, sha256: hookFile?.sha256 ?? "" },
			]),
		).not.toThrow();
		expect(() =>
			validateNativeRuntimePackageManifestHooks(manifest, [
				{ path: fixture.hook, sha256: "0".repeat(64) },
			]),
		).toThrow("path or bytes changed");
	});

	it("detects mutation of a transitively reachable package file", () => {
		const fixture = packageFixture();
		const manifest = buildNativeRuntimePackageManifest([fixture.hook]);
		writeFileSync(
			join(fixture.dependency, "index.js"),
			"export const value = 2;\n",
		);
		expect(() =>
			verifyNativeRuntimePackageManifest(manifest, [fixture.hook]),
		).toThrow("manifest changed");
	});

	it("binds a producer dependency anchor and rejects missing declared accounting", () => {
		const fixture = packageFixture();
		const manifest = buildNativeRuntimePackageManifest(
			[fixture.hook],
			[fixture.root],
		);
		expect(manifest.anchors).toMatchObject([
			{
				root: fixture.root,
				declaredDependencies: {
					required: ["dependency"],
					optional: [],
					peer: [],
				},
				resolvedDependencies: [
					{
						kind: "required",
						name: "dependency",
						root: fixture.dependency,
					},
				],
			},
		]);
		const anchors = manifest.anchors.map((anchor) => ({
			...anchor,
			resolvedDependencies: [],
		}));
		const payload = {
			schemaVersion: manifest.schemaVersion,
			anchors,
			packages: manifest.packages,
		};
		const manifestSha256 = createHash("sha256")
			.update(`${JSON.stringify(payload)}\n`)
			.digest("hex");
		expect(() =>
			validateNativeRuntimePackageManifest({ ...payload, manifestSha256 }),
		).toThrow("internally inconsistent");
		writeFileSync(
			join(fixture.root, "package.json"),
			JSON.stringify({ name: "producer", version: "1.0.1" }),
		);
		expect(() =>
			verifyNativeRuntimePackageManifest(manifest, [fixture.hook]),
		).toThrow("manifest changed");
	});

	it("rejects an internally tampered package manifest", () => {
		const fixture = packageFixture();
		const manifest = buildNativeRuntimePackageManifest([fixture.hook]);
		expect(() =>
			validateNativeRuntimePackageManifest({
				...manifest,
				packages: manifest.packages.slice(1),
			}),
		).toThrow("internally inconsistent");
	});

	it("rejects a self-consistently rehashed manifest with a dangling dependency edge", () => {
		const fixture = packageFixture();
		const manifest = buildNativeRuntimePackageManifest([fixture.hook]);
		const packages = manifest.packages.filter(
			({ name }) => name !== "dependency",
		);
		const payload = {
			schemaVersion: manifest.schemaVersion,
			anchors: manifest.anchors,
			packages,
		};
		const manifestSha256 = createHash("sha256")
			.update(`${JSON.stringify(payload)}\n`)
			.digest("hex");
		expect(() =>
			validateNativeRuntimePackageManifest({ ...payload, manifestSha256 }),
		).toThrow("internally inconsistent");
	});

	it("fails closed on missing required dependencies and package symlinks", () => {
		const root = mkdtempSync(join(tmpdir(), "naia-package-invalid-"));
		const hook = join(root, "hook.mjs");
		writeFileSync(hook, "export {};\n");
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({
				name: "invalid-package",
				version: "1.0.0",
				dependencies: { absent: "1.0.0" },
			}),
		);
		expect(() => buildNativeRuntimePackageManifest([hook])).toThrow(
			"required runtime package is missing",
		);
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({ name: "invalid-package", version: "1.0.0" }),
		);
		symlinkSync(hook, join(root, "hook-link.mjs"));
		expect(() => buildNativeRuntimePackageManifest([hook])).toThrow(
			"contains a symbolic link",
		);
	});
});
