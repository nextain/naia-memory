import { createHash } from "node:crypto";

export type MultilingualTrueBatchLanguage = "ar" | "en";
type InferenceMode = "per-item-v1" | "padded-array-batch-v1";

export const MULTILINGUAL_TRUE_BATCH_MODEL =
	"Xenova/multilingual-e5-large" as const;
export const MULTILINGUAL_TRUE_BATCH_MODEL_REVISION =
	"00fc3aeb3dbb95842de2ac1961d33c6319acf57b" as const;
export const MULTILINGUAL_TRUE_BATCH_INPUT_COMPOSITION =
	"raw probe text" as const;
export const MULTILINGUAL_TRUE_BATCH_THRESHOLDS = {
	maximumAbsoluteDelta: 1e-4,
	minimumCosine: 0.99999,
} as const;
export const MULTILINGUAL_TRUE_BATCH_CLAIM_BOUNDARY =
	"synthetic frozen language-specific padding probe; a PASS requires separately generated model vectors and establishes neither MIRACL retrieval quality nor throughput" as const;

export interface MultilingualEquivalenceExpectedIdentity {
	model: typeof MULTILINGUAL_TRUE_BATCH_MODEL;
	modelRevision: typeof MULTILINGUAL_TRUE_BATCH_MODEL_REVISION;
	policySha256: string;
	producerSourceSha256: string;
}

export const MULTILINGUAL_TRUE_BATCH_EQUIVALENCE_TEXTS = {
	ar: [
		"أبحث عن مكان هادئ للعمل في القاهرة.",
		"يراجع المستخدم خطته الأسبوعية صباح كل يوم اثنين.",
		"لا أشرب القهوة، لكنني أفضل الشاي الدافئ.",
		"تغيّر موعد الاجتماع من الثالثة إلى الرابعة مساءً.",
		"العنوان السابق كان في عمّان، والعنوان الحالي في دبي.",
		"تاريخ انتهاء جواز السفر هو ٣ نوفمبر ٢٠٢٨.",
		"يجب تجنب الطعام الذي يحتوي على الفول السوداني بسبب الحساسية.",
		"طلب memory update عربي وإنجليزي مختلط.",
		"نص قصير",
		"  مسافات قبل النص وبعده  ",
		"سعر المنتج 12,500 ريال ثم عُدّل إلى 13,000 ريال.",
		"العربية تُكتب من اليمين إلى اليسار (RTL)، بينما API تُكتب من اليسار إلى اليمين.",
		"",
		"فحص حدود الذاكرة والتضمين ".repeat(700),
	],
	en: [
		"I am looking for a quiet place to work in London.",
		"The user reviews the weekly plan every Monday morning.",
		"I do not drink coffee, but I like warm barley tea.",
		"The meeting moved from 3:00 p.m. to 4:00 p.m. Friday.",
		"The previous address was Boston; the current address is Seattle.",
		"The passport expires on November 3, 2028.",
		"Avoid food containing peanuts because of an allergy.",
		"A 한국어 and English mixed memory update request.",
		"short text",
		"  leading and trailing whitespace  ",
		"The price changed from $12,500 to $13,000.",
		"Keep API_v2, user-id:42, and café punctuation intact.",
		"",
		"memory update padding boundary check ".repeat(700),
	],
} as const satisfies Record<MultilingualTrueBatchLanguage, readonly string[]>;

export interface MultilingualEquivalenceObservation {
	schemaVersion: 1;
	language: MultilingualTrueBatchLanguage;
	mode: InferenceMode;
	inputSha256: string;
	policySha256: string;
	policyBasisMode: "per-item-v1";
	model: typeof MULTILINGUAL_TRUE_BATCH_MODEL;
	modelRevision: typeof MULTILINGUAL_TRUE_BATCH_MODEL_REVISION;
	producerSourceSha256: string;
	vectors: number[][];
}

export function multilingualEquivalenceInputSha256(
	language: MultilingualTrueBatchLanguage,
): string {
	return createHash("sha256")
		.update(
			`${JSON.stringify(MULTILINGUAL_TRUE_BATCH_EQUIVALENCE_TEXTS[language])}\n`,
		)
		.digest("hex");
}

function assertObservation(
	value: MultilingualEquivalenceObservation,
	language: MultilingualTrueBatchLanguage,
	mode: InferenceMode,
	expected: MultilingualEquivalenceExpectedIdentity,
): void {
	if (
		value.schemaVersion !== 1 ||
		value.language !== language ||
		value.mode !== mode
	)
		throw new Error(`${language}/${mode}: observation identity mismatch`);
	if (value.inputSha256 !== multilingualEquivalenceInputSha256(language))
		throw new Error(`${language}/${mode}: input hash mismatch`);
	if (!/^[a-f0-9]{64}$/.test(value.policySha256))
		throw new Error(`${language}/${mode}: policy hash is invalid`);
	if (value.policyBasisMode !== "per-item-v1")
		throw new Error(`${language}/${mode}: policy basis mode mismatch`);
	if (
		value.model !== expected.model ||
		value.modelRevision !== expected.modelRevision ||
		value.producerSourceSha256 !== expected.producerSourceSha256
	)
		throw new Error(`${language}/${mode}: producer identity mismatch`);
	if (!Array.isArray(value.vectors))
		throw new Error(`${language}/${mode}: vectors are invalid`);
	const dimensions = value.vectors[0]?.length;
	if (
		value.vectors.length !==
			MULTILINGUAL_TRUE_BATCH_EQUIVALENCE_TEXTS[language].length ||
		!dimensions ||
		value.vectors.some(
			(vector) =>
				vector.length !== dimensions ||
				vector.some((item) => !Number.isFinite(item)),
		)
	)
		throw new Error(`${language}/${mode}: vectors are invalid`);
}

export function analyzeMultilingualTrueBatchEquivalence(
	language: MultilingualTrueBatchLanguage,
	expected: MultilingualEquivalenceExpectedIdentity,
	baseline: MultilingualEquivalenceObservation,
	candidate: MultilingualEquivalenceObservation,
) {
	if (
		![expected.policySha256, expected.producerSourceSha256].every((value) =>
			/^[a-f0-9]{64}$/.test(value),
		)
	)
		throw new Error("expected provenance hash is invalid");
	if (
		expected.model !== MULTILINGUAL_TRUE_BATCH_MODEL ||
		expected.modelRevision !== MULTILINGUAL_TRUE_BATCH_MODEL_REVISION
	)
		throw new Error("expected model identity is invalid");
	assertObservation(baseline, language, "per-item-v1", expected);
	assertObservation(candidate, language, "padded-array-batch-v1", expected);
	if (
		baseline.policySha256 !== expected.policySha256 ||
		candidate.policySha256 !== expected.policySha256
	)
		throw new Error("embedding policies differ");
	if (baseline.vectors[0]?.length !== candidate.vectors[0]?.length)
		throw new Error("embedding dimensions differ");
	let maxAbsoluteDelta = 0;
	let minimumCosine = 1;
	for (let index = 0; index < baseline.vectors.length; index += 1) {
		const left = baseline.vectors[index] ?? [];
		const right = candidate.vectors[index] ?? [];
		let dot = 0;
		let leftNorm = 0;
		let rightNorm = 0;
		for (let dimension = 0; dimension < left.length; dimension += 1) {
			const a = left[dimension] ?? Number.NaN;
			const b = right[dimension] ?? Number.NaN;
			maxAbsoluteDelta = Math.max(maxAbsoluteDelta, Math.abs(a - b));
			dot += a * b;
			leftNorm += a * a;
			rightNorm += b * b;
		}
		const cosine = dot / Math.sqrt(leftNorm * rightNorm);
		if (!Number.isFinite(cosine))
			throw new Error(`vector ${index}: cosine is invalid`);
		minimumCosine = Math.min(minimumCosine, cosine);
	}
	const thresholds = MULTILINGUAL_TRUE_BATCH_THRESHOLDS;
	const checks = {
		maximumAbsoluteDelta: maxAbsoluteDelta <= thresholds.maximumAbsoluteDelta,
		minimumCosine: minimumCosine >= thresholds.minimumCosine,
	};
	return {
		schemaVersion: 1 as const,
		artifactClass: "preflight-probe-evidence" as const,
		benchmark: `naia-${language}-per-item-vs-true-batch-vector-probe-v1`,
		language,
		claimBoundary: MULTILINGUAL_TRUE_BATCH_CLAIM_BOUNDARY,
		inputSha256: baseline.inputSha256,
		policySha256: baseline.policySha256,
		policyBasisMode: baseline.policyBasisMode,
		model: baseline.model,
		modelRevision: baseline.modelRevision,
		producerSourceSha256: baseline.producerSourceSha256,
		dimensions: baseline.vectors[0]?.length,
		thresholds,
		observed: { maxAbsoluteDelta, minimumCosine },
		checks,
		verdict: Object.values(checks).every(Boolean)
			? ("PASS" as const)
			: ("FAIL" as const),
	};
}
