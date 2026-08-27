import {
	MIRACL_MULTILINGUAL_CONTRACT,
	type MiraclEvidenceLanguage,
} from "./miracl-multilingual-contract.js";

export interface FullCorpusRuntimeMonitorPaths {
	language: MiraclEvidenceLanguage;
	launchPath: string;
	outputPath: string;
}

export function resolveFullCorpusRuntimeMonitorPaths(
	environment: NodeJS.ProcessEnv = process.env,
): FullCorpusRuntimeMonitorPaths {
	const language = environment.MIRACL_LANGUAGE ?? "ko";
	if (!Object.hasOwn(MIRACL_MULTILINGUAL_CONTRACT, language))
		throw new Error(`unsupported MIRACL runtime monitor language: ${language}`);
	return {
		language: language as MiraclEvidenceLanguage,
		launchPath:
			environment.MIRACL_FULL_LAUNCH_RECEIPT ??
			`reports/quality/miracl-${language}-full-corpus-launch-receipt.json`,
		outputPath:
			environment.MIRACL_FULL_RUNTIME_OBSERVATION ??
			`reports/quality/miracl-${language}-full-corpus-runtime-observation.json`,
	};
}

export function verifyFullCorpusRuntimeMonitorLanguage(
	expected: MiraclEvidenceLanguage,
	launch: { language?: unknown },
): void {
	if (launch.language !== expected)
		throw new Error(
			`runtime monitor language mismatch: expected ${expected}, received ${String(launch.language)}`,
		);
}
