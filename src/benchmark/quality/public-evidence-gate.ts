import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type PublicEvidenceEngine = {
	engine: string;
	kind: "naia" | "external";
	implementationFamily: string;
	executed: boolean;
	receiptPath: string;
	receiptSha256: string;
	datasetSha256: string;
	implementationRevision: string;
	providerModels: string[];
	elapsedMs: number;
	estimatedCostUsd: number;
	failureCount: number;
	primaryMetric: { name: string; value: number; ci95Low: number; ci95High: number };
};

export type PublicEvidenceManifest = {
	schemaVersion: "naia-memory-public-evidence-v1";
	claim: string;
	dataset: {
		benchmarkTier: string;
		construction: string;
		nativeReviewStatus: string;
		sealedBeforeRun: boolean;
		sha256: string;
		caseCount: number;
		languageCaseCounts: Record<string, number>;
		authorIds: string[];
		reviewerIdsByLanguage: Record<string, string[]>;
	};
	protocol: {
		sameInputSha256: string;
		topK: number;
		repetitions: number;
		answerModel: string;
		judgeModel: string;
		primaryMetricName: string;
		frozenBeforeRun: boolean;
	};
	engines: PublicEvidenceEngine[];
	adversarialReview: { independent: boolean; reviewer: string; evidenceScopeSha256: string; artifactPath: string; artifactSha256: string; verdict: string };
};

export type PublicEvidenceDecision = { promotable: boolean; failures: string[] };

const SHA256 = /^[a-f0-9]{64}$/;

function evaluateManifest(manifest: PublicEvidenceManifest): PublicEvidenceDecision {
	const failures: string[] = [];
	const reject = (condition: boolean, message: string) => { if (condition) failures.push(message); };
	const dataset = manifest.dataset;
	const protocol = manifest.protocol;

	reject(manifest.schemaVersion !== "naia-memory-public-evidence-v1", "manifest schema version is unsupported");
	reject(!manifest.claim.trim(), "claim is missing");
	reject(dataset.benchmarkTier !== "held-out-public", "dataset is not held-out-public");
	reject(dataset.construction !== "independent-authored", "dataset is not independently authored");
	reject(dataset.nativeReviewStatus !== "reviewed", "dataset lacks completed native review");
	reject(!dataset.sealedBeforeRun, "dataset was not sealed before execution");
	reject(!SHA256.test(dataset.sha256), "dataset SHA-256 is invalid");
	reject(dataset.caseCount < 100, "dataset has fewer than 100 cases");
	reject(Object.values(dataset.languageCaseCounts).reduce((sum, count) => sum + count, 0) !== dataset.caseCount, "language counts do not equal dataset case count");
	for (const language of ["ko", "en", "ja"]) {
		reject((dataset.languageCaseCounts[language] ?? 0) < 30, `dataset has fewer than 30 ${language} cases`);
		reject((dataset.reviewerIdsByLanguage[language]?.length ?? 0) === 0, `${language} native reviewer identity is missing`);
	}
	const authors = new Set(dataset.authorIds.map((id) => id.trim()).filter(Boolean));
	const reviewers = new Set(Object.values(dataset.reviewerIdsByLanguage).flat().map((id) => id.trim()).filter(Boolean));
	reject(authors.size === 0, "independent author identity is missing");
	reject([...authors].some((id) => reviewers.has(id)), "authors and native reviewers are not independent");

	reject(protocol.sameInputSha256 !== dataset.sha256, "protocol input hash differs from the sealed dataset");
	reject(protocol.topK < 1, "topK is invalid");
	reject(protocol.repetitions < 2, "fewer than two benchmark repetitions");
	reject(!protocol.answerModel.trim(), "answer model identity is missing");
	reject(!protocol.judgeModel.trim(), "judge model identity is missing");
	reject(!protocol.primaryMetricName.trim(), "frozen primary metric is missing");
	reject(!protocol.frozenBeforeRun, "protocol was not frozen before execution");

	const executed = manifest.engines.filter((engine) => engine.executed);
	const executedNames = executed.map((engine) => engine.engine.trim()).filter(Boolean);
	const implementationFamilies = executed.map((engine) => engine.implementationFamily.trim()).filter(Boolean);
	const receiptHashes = executed.map((engine) => engine.receiptSha256).filter((value) => SHA256.test(value));
	reject(new Set(executedNames).size !== executed.length, "executed engine identities are missing or duplicated");
	reject(new Set(implementationFamilies).size !== executed.length, "implementation families are missing or duplicated");
	reject(new Set(receiptHashes).size !== receiptHashes.length, "executed engine receipts are duplicated");
	reject(!executed.some((engine) => engine.kind === "naia"), "executed Naia arm is missing");
	reject(executed.filter((engine) => engine.kind === "external").length < 2, "fewer than two executed external engines");
	for (const engine of executed) {
		const prefix = `${engine.engine}:`;
		reject(!engine.receiptPath.trim(), `${prefix} receipt path is missing`);
		reject(!SHA256.test(engine.receiptSha256), `${prefix} receipt SHA-256 is invalid`);
		reject(engine.datasetSha256 !== dataset.sha256, `${prefix} input hash differs from the sealed dataset`);
		reject(!engine.implementationRevision.trim(), `${prefix} implementation revision is missing`);
		reject(engine.providerModels.length === 0 || engine.providerModels.some((model) => !model.trim()), `${prefix} provider/model identity is missing`);
		reject(!Number.isFinite(engine.elapsedMs) || engine.elapsedMs <= 0, `${prefix} elapsed time is missing`);
		reject(!Number.isFinite(engine.estimatedCostUsd) || engine.estimatedCostUsd < 0, `${prefix} cost is missing`);
		reject(!Number.isInteger(engine.failureCount) || engine.failureCount < 0, `${prefix} failure count is missing`);
		const metric = engine.primaryMetric;
		reject(!metric.name.trim(), `${prefix} primary metric name is missing`);
		reject(metric.name !== protocol.primaryMetricName, `${prefix} primary metric differs from the frozen protocol`);
		reject(![metric.value, metric.ci95Low, metric.ci95High].every(Number.isFinite), `${prefix} primary metric or confidence interval is missing`);
		reject([metric.value, metric.ci95Low, metric.ci95High].some((value) => value < 0 || value > 1), `${prefix} primary metric or confidence interval is outside [0,1]`);
		reject(metric.ci95Low > metric.value || metric.value > metric.ci95High, `${prefix} confidence interval does not contain the score`);
	}

	const review = manifest.adversarialReview;
	reject(!review.independent, "adversarial review is not independent");
	const adversarialReviewer = review.reviewer.trim();
	reject(authors.has(adversarialReviewer) || reviewers.has(adversarialReviewer), "adversarial reviewer overlaps dataset authors or reviewers");
	reject(review.evidenceScopeSha256 !== dataset.sha256, "adversarial review is not bound to the sealed evidence scope");
	reject(!review.reviewer.trim() || !review.artifactPath.trim() || !SHA256.test(review.artifactSha256), "adversarial review provenance is missing");
	reject(review.verdict !== "PASS", "adversarial review did not pass");

	return { promotable: failures.length === 0, failures };
}

export function evaluatePublicEvidence(manifest: PublicEvidenceManifest): PublicEvidenceDecision {
	try {
		return evaluateManifest(manifest);
	} catch {
		return { promotable: false, failures: ["manifest shape is invalid"] };
	}
}

function escapesRoot(root: string, target: string): boolean {
	const pathFromRoot = relative(root, target);
	return pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot);
}

export async function evaluatePublicEvidenceFiles(manifest: PublicEvidenceManifest, evidenceRoot: string): Promise<PublicEvidenceDecision> {
	const decision = evaluatePublicEvidence(manifest);
	if (decision.failures.includes("manifest shape is invalid")) return decision;
	let root: string;
	try {
		root = await realpath(resolve(evidenceRoot));
	} catch {
		return { promotable: false, failures: [...decision.failures, "evidence root is unreadable"] };
	}
	const evidence = [
		...manifest.engines.filter((engine) => engine.executed).map((engine) => ({ label: `${engine.engine}: receipt`, path: engine.receiptPath, sha256: engine.receiptSha256 })),
		{ label: "adversarial review", path: manifest.adversarialReview.artifactPath, sha256: manifest.adversarialReview.artifactSha256 },
	];
	for (const item of evidence) {
		const absolute = resolve(root, item.path);
		const lexicalEscape = isAbsolute(item.path) || escapesRoot(root, absolute);
		if (lexicalEscape) {
			decision.failures.push(`${item.label} path escapes evidence root`);
			continue;
		}
		let canonical: string;
		try {
			canonical = await realpath(absolute);
		} catch {
			decision.failures.push(`${item.label} file is unreadable`);
			continue;
		}
		const outsideRoot = escapesRoot(root, canonical);
		if (outsideRoot) {
			decision.failures.push(`${item.label} path escapes evidence root`);
			continue;
		}
		try {
			const actual = createHash("sha256").update(await readFile(canonical)).digest("hex");
			if (actual !== item.sha256) decision.failures.push(`${item.label} content hash mismatch`);
		} catch {
			decision.failures.push(`${item.label} file is unreadable`);
		}
	}
	decision.promotable = decision.failures.length === 0;
	return decision;
}
