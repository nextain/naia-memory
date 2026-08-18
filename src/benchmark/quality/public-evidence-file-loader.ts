import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { hasValidEvidenceSignature } from "./public-evidence-crypto.js";
import {
	PublicEvidenceFileTooLargeError,
	readBoundedEvidenceFile,
} from "./public-evidence-file-io.js";
import type {
	PublicAdversarialReview,
	PublicDatasetCase,
	PublicDatasetProvenance,
	PublicEvidenceDataset,
	PublicEvidenceEngine,
	PublicEvidenceManifest,
	PublicEvidenceReceipt,
	PublicEvidenceTrustPolicy,
} from "./public-evidence-types.js";
import { isPublicEvidenceRecord } from "./public-evidence-types.js";
import { executionEvidenceFiles } from "./public-execution-attestation.js";
import { compareReceipt } from "./public-receipt-verifier.js";
import { PUBLIC_RETRIEVAL_SCORING_POLICY } from "./public-retrieval-scorer.js";

type EvidenceFile =
	| {
			kind:
				| "dataset"
				| "provenance"
				| "scorer"
				| "artifact"
				| "configuration"
				| "review";
			label: string;
			path: string;
			sha256: string;
	  }
	| { kind: "execution-evidence"; label: string; path: string; sha256: string }
	| {
			kind: "challenge" | "attestation";
			label: string;
			path: string;
			sha256: string;
			engine: { engine: string };
	  }
	| {
			kind: "receipt";
			label: string;
			path: string;
			sha256: string;
			engine: PublicEvidenceEngine;
	  };

export type LoadedPublicEvidence = {
	failures: string[];
	challenges: Map<string, unknown>;
	attestations: Map<string, unknown>;
};

const MAX_EVIDENCE_FILE_BYTES = 16 * 1024 * 1024;

function isDataset(value: unknown): value is PublicEvidenceDataset {
	return (
		isPublicEvidenceRecord(value) &&
		typeof value.schemaVersion === "string" &&
		Array.isArray(value.cases)
	);
}

function isReceipt(value: unknown): value is PublicEvidenceReceipt {
	return (
		isPublicEvidenceRecord(value) &&
		typeof value.schemaVersion === "string" &&
		Array.isArray(value.caseRecords)
	);
}

function isReview(value: unknown): value is PublicAdversarialReview {
	return (
		isPublicEvidenceRecord(value) &&
		typeof value.schemaVersion === "string" &&
		typeof value.reviewer === "string" &&
		typeof value.evidenceScopeSha256 === "string" &&
		typeof value.verdict === "string" &&
		typeof value.signatureBase64 === "string"
	);
}

function isDatasetProvenance(value: unknown): value is PublicDatasetProvenance {
	return (
		isPublicEvidenceRecord(value) &&
		value.schemaVersion === "naia-memory-public-dataset-provenance-v1" &&
		typeof value.datasetSha256 === "string" &&
		Array.isArray(value.authors) &&
		Array.isArray(value.nativeReviews)
	);
}

function compareDatasetProvenance(
	provenance: PublicDatasetProvenance,
	manifest: PublicEvidenceManifest["dataset"],
	trustPolicy: PublicEvidenceTrustPolicy,
): string[] {
	const failures: string[] = [];
	if (provenance.datasetSha256 !== manifest.sha256)
		failures.push("dataset provenance hash binding mismatch");
	const authorIds: string[] = [];
	for (const author of provenance.authors) {
		if (
			!isPublicEvidenceRecord(author) ||
			author.schemaVersion !==
				"naia-memory-public-dataset-author-attestation-v1" ||
			typeof author.author !== "string" ||
			typeof author.datasetSha256 !== "string" ||
			author.statement !== "AUTHORED_INDEPENDENTLY" ||
			typeof author.signatureBase64 !== "string"
		) {
			failures.push("dataset author attestation shape is invalid");
			continue;
		}
		authorIds.push(author.author);
		if (author.datasetSha256 !== manifest.sha256)
			failures.push(`${author.author}: author attestation dataset mismatch`);
		if (
			!hasValidEvidenceSignature(
				author,
				trustPolicy.datasetAuthorPublicKeys[author.author],
			)
		)
			failures.push(
				`${author.author}: author attestation is untrusted or invalid`,
			);
	}
	const nativeReviewerIdsByLanguage: Record<string, string[]> = {};
	for (const review of provenance.nativeReviews) {
		if (
			!isPublicEvidenceRecord(review) ||
			review.schemaVersion !== "naia-memory-public-dataset-native-review-v1" ||
			typeof review.reviewer !== "string" ||
			typeof review.language !== "string" ||
			typeof review.datasetSha256 !== "string" ||
			review.verdict !== "PASS" ||
			typeof review.signatureBase64 !== "string"
		) {
			failures.push("dataset native review attestation shape is invalid");
			continue;
		}
		const languageReviewers =
			nativeReviewerIdsByLanguage[review.language] ?? [];
		languageReviewers.push(review.reviewer);
		nativeReviewerIdsByLanguage[review.language] = languageReviewers;
		if (review.datasetSha256 !== manifest.sha256)
			failures.push(`${review.reviewer}: native review dataset mismatch`);
		if (
			!hasValidEvidenceSignature(
				review,
				trustPolicy.nativeReviewerPublicKeysByLanguage[review.language]?.[
					review.reviewer
				],
			)
		)
			failures.push(
				`${review.reviewer}: native review attestation is untrusted or invalid`,
			);
	}
	const normalized = (items: string[]) => [...items].sort();
	if (!isDeepStrictEqual(normalized(authorIds), normalized(manifest.authorIds)))
		failures.push("dataset author attestations do not match manifest");
	for (const language of Object.keys(manifest.reviewerIdsByLanguage)) {
		if (
			!isDeepStrictEqual(
				normalized(nativeReviewerIdsByLanguage[language] ?? []),
				normalized(manifest.reviewerIdsByLanguage[language]),
			)
		)
			failures.push(
				`${language} native review attestations do not match manifest`,
			);
	}
	for (const language of Object.keys(nativeReviewerIdsByLanguage))
		if (!(language in manifest.reviewerIdsByLanguage))
			failures.push(`${language} native review attestation is undeclared`);
	return failures;
}

function escapesRoot(root: string, target: string): boolean {
	const pathFromRoot = relative(root, target);
	return (
		pathFromRoot === ".." ||
		pathFromRoot.startsWith(`..${sep}`) ||
		isAbsolute(pathFromRoot)
	);
}

function compareDataset(
	dataset: PublicEvidenceDataset,
	manifest: PublicEvidenceManifest["dataset"],
): { failures: string[]; cases: Map<string, PublicDatasetCase> } {
	const failures: string[] = [];
	if (dataset.schemaVersion !== "naia-memory-public-dataset-v2")
		failures.push("dataset schema version mismatch");
	if (!Array.isArray(dataset.cases))
		return {
			failures: [...failures, "dataset cases are missing"],
			cases: new Map(),
		};
	const ids = new Set<string>();
	const cases = new Map<string, PublicDatasetCase>();
	const languageCounts = new Map<string, number>();
	for (const item of dataset.cases) {
		if (
			!item ||
			typeof item.id !== "string" ||
			!item.id.trim() ||
			typeof item.language !== "string" ||
			!item.language.trim() ||
			typeof item.input !== "string" ||
			!item.input.trim() ||
			!Array.isArray(item.expected) ||
			item.expected.length === 0 ||
			item.expected.some(
				(expected) => typeof expected !== "string" || !expected.trim(),
			) ||
			(item.forbidden !== undefined &&
				(!Array.isArray(item.forbidden) ||
					item.forbidden.some(
						(forbidden) => typeof forbidden !== "string" || !forbidden.trim(),
					)))
		) {
			failures.push("dataset case content is invalid");
			continue;
		}
		if (
			(item.forbidden ?? []).some((forbidden) =>
				item.expected.includes(forbidden),
			)
		)
			failures.push("dataset expected and forbidden IDs overlap");
		if (
			item.inputSha256 !== createHash("sha256").update(item.input).digest("hex")
		)
			failures.push("dataset case input hash mismatch");
		if (ids.has(item.id))
			failures.push("dataset case identities are duplicated");
		ids.add(item.id);
		cases.set(item.id, item);
		languageCounts.set(
			item.language,
			(languageCounts.get(item.language) ?? 0) + 1,
		);
	}
	if (dataset.cases.length !== manifest.caseCount)
		failures.push("dataset case count mismatch");
	if (
		!isDeepStrictEqual(
			Object.fromEntries(languageCounts),
			manifest.languageCaseCounts,
		)
	)
		failures.push("dataset language counts mismatch");
	return { failures, cases };
}

function compareReview(
	review: PublicAdversarialReview,
	manifest: PublicEvidenceManifest["adversarialReview"],
): string[] {
	const failures: string[] = [];
	if (review.schemaVersion !== "naia-memory-public-adversarial-review-v2")
		failures.push("adversarial review schema version mismatch");
	if (review.reviewer !== manifest.reviewer)
		failures.push("adversarial review reviewer mismatch");
	if (review.evidenceScopeSha256 !== manifest.evidenceScopeSha256)
		failures.push("adversarial review evidence scope mismatch");
	if (review.verdict !== manifest.verdict)
		failures.push("adversarial review verdict mismatch");
	return failures;
}

function evidenceFiles(manifest: PublicEvidenceManifest): EvidenceFile[] {
	return [
		{
			kind: "dataset",
			label: "dataset",
			path: manifest.dataset.path,
			sha256: manifest.dataset.sha256,
		},
		{
			kind: "provenance",
			label: "dataset provenance",
			path: manifest.dataset.provenancePath,
			sha256: manifest.dataset.provenanceSha256,
		},
		{
			kind: "scorer",
			label: "scorer artifact",
			path: manifest.protocol.scorerArtifactPath,
			sha256: manifest.protocol.scorerArtifactSha256,
		},
		...manifest.engines
			.filter((engine) => engine.executed)
			.flatMap((engine): EvidenceFile[] => [
				{
					kind: "artifact",
					label: `${engine.engine}: implementation artifact`,
					path: engine.implementationArtifactPath,
					sha256: engine.implementationArtifactSha256,
				},
				{
					kind: "configuration",
					label: `${engine.engine}: configuration`,
					path: engine.configurationPath,
					sha256: engine.configurationSha256,
				},
				...executionEvidenceFiles(engine),
			]),
		...manifest.engines
			.filter((engine) => engine.executed)
			.map(
				(engine): EvidenceFile => ({
					kind: "receipt",
					label: `${engine.engine}: receipt`,
					path: engine.receiptPath,
					sha256: engine.receiptSha256,
					engine,
				}),
			),
		{
			kind: "review",
			label: "adversarial review",
			path: manifest.adversarialReview.artifactPath,
			sha256: manifest.adversarialReview.artifactSha256,
		},
	];
}

export async function loadPublicEvidenceFiles(
	manifest: PublicEvidenceManifest,
	evidenceRoot: string,
	trustPolicy: PublicEvidenceTrustPolicy,
): Promise<LoadedPublicEvidence> {
	const failures: string[] = [];
	const challenges = new Map<string, unknown>();
	const attestations = new Map<string, unknown>();
	const loadedJson: { item: EvidenceFile; parsed: unknown }[] = [];
	let root: string;
	try {
		root = await realpath(resolve(evidenceRoot));
	} catch {
		return {
			failures: ["evidence root is unreadable"],
			challenges,
			attestations,
		};
	}

	for (const item of evidenceFiles(manifest)) {
		const absolute = resolve(root, item.path);
		if (isAbsolute(item.path) || escapesRoot(root, absolute)) {
			failures.push(`${item.label} path escapes evidence root`);
			continue;
		}
		let canonical: string;
		try {
			canonical = await realpath(absolute);
		} catch {
			failures.push(`${item.label} file is unreadable`);
			continue;
		}
		if (escapesRoot(root, canonical)) {
			failures.push(`${item.label} path escapes evidence root`);
			continue;
		}
		let bytes: Buffer;
		try {
			bytes = await readBoundedEvidenceFile(canonical, MAX_EVIDENCE_FILE_BYTES);
		} catch (error) {
			if (error instanceof PublicEvidenceFileTooLargeError) {
				failures.push(`${item.label} exceeds the 16 MiB evidence-file limit`);
				continue;
			}
			failures.push(`${item.label} file is unreadable`);
			continue;
		}
		if (createHash("sha256").update(bytes).digest("hex") !== item.sha256)
			failures.push(`${item.label} content hash mismatch`);
		if (
			item.kind === "artifact" ||
			item.kind === "configuration" ||
			item.kind === "execution-evidence"
		)
			continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(bytes.toString("utf8"));
		} catch {
			failures.push(`${item.label} JSON is invalid`);
			continue;
		}
		loadedJson.push({ item, parsed });
	}

	let datasetCases: Map<string, PublicDatasetCase> | undefined;
	const datasetFile = loadedJson.find(({ item }) => item.kind === "dataset");
	if (datasetFile) {
		if (!isDataset(datasetFile.parsed))
			failures.push("dataset content shape is invalid");
		else {
			const compared = compareDataset(datasetFile.parsed, manifest.dataset);
			failures.push(...compared.failures);
			datasetCases = compared.cases;
		}
	}

	for (const { item, parsed } of loadedJson) {
		if (item.kind === "dataset") continue;
		if (item.kind === "provenance") {
			if (!isDatasetProvenance(parsed))
				failures.push("dataset provenance content shape is invalid");
			else
				failures.push(
					...compareDatasetProvenance(parsed, manifest.dataset, trustPolicy),
				);
			continue;
		}
		if (item.kind === "scorer") {
			if (!isDeepStrictEqual(parsed, PUBLIC_RETRIEVAL_SCORING_POLICY))
				failures.push("scorer artifact semantics mismatch");
		} else if (item.kind === "challenge")
			challenges.set(item.engine.engine, parsed);
		else if (item.kind === "attestation")
			attestations.set(item.engine.engine, parsed);
		else if (item.kind === "receipt") {
			if (!isReceipt(parsed)) {
				failures.push(`${item.label} content shape is invalid`);
				continue;
			}
			const receipt = parsed;
			if (datasetCases)
				failures.push(
					...compareReceipt(
						receipt,
						item.engine,
						manifest.protocol,
						datasetCases,
					),
				);
			else if (receipt.engine !== item.engine.engine)
				failures.push(
					`${item.engine.engine}: receipt engine identity mismatch`,
				);
			if (
				!hasValidEvidenceSignature(
					receipt,
					trustPolicy.enginePublicKeys[item.engine.engine],
				)
			)
				failures.push(
					`${item.engine.engine}: receipt signature is untrusted or invalid`,
				);
		} else {
			if (!isReview(parsed)) {
				failures.push("adversarial review content shape is invalid");
				continue;
			}
			const review = parsed;
			failures.push(...compareReview(review, manifest.adversarialReview));
			if (
				!hasValidEvidenceSignature(
					review,
					trustPolicy.reviewerPublicKeys[review.reviewer],
				)
			)
				failures.push("adversarial review signature is untrusted or invalid");
		}
	}
	return { failures, challenges, attestations };
}
