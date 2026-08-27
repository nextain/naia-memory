import { createHash } from "node:crypto";
import {
	closeSync,
	existsSync,
	lstatSync,
	openSync,
	readFileSync,
	readSync,
	readdirSync,
	realpathSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const NATIVE_RUNTIME_PACKAGE_MANIFEST_SCHEMA =
	"naia-native-runtime-package-manifest-v2";

type NativeRuntimeDependencyKind = "required" | "optional" | "peer";

interface NativeRuntimeDeclaredDependencies {
	required: string[];
	optional: string[];
	peer: string[];
}

interface NativeRuntimeResolvedDependency {
	kind: NativeRuntimeDependencyKind;
	name: string;
	root: string;
}

export interface NativeRuntimePackageFile {
	path: string;
	sha256: string;
}

export interface NativeRuntimePackageIdentity {
	name: string;
	version: string;
	root: string;
	files: NativeRuntimePackageFile[];
	declaredDependencies: NativeRuntimeDeclaredDependencies;
	resolvedDependencies: NativeRuntimeResolvedDependency[];
	missingOptionalDependencies: string[];
	missingPeerDependencies: string[];
}

export interface NativeRuntimePackageManifest {
	schemaVersion: typeof NATIVE_RUNTIME_PACKAGE_MANIFEST_SCHEMA;
	anchors: Array<{
		root: string;
		packageJsonSha256: string;
		declaredDependencies: NativeRuntimeDeclaredDependencies;
		resolvedDependencies: NativeRuntimeResolvedDependency[];
		missingOptionalDependencies: string[];
		missingPeerDependencies: string[];
	}>;
	packages: NativeRuntimePackageIdentity[];
	manifestSha256: string;
}

interface PackageJson {
	name?: unknown;
	version?: unknown;
	dependencies?: unknown;
	optionalDependencies?: unknown;
	peerDependencies?: unknown;
}

const sha256 = (bytes: Uint8Array | string) =>
	createHash("sha256").update(bytes).digest("hex");

function sha256File(path: string): string {
	const hash = createHash("sha256");
	const buffer = Buffer.allocUnsafe(1024 * 1024);
	const descriptor = openSync(path, "r");
	try {
		for (;;) {
			const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
			if (bytesRead === 0) break;
			hash.update(buffer.subarray(0, bytesRead));
		}
	} finally {
		closeSync(descriptor);
	}
	return hash.digest("hex");
}

const compareCanonical = (left: string, right: string) =>
	left < right ? -1 : left > right ? 1 : 0;

function canonicalPayload(
	manifest: Omit<NativeRuntimePackageManifest, "manifestSha256">,
): string {
	return `${JSON.stringify(manifest)}\n`;
}

function manifestPayload(
	manifest: NativeRuntimePackageManifest,
): Omit<NativeRuntimePackageManifest, "manifestSha256"> {
	return {
		schemaVersion: manifest.schemaVersion,
		anchors: manifest.anchors,
		packages: manifest.packages,
	};
}

function dependencyNames(value: unknown): string[] {
	if (value === undefined) return [];
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("runtime package dependency map is invalid");
	return Object.keys(value).sort(compareCanonical);
}

function isStrictlySorted(values: readonly string[]): boolean {
	return values.every(
		(value, index) =>
			index === 0 || compareCanonical(value, values[index - 1] ?? value) > 0,
	);
}

function sortResolvedDependencies(
	dependencies: NativeRuntimeResolvedDependency[],
): NativeRuntimeResolvedDependency[] {
	return dependencies.sort((left, right) =>
		compareCanonical(
			`${left.kind}:${left.name}`,
			`${right.kind}:${right.name}`,
		),
	);
}

function dependencyAccountingIsInvalid(
	value: {
		declaredDependencies: NativeRuntimeDeclaredDependencies;
		resolvedDependencies: NativeRuntimeResolvedDependency[];
		missingOptionalDependencies: string[];
		missingPeerDependencies: string[];
	},
	roots: ReadonlySet<string>,
): boolean {
	const declared = value?.declaredDependencies;
	const resolved = value?.resolvedDependencies;
	const missingOptional = value?.missingOptionalDependencies;
	const missingPeer = value?.missingPeerDependencies;
	if (
		!declared ||
		!Array.isArray(declared.required) ||
		!Array.isArray(declared.optional) ||
		!Array.isArray(declared.peer) ||
		![declared.required, declared.optional, declared.peer].every(
			(names) =>
				names.every((name) => typeof name === "string" && name.length > 0) &&
				isStrictlySorted(names),
		) ||
		!Array.isArray(resolved) ||
		!Array.isArray(missingOptional) ||
		!Array.isArray(missingPeer)
	)
		return true;
	const keys = resolved.map(({ kind, name }) => `${kind}:${name}`);
	if (
		resolved.some(
			(dependency) =>
				!(["required", "optional", "peer"] as const).includes(
					dependency?.kind,
				) ||
				typeof dependency.name !== "string" ||
				dependency.name.length === 0 ||
				!isAbsolute(dependency.root) ||
				!roots.has(dependency.root),
		) ||
		!isStrictlySorted(keys) ||
		![missingOptional, missingPeer].every(
			(names) =>
				names.every((name) => typeof name === "string" && name.length > 0) &&
				isStrictlySorted(names),
		)
	)
		return true;
	const accounted = (kind: NativeRuntimeDependencyKind, missing: string[]) =>
		resolved
			.filter((dependency) => dependency.kind === kind)
			.map(({ name }) => name)
			.concat(missing)
			.sort(compareCanonical);
	return (
		JSON.stringify(accounted("required", [])) !==
			JSON.stringify(declared.required) ||
		JSON.stringify(accounted("optional", missingOptional)) !==
			JSON.stringify(declared.optional) ||
		JSON.stringify(accounted("peer", missingPeer)) !==
			JSON.stringify(declared.peer)
	);
}

function readPackageJson(root: string): PackageJson & {
	name: string;
	version: string;
} {
	const parsed = JSON.parse(
		readFileSync(join(root, "package.json"), "utf8"),
	) as PackageJson;
	if (typeof parsed.name !== "string" || typeof parsed.version !== "string")
		throw new Error(`runtime package identity is invalid: ${root}`);
	return { ...parsed, name: parsed.name, version: parsed.version };
}

function nearestPackageRoot(path: string): string {
	let cursor = realpathSync(path);
	if (!lstatSync(cursor).isDirectory()) cursor = dirname(cursor);
	for (;;) {
		if (existsSync(join(cursor, "package.json"))) return cursor;
		const parent = dirname(cursor);
		if (parent === cursor)
			throw new Error(
				`runtime hook is not inside an installed package: ${path}`,
			);
		cursor = parent;
	}
}

function resolveDependencyRoot(
	packageRoot: string,
	name: string,
): string | null {
	let cursor = packageRoot;
	for (;;) {
		const packageJson = join(
			cursor,
			"node_modules",
			...name.split("/"),
			"package.json",
		);
		if (existsSync(packageJson)) return realpathSync(dirname(packageJson));
		const parent = dirname(cursor);
		if (parent === cursor) break;
		cursor = parent;
	}
	const resolver = createRequire(join(packageRoot, "package.json"));
	const searchRoots = resolver.resolve.paths(name) ?? [];
	for (const searchRoot of searchRoots) {
		const packageJson = join(searchRoot, ...name.split("/"), "package.json");
		if (existsSync(packageJson)) return realpathSync(dirname(packageJson));
	}
	try {
		return nearestPackageRoot(resolver.resolve(name));
	} catch {
		return null;
	}
}

function packageRelative(root: string, path: string): string {
	const candidate = relative(root, path);
	if (
		candidate === "" ||
		candidate === ".." ||
		candidate.startsWith(`..${sep}`) ||
		isAbsolute(candidate)
	)
		throw new Error(`runtime package file escapes package root: ${path}`);
	return candidate.split(sep).join("/");
}

function packageFiles(root: string): NativeRuntimePackageFile[] {
	const files: NativeRuntimePackageFile[] = [];
	const pending = [root];
	while (pending.length > 0) {
		const directory = pending.pop();
		if (!directory) continue;
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (entry.name === "node_modules") continue;
			const path = join(directory, entry.name);
			if (entry.isSymbolicLink())
				throw new Error(`runtime package contains a symbolic link: ${path}`);
			if (entry.isDirectory()) {
				pending.push(path);
				continue;
			}
			if (!entry.isFile())
				throw new Error(`runtime package contains a special file: ${path}`);
			files.push({
				path: packageRelative(root, path),
				sha256: sha256File(path),
			});
		}
	}
	return files.sort((left, right) => compareCanonical(left.path, right.path));
}

export function buildNativeRuntimePackageManifest(
	hookPaths: readonly string[],
	dependencyAnchorRoots: readonly string[] = [],
): NativeRuntimePackageManifest {
	if (hookPaths.length === 0)
		throw new Error("runtime package manifest requires at least one hook");
	const pending = hookPaths.map(nearestPackageRoot);
	const anchors: NativeRuntimePackageManifest["anchors"] = [];
	for (const anchorPath of dependencyAnchorRoots) {
		const root = realpathSync(anchorPath);
		const packageJson = readPackageJson(root);
		const declaredDependencies = {
			required: dependencyNames(packageJson.dependencies),
			optional: dependencyNames(packageJson.optionalDependencies),
			peer: dependencyNames(packageJson.peerDependencies),
		};
		const resolvedDependencies: NativeRuntimeResolvedDependency[] = [];
		const missingOptionalDependencies: string[] = [];
		const missingPeerDependencies: string[] = [];
		for (const [kind, names, missing] of [
			["required", declaredDependencies.required, null],
			["optional", declaredDependencies.optional, missingOptionalDependencies],
			["peer", declaredDependencies.peer, missingPeerDependencies],
		] as const) {
			for (const name of names) {
				const dependencyRoot = resolveDependencyRoot(root, name);
				if (!dependencyRoot) {
					if (missing) missing.push(name);
					else throw new Error(`required runtime package is missing: ${name}`);
					continue;
				}
				resolvedDependencies.push({ kind, name, root: dependencyRoot });
				pending.push(dependencyRoot);
			}
		}
		anchors.push({
			root,
			packageJsonSha256: sha256(readFileSync(join(root, "package.json"))),
			declaredDependencies,
			resolvedDependencies: sortResolvedDependencies(resolvedDependencies),
			missingOptionalDependencies,
			missingPeerDependencies,
		});
	}
	const discovered = new Map<string, NativeRuntimePackageIdentity>();
	while (pending.length > 0) {
		const root = realpathSync(pending.pop() as string);
		if (discovered.has(root)) continue;
		const packageJson = readPackageJson(root);
		const required = dependencyNames(packageJson.dependencies);
		const optional = dependencyNames(packageJson.optionalDependencies);
		const peers = dependencyNames(packageJson.peerDependencies);
		const declaredDependencies = { required, optional, peer: peers };
		const missingOptionalDependencies: string[] = [];
		const missingPeerDependencies: string[] = [];
		const resolvedDependencies: NativeRuntimePackageIdentity["resolvedDependencies"] =
			[];
		for (const name of required) {
			const dependencyRoot = resolveDependencyRoot(root, name);
			if (!dependencyRoot)
				throw new Error(`required runtime package is missing: ${name}`);
			pending.push(dependencyRoot);
			resolvedDependencies.push({
				kind: "required",
				name,
				root: dependencyRoot,
			});
		}
		for (const [kind, names, missing] of [
			["optional", optional, missingOptionalDependencies],
			["peer", peers, missingPeerDependencies],
		] as const) {
			for (const name of names) {
				const dependencyRoot = resolveDependencyRoot(root, name);
				if (dependencyRoot) {
					pending.push(dependencyRoot);
					resolvedDependencies.push({ kind, name, root: dependencyRoot });
				} else missing.push(name);
			}
		}
		discovered.set(root, {
			name: packageJson.name,
			version: packageJson.version,
			root,
			files: packageFiles(root),
			declaredDependencies,
			resolvedDependencies: sortResolvedDependencies(resolvedDependencies),
			missingOptionalDependencies,
			missingPeerDependencies,
		});
	}
	const packages = [...discovered.values()].sort((left, right) =>
		compareCanonical(left.root, right.root),
	);
	const payload = {
		schemaVersion: NATIVE_RUNTIME_PACKAGE_MANIFEST_SCHEMA,
		anchors: anchors.sort((left, right) =>
			compareCanonical(left.root, right.root),
		),
		packages,
	};
	return { ...payload, manifestSha256: sha256(canonicalPayload(payload)) };
}

export function validateNativeRuntimePackageManifest(
	manifest: NativeRuntimePackageManifest,
): void {
	const roots = new Set(
		Array.isArray(manifest?.packages)
			? manifest.packages.map(({ root }) => root)
			: [],
	);
	let previousAnchorRoot = "";
	let previousRoot = "";
	if (
		manifest.schemaVersion !== NATIVE_RUNTIME_PACKAGE_MANIFEST_SCHEMA ||
		!Array.isArray(manifest.anchors) ||
		manifest.anchors.some((anchor) => {
			const invalid =
				!isAbsolute(anchor?.root) ||
				!/^[a-f0-9]{64}$/.test(anchor.packageJsonSha256) ||
				dependencyAccountingIsInvalid(anchor, roots) ||
				anchor.root <= previousAnchorRoot;
			previousAnchorRoot = anchor.root;
			return invalid;
		}) ||
		!Array.isArray(manifest.packages) ||
		manifest.packages.length === 0 ||
		manifest.packages.some((pkg) => {
			const filePaths = pkg?.files?.map(({ path }) => path) ?? [];
			const invalid =
				typeof pkg?.name !== "string" ||
				typeof pkg.version !== "string" ||
				!isAbsolute(pkg.root) ||
				!Array.isArray(pkg.files) ||
				pkg.files.length === 0 ||
				pkg.files.some(
					(file) =>
						typeof file?.path !== "string" ||
						file.path.length === 0 ||
						isAbsolute(file.path) ||
						file.path.split("/").includes("..") ||
						!/^[a-f0-9]{64}$/.test(file.sha256),
				) ||
				new Set(filePaths).size !== filePaths.length ||
				!isStrictlySorted(filePaths) ||
				dependencyAccountingIsInvalid(pkg, roots) ||
				pkg.root <= previousRoot;
			previousRoot = pkg.root;
			return invalid;
		}) ||
		manifest.manifestSha256 !==
			sha256(canonicalPayload(manifestPayload(manifest)))
	)
		throw new Error("runtime package manifest is internally inconsistent");
}

export function validateNativeRuntimePackageManifestHooks(
	manifest: NativeRuntimePackageManifest,
	hooks: readonly { path: string; sha256: string }[],
): void {
	validateNativeRuntimePackageManifest(manifest);
	if (hooks.length === 0)
		throw new Error("runtime package manifest requires at least one hook");
	for (const hook of hooks) {
		let observedPath: string;
		let observedSha256: string;
		try {
			observedPath = resolvedHookManifestPath(hook.path);
			observedSha256 = sha256(readFileSync(observedPath));
		} catch {
			throw new Error("runtime hook path is not observable");
		}
		if (observedPath !== hook.path || observedSha256 !== hook.sha256)
			throw new Error("runtime hook path or bytes changed");
		const matched = manifest.packages.some((pkg) => {
			let path: string;
			try {
				path = packageRelative(pkg.root, hook.path);
			} catch {
				return false;
			}
			return pkg.files.some(
				(file) => file.path === path && file.sha256 === hook.sha256,
			);
		});
		if (!matched)
			throw new Error("runtime hook is not bound to its package manifest");
	}
}

function resolvedHookManifestPath(path: string): string {
	if (!isAbsolute(path)) throw new Error("runtime hook path is not absolute");
	const resolved = realpathSync(path);
	if (!lstatSync(resolved).isFile())
		throw new Error("runtime hook is not a file");
	return resolved;
}

export function verifyNativeRuntimePackageManifest(
	expected: NativeRuntimePackageManifest,
	hookPaths: readonly string[],
): void {
	validateNativeRuntimePackageManifest(expected);
	const actual = buildNativeRuntimePackageManifest(
		hookPaths,
		expected.anchors.map(({ root }) => root),
	);
	if (
		canonicalPayload(manifestPayload(actual)) !==
		canonicalPayload(manifestPayload(expected))
	)
		throw new Error("runtime package manifest changed");
}
