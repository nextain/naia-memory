import { basename, isAbsolute, normalize, resolve } from "node:path";
import {
	MIRACL_MULTILINGUAL_CONTRACT,
	type MiraclEvidenceLanguage,
} from "./miracl-multilingual-contract.js";

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
