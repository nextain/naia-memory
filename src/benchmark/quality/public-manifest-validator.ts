import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import type {
	PublicEvidenceDecision,
	PublicEvidenceManifest,
} from "./public-evidence-types.js";
import {
	PUBLIC_EVIDENCE_SHA256 as SHA256,
	isPublicEvidenceRecord,
} from "./public-evidence-types.js";
import { validateExecutionEvidenceReference } from "./public-execution-attestation.js";
import {
	PUBLIC_RETRIEVAL_SCORING_POLICY_ID,
	publicRetrievalMetricName,
} from "./public-retrieval-scorer.js";

export const PUBLIC_EVIDENCE_CLAIM =
	"Artifacts are tamper-evident under the frozen public evidence protocol.";

export function publicEvidenceScopeSha256(
	manifest: PublicEvidenceManifest,
): string {
	const engines = manifest.engines
		.map((engine) => ({ ...engine }))
		.sort((left, right) =>
			left.engine < right.engine ? -1 : left.engine > right.engine ? 1 : 0,
		);
	return evidenceObjectSha256({
		claim: manifest.claim,
		dataset: manifest.dataset,
		protocol: manifest.protocol,
		engines,
	});
}

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}

function isNumberRecord(value: unknown): value is Record<string, number> {
	return (
		isPublicEvidenceRecord(value) &&
		Object.values(value).every((item) => typeof item === "number")
	);
}

function isStringArrayRecord(
	value: unknown,
): value is Record<string, string[]> {
	return (
		isPublicEvidenceRecord(value) && Object.values(value).every(isStringArray)
	);
}

/** Narrows untrusted JSON before semantic validation touches nested fields. */
export function isPublicEvidenceManifest(
	value: unknown,
): value is PublicEvidenceManifest {
	if (!isPublicEvidenceRecord(value)) return false;
	const dataset = value.dataset;
	const protocol = value.protocol;
	const review = value.adversarialReview;
	if (
		!isPublicEvidenceRecord(dataset) ||
		!isPublicEvidenceRecord(protocol) ||
		!isPublicEvidenceRecord(review) ||
		!Array.isArray(value.engines)
	)
		return false;
	const strings = (record: Record<string, unknown>, fields: string[]) =>
		fields.every((field) => typeof record[field] === "string");
	if (
		!strings(value, [
			"schemaVersion",
			"publisher",
			"signatureBase64",
			"claim",
		]) ||
		!strings(dataset, [
			"path",
			"benchmarkTier",
			"construction",
			"nativeReviewStatus",
			"sha256",
			"provenancePath",
			"provenanceSha256",
		]) ||
		typeof dataset.sealedBeforeRun !== "boolean" ||
		typeof dataset.caseCount !== "number" ||
		!isNumberRecord(dataset.languageCaseCounts) ||
		!isStringArray(dataset.authorIds) ||
		!isStringArrayRecord(dataset.reviewerIdsByLanguage) ||
		!strings(protocol, [
			"sameInputSha256",
			"answerModel",
			"judgeModel",
			"primaryMetricName",
			"scoringPolicyId",
			"scorerArtifactPath",
			"scorerArtifactSha256",
		]) ||
		typeof protocol.topK !== "number" ||
		typeof protocol.repetitions !== "number" ||
		typeof protocol.frozenBeforeRun !== "boolean" ||
		typeof review.independent !== "boolean" ||
		!strings(review, [
			"reviewer",
			"evidenceScopeSha256",
			"artifactPath",
			"artifactSha256",
			"verdict",
		])
	)
		return false;
	return value.engines.every((engine) => {
		if (!isPublicEvidenceRecord(engine)) return false;
		const metric = engine.primaryMetric;
		return (
			strings(engine, [
				"engine",
				"implementationFamily",
				"receiptPath",
				"receiptSha256",
				"challengePath",
				"challengeSha256",
				"attestationPath",
				"attestationSha256",
				"executionEvidencePath",
				"executionEvidenceSha256",
				"datasetSha256",
				"implementationRevision",
				"implementationArtifactPath",
				"implementationArtifactSha256",
				"configurationPath",
				"configurationSha256",
			]) &&
			(engine.kind === "naia" || engine.kind === "external") &&
			typeof engine.executed === "boolean" &&
			isStringArray(engine.providerModels) &&
			["elapsedMs", "estimatedCostUsd", "failureCount"].every(
				(field) => typeof engine[field] === "number",
			) &&
			isPublicEvidenceRecord(metric) &&
			strings(metric, ["name"]) &&
			["value", "ci95Low", "ci95High"].every(
				(field) => typeof metric[field] === "number",
			)
		);
	});
}

function evaluateManifest(
	manifest: PublicEvidenceManifest,
): PublicEvidenceDecision {
	const failures: string[] = [];
	const reject = (condition: boolean, message: string) => {
		if (condition) failures.push(message);
	};
	const dataset = manifest.dataset;
	const protocol = manifest.protocol;

	reject(
		manifest.schemaVersion !== "naia-memory-public-evidence-v5",
		"manifest schema version is unsupported",
	);
	reject(!manifest.publisher.trim(), "publisher identity is missing");
	reject(!manifest.claim.trim(), "claim is missing");
	reject(
		manifest.claim !== PUBLIC_EVIDENCE_CLAIM,
		"claim exceeds the evidence supported by this gate",
	);
	reject(
		dataset.benchmarkTier !== "held-out-public",
		"dataset is not held-out-public",
	);
	reject(
		dataset.construction !== "independent-authored",
		"dataset is not independently authored",
	);
	reject(
		dataset.nativeReviewStatus !== "reviewed",
		"dataset lacks completed native review",
	);
	reject(!dataset.sealedBeforeRun, "dataset was not sealed before execution");
	reject(!dataset.path.trim(), "dataset path is missing");
	reject(!SHA256.test(dataset.sha256), "dataset SHA-256 is invalid");
	reject(!dataset.provenancePath.trim(), "dataset provenance path is missing");
	reject(
		!SHA256.test(dataset.provenanceSha256),
		"dataset provenance SHA-256 is invalid",
	);
	reject(dataset.caseCount < 100, "dataset has fewer than 100 cases");
	reject(
		Object.values(dataset.languageCaseCounts).reduce(
			(sum, count) => sum + count,
			0,
		) !== dataset.caseCount,
		"language counts do not equal dataset case count",
	);
	for (const language of ["ko", "en", "ja"]) {
		reject(
			(dataset.languageCaseCounts[language] ?? 0) < 30,
			`dataset has fewer than 30 ${language} cases`,
		);
		reject(
			(dataset.reviewerIdsByLanguage[language]?.length ?? 0) === 0,
			`${language} native reviewer identity is missing`,
		);
	}
	const authors = new Set(
		dataset.authorIds.map((id) => id.trim()).filter(Boolean),
	);
	const reviewers = new Set(
		Object.values(dataset.reviewerIdsByLanguage)
			.flat()
			.map((id) => id.trim())
			.filter(Boolean),
	);
	reject(authors.size === 0, "independent author identity is missing");
	reject(
		[...authors].some((id) => reviewers.has(id)),
		"authors and native reviewers are not independent",
	);

	reject(
		protocol.sameInputSha256 !== dataset.sha256,
		"protocol input hash differs from the sealed dataset",
	);
	const validTopK = Number.isInteger(protocol.topK) && protocol.topK >= 1;
	reject(!validTopK, "topK is invalid");
	reject(protocol.repetitions < 2, "fewer than two benchmark repetitions");
	reject(!protocol.answerModel.trim(), "answer model identity is missing");
	reject(!protocol.judgeModel.trim(), "judge model identity is missing");
	reject(
		!protocol.primaryMetricName.trim(),
		"frozen primary metric is missing",
	);
	reject(
		!protocol.scoringPolicyId.trim(),
		"scoring policy identity is missing",
	);
	reject(
		protocol.scoringPolicyId !== PUBLIC_RETRIEVAL_SCORING_POLICY_ID,
		"scoring policy is not replayable by this verifier",
	);
	if (validTopK)
		reject(
			protocol.primaryMetricName !== publicRetrievalMetricName(protocol.topK),
			"primary metric name does not match topK",
		);
	reject(
		!protocol.scorerArtifactPath.trim(),
		"scorer artifact path is missing",
	);
	reject(
		!SHA256.test(protocol.scorerArtifactSha256),
		"scorer artifact SHA-256 is invalid",
	);
	reject(!protocol.frozenBeforeRun, "protocol was not frozen before execution");

	const executed = manifest.engines.filter((engine) => engine.executed);
	for (const engine of manifest.engines.filter((item) => !item.executed)) {
		const metric = engine.primaryMetric;
		reject(
			engine.elapsedMs !== 0 ||
				engine.estimatedCostUsd !== 0 ||
				engine.failureCount !== 0 ||
				metric.value !== 0 ||
				metric.ci95Low !== 0 ||
				metric.ci95High !== 0,
			`${engine.engine}: unexecuted engine carries result claims`,
		);
	}
	const executedNames = executed
		.map((engine) => engine.engine.trim())
		.filter(Boolean);
	const implementationFamilies = executed
		.map((engine) => engine.implementationFamily.trim())
		.filter(Boolean);
	const implementationArtifacts = executed
		.map((engine) => engine.implementationArtifactSha256)
		.filter((value) => SHA256.test(value));
	const receiptHashes = executed
		.map((engine) => engine.receiptSha256)
		.filter((value) => SHA256.test(value));
	const challengeHashes = executed
		.map((engine) => engine.challengeSha256)
		.filter((value) => SHA256.test(value));
	const attestationHashes = executed
		.map((engine) => engine.attestationSha256)
		.filter((value) => SHA256.test(value));
	const executionEvidenceHashes = executed
		.map((engine) => engine.executionEvidenceSha256)
		.filter((value) => SHA256.test(value));
	const configurationHashes = executed
		.map((engine) => engine.configurationSha256)
		.filter((value) => SHA256.test(value));
	reject(
		new Set(executedNames).size !== executed.length,
		"executed engine identities are missing or duplicated",
	);
	reject(
		new Set(implementationFamilies).size !== executed.length,
		"implementation families are missing or duplicated",
	);
	reject(
		new Set(implementationArtifacts).size !== executed.length,
		"implementation artifacts are missing or duplicated",
	);
	reject(
		new Set(receiptHashes).size !== executed.length,
		"executed engine receipts are missing or duplicated",
	);
	reject(
		new Set(challengeHashes).size !== executed.length,
		"execution challenges are missing or duplicated",
	);
	reject(
		new Set(attestationHashes).size !== executed.length,
		"execution attestations are missing or duplicated",
	);
	reject(
		new Set(executionEvidenceHashes).size !== executed.length,
		"execution evidence artifacts are missing or duplicated",
	);
	reject(
		new Set(configurationHashes).size !== executed.length,
		"engine configurations are missing or duplicated",
	);
	reject(
		!executed.some((engine) => engine.kind === "naia"),
		"executed Naia arm is missing",
	);
	reject(
		executed.filter((engine) => engine.kind === "external").length < 2,
		"fewer than two executed external engines",
	);
	for (const engine of executed) {
		const prefix = `${engine.engine}:`;
		reject(!engine.receiptPath.trim(), `${prefix} receipt path is missing`);
		failures.push(...validateExecutionEvidenceReference(prefix, engine));
		reject(
			!SHA256.test(engine.receiptSha256),
			`${prefix} receipt SHA-256 is invalid`,
		);
		reject(
			engine.datasetSha256 !== dataset.sha256,
			`${prefix} input hash differs from the sealed dataset`,
		);
		reject(
			!engine.implementationRevision.trim(),
			`${prefix} implementation revision is missing`,
		);
		reject(
			!engine.implementationArtifactPath.trim(),
			`${prefix} implementation artifact path is missing`,
		);
		reject(
			!SHA256.test(engine.implementationArtifactSha256),
			`${prefix} implementation artifact SHA-256 is invalid`,
		);
		reject(
			!engine.configurationPath.trim(),
			`${prefix} configuration path is missing`,
		);
		reject(
			!SHA256.test(engine.configurationSha256),
			`${prefix} configuration SHA-256 is invalid`,
		);
		reject(
			engine.providerModels.length === 0 ||
				engine.providerModels.some((model) => !model.trim()),
			`${prefix} provider/model identity is missing`,
		);
		reject(
			!Number.isFinite(engine.elapsedMs) || engine.elapsedMs <= 0,
			`${prefix} elapsed time is missing`,
		);
		reject(
			!Number.isFinite(engine.estimatedCostUsd) || engine.estimatedCostUsd < 0,
			`${prefix} cost is missing`,
		);
		reject(
			!Number.isInteger(engine.failureCount) || engine.failureCount < 0,
			`${prefix} failure count is missing`,
		);
		const metric = engine.primaryMetric;
		reject(!metric.name.trim(), `${prefix} primary metric name is missing`);
		reject(
			metric.name !== protocol.primaryMetricName,
			`${prefix} primary metric differs from the frozen protocol`,
		);
		reject(
			![metric.value, metric.ci95Low, metric.ci95High].every(Number.isFinite),
			`${prefix} primary metric or confidence interval is missing`,
		);
		reject(
			[metric.value, metric.ci95Low, metric.ci95High].some(
				(value) => value < 0 || value > 1,
			),
			`${prefix} primary metric or confidence interval is outside [0,1]`,
		);
		reject(
			metric.ci95Low > metric.value || metric.value > metric.ci95High,
			`${prefix} confidence interval does not contain the score`,
		);
	}

	const review = manifest.adversarialReview;
	reject(!review.independent, "adversarial review is not independent");
	const adversarialReviewer = review.reviewer.trim();
	reject(
		authors.has(adversarialReviewer) || reviewers.has(adversarialReviewer),
		"adversarial reviewer overlaps dataset authors or reviewers",
	);
	reject(
		review.evidenceScopeSha256 !== publicEvidenceScopeSha256(manifest),
		"adversarial review is not bound to the complete evidence scope",
	);
	reject(
		!review.reviewer.trim() ||
			!review.artifactPath.trim() ||
			!SHA256.test(review.artifactSha256),
		"adversarial review provenance is missing",
	);
	reject(review.verdict !== "PASS", "adversarial review did not pass");

	return { promotable: failures.length === 0, failures };
}

/** Performs shape-only validation. This is not a promotion decision; use evaluatePublicEvidenceFiles for that. */
export function validatePublicEvidenceManifest(
	manifest: unknown,
): PublicEvidenceDecision {
	if (!isPublicEvidenceManifest(manifest))
		return { promotable: false, failures: ["manifest shape is invalid"] };
	return evaluateManifest(manifest);
}
