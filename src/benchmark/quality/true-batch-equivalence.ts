import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const TRUE_BATCH_EQUIVALENCE_TEXTS = [
	"서울에서 조용한 작업 공간을 찾고 있어요.",
	"사용자는 매주 월요일 오전에 주간 계획을 검토한다.",
	"커피는 마시지 않지만 따뜻한 보리차를 좋아한다.",
	"회의 일정이 금요일 오후 세 시에서 네 시로 변경되었다.",
	"이전 주소는 부산이었고 현재 주소는 제주도이다.",
	"여권 만료일은 2028년 11월 3일이다.",
	"알레르기 때문에 땅콩이 포함된 음식은 피해야 한다.",
	"프로젝트 이름은 나이아 메모리이며 한국어 기억 갱신을 평가한다.",
	"짧은 문장",
	"서로 다른 길이의 입력을 함께 패딩해도 각 문장의 의미 벡터가 개별 추론 결과와 같아야 한다. 이 문장은 패딩 경계와 어텐션 마스크 처리를 확인하기 위해 의도적으로 더 길게 작성되었다.",
	"영어와 한국어가 섞인 memory update 요청도 안정적으로 처리해야 한다.",
	"가격은 12,500원에서 13,000원으로 수정되었다.",
] as const;

export interface EquivalenceObservation {
	schemaVersion: 1;
	mode: "per-item-v1" | "padded-array-batch-v1";
	inputSha256: string;
	policySha256: string;
	vectors: number[][];
}

export function equivalenceInputSha256(): string {
	return createHash("sha256")
		.update(`${JSON.stringify(TRUE_BATCH_EQUIVALENCE_TEXTS)}\n`)
		.digest("hex");
}

function assertObservation(
	value: EquivalenceObservation,
	expectedMode: EquivalenceObservation["mode"],
): void {
	if (value.schemaVersion !== 1 || value.mode !== expectedMode)
		throw new Error(`${expectedMode}: observation identity mismatch`);
	if (value.inputSha256 !== equivalenceInputSha256())
		throw new Error(`${expectedMode}: input hash mismatch`);
	if (!/^[a-f0-9]{64}$/.test(value.policySha256))
		throw new Error(`${expectedMode}: policy hash is invalid`);
	if (value.vectors.length !== TRUE_BATCH_EQUIVALENCE_TEXTS.length)
		throw new Error(`${expectedMode}: vector count mismatch`);
	const dimensions = value.vectors[0]?.length;
	if (
		!dimensions ||
		value.vectors.some(
			(vector) =>
				vector.length !== dimensions ||
				vector.some((item) => !Number.isFinite(item)),
		)
	)
		throw new Error(`${expectedMode}: vectors are invalid`);
}

export function analyzeTrueBatchEquivalence(
	baseline: EquivalenceObservation,
	candidate: EquivalenceObservation,
) {
	assertObservation(baseline, "per-item-v1");
	assertObservation(candidate, "padded-array-batch-v1");
	if (baseline.policySha256 !== candidate.policySha256)
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
	const thresholds = { maximumAbsoluteDelta: 1e-4, minimumCosine: 0.99999 };
	const checks = {
		maximumAbsoluteDelta: maxAbsoluteDelta <= thresholds.maximumAbsoluteDelta,
		minimumCosine: minimumCosine >= thresholds.minimumCosine,
	};
	return {
		schemaVersion: 1 as const,
		benchmark:
			"miracl-ko-per-item-vs-true-batch-vector-equivalence-v1" as const,
		claimBoundary:
			"fixed Korean padding-sensitive sample; does not establish retrieval quality or throughput",
		inputSha256: baseline.inputSha256,
		policySha256: baseline.policySha256,
		thresholds,
		observed: { maxAbsoluteDelta, minimumCosine },
		checks,
		verdict: Object.values(checks).every(Boolean)
			? ("PASS" as const)
			: ("FAIL" as const),
	};
}

function canonical(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

export function verifyTrueBatchEquivalenceEvidenceFiles(
	environment: NodeJS.ProcessEnv,
): void {
	const baselinePath =
		environment.MIRACL_EQUIVALENCE_BASELINE ??
		"reports/quality/miracl-ko-true-batch-equivalence-per-item.json";
	const candidatePath =
		environment.MIRACL_EQUIVALENCE_CANDIDATE ??
		"reports/quality/miracl-ko-true-batch-equivalence-true-batch.json";
	const evidencePath =
		environment.MIRACL_TRUE_BATCH_EQUIVALENCE_EVIDENCE ??
		"reports/quality/miracl-ko-true-batch-equivalence.evidence.json";
	const expected = analyzeTrueBatchEquivalence(
		JSON.parse(readFileSync(baselinePath, "utf8")) as EquivalenceObservation,
		JSON.parse(readFileSync(candidatePath, "utf8")) as EquivalenceObservation,
	);
	if (expected.verdict !== "PASS")
		throw new Error("passing true-batch equivalence evidence is required");
	const evidenceBytes = readFileSync(evidencePath, "utf8");
	let evidence: unknown;
	try {
		evidence = JSON.parse(evidenceBytes);
	} catch {
		throw new Error("true-batch equivalence evidence is invalid JSON");
	}
	if (
		evidenceBytes !== canonical(evidence) ||
		canonical(evidence) !== canonical(expected)
	)
		throw new Error("true-batch equivalence evidence mismatch");
}
