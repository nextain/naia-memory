import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import ts from "typescript";

export const NATIVE_RUNTIME_SOURCE_MANIFEST_SCHEMA =
	"naia-native-runtime-source-manifest-v1";

export interface NativeRuntimeSourceEntry {
	path: string;
	sha256: string;
}

export interface NativeRuntimeSourceManifest {
	schemaVersion: typeof NATIVE_RUNTIME_SOURCE_MANIFEST_SCHEMA;
	entryPoint: string;
	additionalInputs: string[];
	files: NativeRuntimeSourceEntry[];
	manifestSha256: string;
}

const sha256 = (bytes: Uint8Array | string) =>
	createHash("sha256").update(bytes).digest("hex");

function canonicalPayload(
	manifest: Omit<NativeRuntimeSourceManifest, "manifestSha256">,
): string {
	return `${JSON.stringify(manifest)}\n`;
}

export function validateNativeRuntimeSourceManifest(
	expected: NativeRuntimeSourceManifest,
): void {
	if (
		!Array.isArray(expected.additionalInputs) ||
		!Array.isArray(expected.files) ||
		expected.additionalInputs.some((path) => typeof path !== "string") ||
		expected.files.some(
			(entry) =>
				typeof entry?.path !== "string" || typeof entry.sha256 !== "string",
		)
	)
		throw new Error("runtime source manifest shape is invalid");
	const expectedPayload = {
		schemaVersion: expected.schemaVersion,
		entryPoint: expected.entryPoint,
		additionalInputs: [...expected.additionalInputs],
		files: expected.files.map(({ path, sha256 }) => ({ path, sha256 })),
	};
	if (
		expected.schemaVersion !== NATIVE_RUNTIME_SOURCE_MANIFEST_SCHEMA ||
		expected.manifestSha256 !== sha256(canonicalPayload(expectedPayload))
	)
		throw new Error("runtime source manifest is internally inconsistent");
}

function rootRelative(root: string, path: string): string {
	const candidate = relative(root, path);
	if (
		candidate === "" ||
		candidate === ".." ||
		candidate.startsWith(`..${sep}`) ||
		isAbsolute(candidate)
	)
		throw new Error(`source path escapes repository root: ${path}`);
	return candidate.split(sep).join("/");
}

function resolveLocalImport(importer: string, specifier: string): string {
	const unresolved = resolve(dirname(importer), specifier);
	const candidates = [unresolved];
	if (specifier.endsWith(".js")) {
		candidates.push(`${unresolved.slice(0, -3)}.ts`);
		candidates.push(`${unresolved.slice(0, -3)}.tsx`);
	} else if (!specifier.match(/\.[cm]?[jt]sx?$/)) {
		candidates.push(`${unresolved}.ts`, `${unresolved}.tsx`);
		candidates.push(resolve(unresolved, "index.ts"));
		candidates.push(resolve(unresolved, "index.tsx"));
	}
	const matches = candidates.filter(
		(path) => existsSync(path) && statSync(path).isFile(),
	);
	if (matches.length !== 1)
		throw new Error(
			`relative import must resolve to exactly one source: ${specifier} from ${importer}`,
		);
	return realpathSync(matches[0] as string);
}

function discoverStaticUrlReferences(source: string, path: string): string[] {
	const sourceFile = ts.createSourceFile(
		path,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const references: string[] = [];
	const visit = (node: ts.Node): void => {
		if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			(node.arguments.length !== 1 ||
				!ts.isStringLiteralLike(node.arguments[0] as ts.Expression))
		)
			throw new Error(`dynamic import is not statically bindable: ${path}`);
		if (
			ts.isNewExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === "URL" &&
			node.arguments?.[1]?.getText(sourceFile) === "import.meta.url"
		) {
			const target = node.arguments[0];
			if (!target || !ts.isStringLiteralLike(target))
				throw new Error(`import.meta.url target is not static: ${path}`);
			if (target.text.startsWith(".")) references.push(target.text);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return references;
}

export function buildNativeRuntimeSourceManifest(input: {
	root: string;
	entryPoint: string;
	additionalInputs?: readonly string[];
}): NativeRuntimeSourceManifest {
	const root = realpathSync(resolve(input.root));
	const entryPoint = realpathSync(resolve(root, input.entryPoint));
	const relativeEntryPoint = rootRelative(root, entryPoint);
	if (relativeEntryPoint.includes("\\")) throw new Error("non-canonical path");
	const pending = [entryPoint];
	const discovered = new Map<string, string>();

	while (pending.length > 0) {
		const path = pending.pop();
		if (path === undefined || discovered.has(path)) continue;
		const relativePath = rootRelative(root, path);
		const bytes = readFileSync(path);
		discovered.set(path, sha256(bytes));
		const source = bytes.toString("utf8");
		const preprocessing = ts.preProcessFile(source, true, true);
		for (const imported of [
			...preprocessing.importedFiles,
			...preprocessing.referencedFiles,
		]) {
			if (!imported.fileName.startsWith(".")) continue;
			pending.push(resolveLocalImport(path, imported.fileName));
		}
		for (const reference of discoverStaticUrlReferences(source, path))
			pending.push(resolveLocalImport(path, reference));
		if (relativePath.includes("\\")) throw new Error("non-canonical path");
	}

	const additionalInputs: string[] = [];
	for (const inputPath of input.additionalInputs ?? []) {
		const path = realpathSync(resolve(root, inputPath));
		const relativePath = rootRelative(root, path);
		if (relativePath.includes("\\")) throw new Error("non-canonical path");
		additionalInputs.push(relativePath);
		discovered.set(path, sha256(readFileSync(path)));
	}
	additionalInputs.sort();
	if (new Set(additionalInputs).size !== additionalInputs.length)
		throw new Error("additional inputs must be unique");

	const files = [...discovered]
		.map(([path, digest]) => ({
			path: rootRelative(root, path),
			sha256: digest,
		}))
		.sort((left, right) =>
			left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
		);
	const payload = {
		schemaVersion: NATIVE_RUNTIME_SOURCE_MANIFEST_SCHEMA,
		entryPoint: relativeEntryPoint,
		additionalInputs,
		files,
	};
	return { ...payload, manifestSha256: sha256(canonicalPayload(payload)) };
}

export function verifyNativeRuntimeSourceManifest(
	root: string,
	expected: NativeRuntimeSourceManifest,
): void {
	validateNativeRuntimeSourceManifest(expected);
	const expectedPayload = {
		schemaVersion: expected.schemaVersion,
		entryPoint: expected.entryPoint,
		additionalInputs: [...expected.additionalInputs],
		files: expected.files.map(({ path, sha256 }) => ({ path, sha256 })),
	};
	const actual = buildNativeRuntimeSourceManifest({
		root,
		entryPoint: expected.entryPoint,
		additionalInputs: expected.additionalInputs,
	});
	const actualPayload = {
		schemaVersion: actual.schemaVersion,
		entryPoint: actual.entryPoint,
		additionalInputs: actual.additionalInputs,
		files: actual.files,
	};
	if (
		canonicalPayload(actualPayload) !== canonicalPayload(expectedPayload) ||
		actual.manifestSha256 !== expected.manifestSha256
	)
		throw new Error("runtime source manifest changed");
}
