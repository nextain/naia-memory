import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
	PublicEvidenceFileTooLargeError,
	readBoundedEvidenceFile,
} from "./public-evidence-file-io.js";
import { evaluatePublicEvidenceFiles } from "./public-evidence-gate.js";
import { isPublicEvidenceTrustPolicy } from "./public-evidence-types.js";
import { isPublicEvidenceManifest } from "./public-manifest-validator.js";

export type PublicEvidenceCliResult = {
	promotable: boolean;
	failures: string[];
};

const MAX_INTAKE_JSON_BYTES = 1024 * 1024;

async function readJson(path: string, label: string): Promise<unknown> {
	let bytes: Buffer;
	try {
		bytes = await readBoundedEvidenceFile(path, MAX_INTAKE_JSON_BYTES);
	} catch (error) {
		if (error instanceof PublicEvidenceFileTooLargeError)
			throw new Error(`${label} exceeds the 1 MiB intake limit`);
		throw new Error(`${label} is unreadable`);
	}
	try {
		return JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new Error(`${label} is not valid JSON`);
	}
}

async function evidenceRealpath(path: string, label: string): Promise<string> {
	try {
		return await realpath(path);
	} catch {
		throw new Error(`${label} is unreadable`);
	}
}

/** Evaluates a submitted bundle while keeping verifier trust outside that bundle. */
export async function evaluatePublicEvidenceBundle(
	manifestPath: string,
	trustPolicyPath: string,
): Promise<PublicEvidenceCliResult> {
	const absoluteManifest = resolve(manifestPath);
	const absoluteTrustPolicy = resolve(trustPolicyPath);
	try {
		const canonicalManifest = await evidenceRealpath(
			absoluteManifest,
			"manifest",
		);
		const evidenceRoot = dirname(canonicalManifest);
		const trustedPath = await evidenceRealpath(
			absoluteTrustPolicy,
			"trust policy",
		);
		const trustRelative = relative(evidenceRoot, trustedPath);
		const trustIsOutside =
			trustRelative === ".." ||
			trustRelative.startsWith(`..${sep}`) ||
			isAbsolute(trustRelative);
		if (!trustIsOutside)
			return {
				promotable: false,
				failures: ["trust policy must be outside the submitted evidence root"],
			};
		const manifest = await readJson(canonicalManifest, "manifest");
		const trustPolicy = await readJson(trustedPath, "trust policy");
		if (!isPublicEvidenceManifest(manifest))
			return { promotable: false, failures: ["manifest shape is invalid"] };
		if (!isPublicEvidenceTrustPolicy(trustPolicy))
			return { promotable: false, failures: ["trust policy shape is invalid"] };
		return evaluatePublicEvidenceFiles(manifest, evidenceRoot, trustPolicy);
	} catch (error) {
		return {
			promotable: false,
			failures: [
				error instanceof Error &&
				/^(manifest|trust policy) (is|exceeds)/.test(error.message)
					? error.message
					: "evidence intake failed",
			],
		};
	}
}

export async function runPublicEvidenceCli(args: string[]): Promise<number> {
	if (args.length !== 2) {
		process.stderr.write(
			"Usage: pnpm benchmark:public-evidence <manifest.json> <verifier-trust-policy.json>\n",
		);
		return 2;
	}
	const result = await evaluatePublicEvidenceBundle(args[0], args[1]);
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	return result.promotable ? 0 : 1;
}

const invokedPath =
	process.argv[1] && pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url)
	process.exitCode = await runPublicEvidenceCli(process.argv.slice(2));
