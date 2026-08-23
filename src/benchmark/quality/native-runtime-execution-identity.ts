import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type NativeRuntimePackageManifest,
	buildNativeRuntimePackageManifest,
	validateNativeRuntimePackageManifestHooks,
} from "./native-runtime-package-manifest.js";

export const NATIVE_RUNTIME_EXECUTION_IDENTITY_SCHEMA =
	"naia-native-runtime-execution-identity-v2";

export interface NativeRuntimeHookIdentity {
	flag: "--experimental-loader" | "--import" | "--loader" | "--require" | "-r";
	argumentIndex: number;
	specifier: string;
	path: string;
	sha256: string;
}

export interface NativeRuntimeExecutionIdentity {
	schemaVersion: typeof NATIVE_RUNTIME_EXECUTION_IDENTITY_SCHEMA;
	nodeVersion: string;
	executable: { path: string; sha256: string };
	execArgv: string[];
	hooks: NativeRuntimeHookIdentity[];
	packageManifest: NativeRuntimePackageManifest;
	environment: {
		nodeOptions: string | null;
		nodePath: string | null;
		tsxTsconfigPath: string | null;
	};
	identitySha256: string;
}

interface RuntimeExecutionIdentityInput {
	nodeVersion: string;
	execPath: string;
	execArgv: readonly string[];
	environment: {
		NODE_OPTIONS?: string;
		NODE_PATH?: string;
		TSX_TSCONFIG_PATH?: string;
	};
	dependencyAnchorRoots?: readonly string[];
}

const sha256 = (bytes: Uint8Array | string) =>
	createHash("sha256").update(bytes).digest("hex");

function canonicalPayload(
	identity: Omit<NativeRuntimeExecutionIdentity, "identitySha256">,
): string {
	return `${JSON.stringify(identity)}\n`;
}

function identityPayload(
	identity: NativeRuntimeExecutionIdentity,
): Omit<NativeRuntimeExecutionIdentity, "identitySha256"> {
	return {
		schemaVersion: identity.schemaVersion,
		nodeVersion: identity.nodeVersion,
		executable: identity.executable,
		execArgv: identity.execArgv,
		hooks: identity.hooks,
		packageManifest: identity.packageManifest,
		environment: identity.environment,
	};
}

function resolvedHookPath(specifier: string): string {
	const unresolved = specifier.startsWith("file:")
		? fileURLToPath(specifier)
		: specifier;
	if (!isAbsolute(unresolved))
		throw new Error(`runtime hook is not file-bindable: ${specifier}`);
	const path = realpathSync(unresolved);
	if (!statSync(path).isFile())
		throw new Error(`runtime hook is not a file: ${specifier}`);
	return path;
}

function declaredHooks(execArgv: readonly string[]) {
	const hooks: Array<{
		flag: NativeRuntimeHookIdentity["flag"];
		argumentIndex: number;
		specifier: string;
	}> = [];
	const flags = [
		"--experimental-loader",
		"--import",
		"--loader",
		"--require",
		"-r",
	] as const;
	for (let index = 0; index < execArgv.length; index += 1) {
		const argument = execArgv[index] as string;
		let flag: (typeof flags)[number] | undefined;
		let specifier: string | undefined;
		for (const candidate of flags) {
			if (argument === candidate) {
				flag = candidate;
				specifier = execArgv[index + 1];
				break;
			}
			if (argument.startsWith(`${candidate}=`)) {
				flag = candidate;
				specifier = argument.slice(candidate.length + 1);
				break;
			}
		}
		if (!flag) continue;
		if (!specifier) throw new Error(`runtime hook value is missing: ${flag}`);
		hooks.push({
			flag,
			argumentIndex: index,
			specifier,
		});
		if (argument === flag) index += 1;
	}
	return hooks;
}

function discoverHooks(
	execArgv: readonly string[],
): NativeRuntimeHookIdentity[] {
	return declaredHooks(execArgv).map((hook) => {
		const path = resolvedHookPath(hook.specifier);
		return { ...hook, path, sha256: sha256(readFileSync(path)) };
	});
}

export function buildNativeRuntimeExecutionIdentity(
	input: RuntimeExecutionIdentityInput,
): NativeRuntimeExecutionIdentity {
	if (
		input.environment.NODE_OPTIONS ||
		input.environment.NODE_PATH ||
		input.environment.TSX_TSCONFIG_PATH
	)
		throw new Error(
			"runtime environment overrides are not allowed for completion evidence",
		);
	const executablePath = realpathSync(input.execPath);
	if (!statSync(executablePath).isFile())
		throw new Error("Node executable is not a file");
	const hooks = discoverHooks(input.execArgv);
	const payload = {
		schemaVersion: NATIVE_RUNTIME_EXECUTION_IDENTITY_SCHEMA,
		nodeVersion: input.nodeVersion,
		executable: {
			path: executablePath,
			sha256: sha256(readFileSync(executablePath)),
		},
		execArgv: [...input.execArgv],
		hooks,
		packageManifest: buildNativeRuntimePackageManifest(
			hooks.map(({ path }) => path),
			input.dependencyAnchorRoots,
		),
		environment: {
			nodeOptions: input.environment.NODE_OPTIONS ?? null,
			nodePath: input.environment.NODE_PATH ?? null,
			tsxTsconfigPath: input.environment.TSX_TSCONFIG_PATH ?? null,
		},
	};
	return { ...payload, identitySha256: sha256(canonicalPayload(payload)) };
}

export function captureNativeRuntimeExecutionIdentity(
	environment = process.env,
	dependencyAnchorRoots: readonly string[] = [],
): NativeRuntimeExecutionIdentity {
	return buildNativeRuntimeExecutionIdentity({
		nodeVersion: process.version,
		execPath: process.execPath,
		execArgv: process.execArgv,
		environment,
		dependencyAnchorRoots,
	});
}

export function validateNativeRuntimeExecutionIdentity(
	identity: NativeRuntimeExecutionIdentity,
): void {
	let declared: ReturnType<typeof declaredHooks> = [];
	try {
		declared = declaredHooks(identity.execArgv);
	} catch {
		throw new Error("runtime execution identity is internally inconsistent");
	}
	try {
		for (const hook of identity.hooks) {
			const path = resolvedHookPath(hook.specifier);
			if (path !== hook.path || sha256(readFileSync(path)) !== hook.sha256)
				throw new Error("runtime hook declaration changed");
		}
		validateNativeRuntimePackageManifestHooks(
			identity.packageManifest,
			identity.hooks,
		);
	} catch {
		throw new Error("runtime execution identity is internally inconsistent");
	}
	const payload = identityPayload(identity);
	if (
		identity.schemaVersion !== NATIVE_RUNTIME_EXECUTION_IDENTITY_SCHEMA ||
		!/^v\d+\.\d+\.\d+/.test(identity.nodeVersion) ||
		typeof identity.executable?.path !== "string" ||
		!isAbsolute(identity.executable.path) ||
		!/^[a-f0-9]{64}$/.test(identity.executable.sha256) ||
		!Array.isArray(identity.execArgv) ||
		identity.execArgv.some((argument) => typeof argument !== "string") ||
		!Array.isArray(identity.hooks) ||
		identity.hooks.length !== declared.length ||
		identity.hooks.some(
			(hook, index) =>
				hook.flag !== declared[index]?.flag ||
				hook.argumentIndex !== declared[index]?.argumentIndex ||
				hook.specifier !== declared[index]?.specifier ||
				!(
					[
						"--experimental-loader",
						"--import",
						"--loader",
						"--require",
						"-r",
					] as const
				).includes(hook.flag) ||
				!Number.isSafeInteger(hook.argumentIndex) ||
				hook.argumentIndex < 0 ||
				typeof hook.specifier !== "string" ||
				!isAbsolute(hook.path) ||
				!/^[a-f0-9]{64}$/.test(hook.sha256) ||
				!([hook.flag, `${hook.flag}=${hook.specifier}`] as string[]).includes(
					identity.execArgv[hook.argumentIndex] as string,
				) ||
				(identity.execArgv[hook.argumentIndex] === hook.flag &&
					identity.execArgv[hook.argumentIndex + 1] !== hook.specifier),
		) ||
		identity.environment?.nodeOptions !== null ||
		identity.environment.nodePath !== null ||
		identity.environment.tsxTsconfigPath !== null ||
		identity.identitySha256 !== sha256(canonicalPayload(payload))
	)
		throw new Error("runtime execution identity is internally inconsistent");
}

export function verifyNativeRuntimeExecutionIdentity(
	expected: NativeRuntimeExecutionIdentity,
	environment = process.env,
): void {
	validateNativeRuntimeExecutionIdentity(expected);
	const actual = captureNativeRuntimeExecutionIdentity(
		environment,
		expected.packageManifest.anchors.map(({ root }) => root),
	);
	if (
		canonicalPayload(identityPayload(actual)) !==
		canonicalPayload(identityPayload(expected))
	)
		throw new Error("runtime execution identity changed");
}
