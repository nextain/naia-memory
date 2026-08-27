import { basename, isAbsolute, normalize, resolve } from "node:path";
import {
	parseMiraclCorpusIdentityReceipt,
	sha256MiraclCorpusIdentity,
} from "./miracl-corpus-identity.js";
import {
	MIRACL_MULTILINGUAL_CONTRACT,
	type MiraclEvidenceLanguage,
} from "./miracl-multilingual-contract.js";

export function resolveEnglishCorpusIdentityBinding(
	environment: ReadonlyMap<string, string>,
	readJson: (path: string) => unknown,
): { receiptSha256: string; sourceLockSha256: string } | null {
	const language = resolveFullCorpusLanguage(environment);
	const path = environment.get("MIRACL_CORPUS_IDENTITY_RECEIPT");
	if (language !== "en") {
		if (path)
			throw new Error("corpus identity launch binding is reserved for English");
		return null;
	}
	if (!path)
		throw new Error("English launch requires a corpus identity receipt");
	const receipt = parseMiraclCorpusIdentityReceipt("en", readJson(path));
	return {
		receiptSha256: sha256MiraclCorpusIdentity(receipt),
		sourceLockSha256: receipt.sourceLockSha256,
	};
}

export function verifyEnglishCorpusIdentityLaunchChain(input: {
	language: MiraclEvidenceLanguage;
	receiptSha256?: string | null;
	launchSourceLockSha256?: string | null;
	resultSourceLockSha256: string;
}): void {
	if (input.language !== "en") {
		if (
			input.receiptSha256 != null ||
			input.launchSourceLockSha256 != null
		)
			throw new Error(
				"corpus identity launch chain is reserved for English",
			);
		return;
	}
	if (
		!input.receiptSha256 ||
		!/^[a-f0-9]{64}$/u.test(input.receiptSha256) ||
		!input.launchSourceLockSha256 ||
		!/^[a-f0-9]{64}$/u.test(input.launchSourceLockSha256) ||
		input.launchSourceLockSha256 !== input.resultSourceLockSha256
	)
		throw new Error("English corpus identity launch chain mismatch");
}

function isLanguageScopedPath(
	path: string,
	language: MiraclEvidenceLanguage,
): boolean {
	if (isAbsolute(path) || path.split(/[\\/]/u).includes("..")) return false;
	return basename(normalize(path)).startsWith(
		`miracl-${language}-full-corpus-`,
	);
}

export function resolveFullCorpusLanguage(
	environment: ReadonlyMap<string, string>,
): MiraclEvidenceLanguage {
	const language = environment.get("MIRACL_LANGUAGE") ?? "ko";
	if (!Object.hasOwn(MIRACL_MULTILINGUAL_CONTRACT, language))
		throw new Error("live benchmark MIRACL language is invalid");
	return language as MiraclEvidenceLanguage;
}

export function resolveFullCorpusOutputPath(
	environment: ReadonlyMap<string, string>,
): string {
	const language = resolveFullCorpusLanguage(environment);
	const path =
		environment.get("MIRACL_FULL_OUTPUT") ??
		`reports/quality/miracl-${language}-full-corpus-vector-exact.json`;
	if (!isLanguageScopedPath(path, language))
		throw new Error("full-corpus output path is not language scoped");
	return path;
}

export function resolveFullCorpusLaunchReceiptPath(
	environment: ReadonlyMap<string, string>,
): string {
	const language = resolveFullCorpusLanguage(environment);
	const path =
		environment.get("MIRACL_FULL_LAUNCH_RECEIPT") ??
		`reports/quality/miracl-${language}-full-corpus-launch-receipt.json`;
	if (!isLanguageScopedPath(path, language))
		throw new Error("full-corpus launch receipt path is not language scoped");
	if (resolve(path) === resolve(resolveFullCorpusOutputPath(environment)))
		throw new Error("launch receipt and benchmark output paths collide");
	return path;
}

export function resolveFullCorpusLaunchReceiptOutput(
	environment: ReadonlyMap<string, string>,
	override: string | undefined,
): string {
	const language = resolveFullCorpusLanguage(environment);
	const path = override ?? resolveFullCorpusLaunchReceiptPath(environment);
	if (!isLanguageScopedPath(path, language))
		throw new Error("launch receipt override path is not language scoped");
	if (resolve(path) === resolve(resolveFullCorpusOutputPath(environment)))
		throw new Error(
			"launch receipt override and benchmark output paths collide",
		);
	return path;
}
