import { createPublicKey } from "node:crypto";
import type {
	BenchmarkDevelopmentExecutionPlan,
	BenchmarkDevelopmentExecutionReceipt,
	BenchmarkDevelopmentExecutionTrustPolicy,
} from "./benchmark-development-execution-evidence.js";
import {
	evidenceObjectSha256,
	hasValidEvidenceSignature,
} from "./public-evidence-crypto.js";
import {
	type Rfc3161CommandRunner,
	type Rfc3161DigestTimestampEvidence,
	type Rfc3161TimestampTrustPolicy,
	validateRfc3161DigestTimestampBinding,
} from "./rfc3161-timestamp.js";

const SHA256 = /^[a-f0-9]{64}$/u;

export type BenchmarkDevelopmentExecutionRegistryEntry = {
	schemaVersion: "naia-memory-benchmark-development-execution-registry-entry-v1";
	registrar: string;
	ordinal: number;
	previousEntrySha256: string | null;
	planSha256: string;
	event: "started" | "finished";
	candidateId: string;
	policySha256: string;
	datasetSha256: string;
	executor: string;
	receiptSha256: string | null;
	declaredAt: string;
	signedAt: string;
	statement: "DEVELOPMENT_EXECUTION_REGISTRY_EVENT";
	signatureBase64: string;
};

export type TimestampedBenchmarkDevelopmentExecutionRegistryEntry = {
	entry: BenchmarkDevelopmentExecutionRegistryEntry;
	timestampEvidence: Rfc3161DigestTimestampEvidence;
};

export type BenchmarkDevelopmentExecutionRegistryEvidence = {
	schemaVersion: "naia-memory-benchmark-development-execution-registry-evidence-v1";
	records: TimestampedBenchmarkDevelopmentExecutionRegistryEntry[];
};

export type BenchmarkDevelopmentExecutionRegistryTrustPolicy = {
	registrarPublicKeys: Record<string, string>;
};

export function isBenchmarkDevelopmentExecutionRegistryEvidence(
	value: unknown,
): value is BenchmarkDevelopmentExecutionRegistryEvidence {
	return Boolean(
		value &&
			typeof value === "object" &&
			(value as { schemaVersion?: unknown }).schemaVersion ===
				"naia-memory-benchmark-development-execution-registry-evidence-v1" &&
			Array.isArray((value as { records?: unknown }).records),
	);
}

export function isBenchmarkDevelopmentExecutionRegistryTrustPolicy(
	value: unknown,
): value is BenchmarkDevelopmentExecutionRegistryTrustPolicy {
	return Boolean(
		value &&
			typeof value === "object" &&
			(value as { registrarPublicKeys?: unknown }).registrarPublicKeys &&
			typeof (value as { registrarPublicKeys?: unknown })
				.registrarPublicKeys === "object",
	);
}

function validId(value: unknown): value is string {
	return (
		typeof value === "string" && value.trim() === value && value.length > 0
	);
}

function validHash(value: unknown): value is string {
	return typeof value === "string" && SHA256.test(value);
}

function validTime(value: string): number {
	const parsed = Date.parse(value);
	if (!Number.isFinite(parsed))
		throw new Error("development execution registry timestamp is invalid");
	return parsed;
}

function normalizedKey(value: string): string {
	return createPublicKey(value)
		.export({ type: "spki", format: "der" })
		.toString("base64");
}

export function validateBenchmarkDevelopmentExecutionRegistry(input: {
	evidence: BenchmarkDevelopmentExecutionRegistryEvidence;
	trustPolicy: BenchmarkDevelopmentExecutionRegistryTrustPolicy;
	developmentTrustPolicy: BenchmarkDevelopmentExecutionTrustPolicy;
	timestampTrustPolicy: Rfc3161TimestampTrustPolicy;
	plan: BenchmarkDevelopmentExecutionPlan;
	receipts: BenchmarkDevelopmentExecutionReceipt[];
	trustedPlanTimestampedAt: string;
	forbiddenTrustIdentities?: Iterable<string>;
	forbiddenTrustPublicKeys?: Iterable<string>;
	commandRunner?: Rfc3161CommandRunner;
}): {
	registeredDevelopmentExecutionChronologyExternallyVerified: true;
	offRegistryDevelopmentExecutionAbsenceExternallyVerified: false;
	registeredExecutionCount: number;
	registryHeadSha256: string;
} {
	const records = input.evidence.records;
	if (
		input.evidence.schemaVersion !==
			"naia-memory-benchmark-development-execution-registry-evidence-v1" ||
		!Array.isArray(records) ||
		records.length !== input.receipts.length * 2
	)
		throw new Error("development execution registry coverage is incomplete");

	const forbiddenIdentities = new Set([
		...(input.forbiddenTrustIdentities ?? []),
		...Object.keys(input.developmentTrustPolicy.administratorPublicKeys),
		...Object.keys(input.developmentTrustPolicy.executorPublicKeys),
	]);
	const forbiddenKeys = new Set(
		[
			...(input.forbiddenTrustPublicKeys ?? []),
			...Object.values(input.developmentTrustPolicy.administratorPublicKeys),
			...Object.values(input.developmentTrustPolicy.executorPublicKeys),
		].map(normalizedKey),
	);
	const registrarKeys = Object.entries(input.trustPolicy.registrarPublicKeys);
	if (registrarKeys.length === 0)
		throw new Error("development execution registry trust policy is empty");
	const normalizedRegistrarKeys = registrarKeys.map(([identity, key]) => {
		if (!validId(identity))
			throw new Error("development execution registrar identity is invalid");
		let normalized: string;
		try {
			if (createPublicKey(key).asymmetricKeyType !== "ed25519")
				throw new Error();
			normalized = normalizedKey(key);
		} catch {
			throw new Error("development execution registrar key is invalid");
		}
		if (forbiddenIdentities.has(identity) || forbiddenKeys.has(normalized))
			throw new Error(
				"development execution registrar independence is invalid",
			);
		return normalized;
	});
	if (new Set(normalizedRegistrarKeys).size !== normalizedRegistrarKeys.length)
		throw new Error("development execution registrar keys must be unique");

	const planSha256 = evidenceObjectSha256(input.plan);
	const receiptsByPair = new Map(
		input.receipts.map((receipt) => [
			`${receipt.candidateId}\0${receipt.datasetSha256}`,
			receipt,
		]),
	);
	if (receiptsByPair.size !== input.receipts.length)
		throw new Error("development execution registry receipt pairs are invalid");
	for (const receipt of input.receipts) {
		const executorKey =
			input.developmentTrustPolicy.executorPublicKeys[receipt.executor];
		if (
			receipt.planSha256 !== planSha256 ||
			!executorKey ||
			!hasValidEvidenceSignature(receipt, executorKey)
		)
			throw new Error(
				"development execution registry receipt authentication is invalid",
			);
	}

	const trustedPlanTimestamp = validTime(input.trustedPlanTimestampedAt);
	const started = new Set<string>();
	const finished = new Set<string>();
	let previousHash: string | null = null;
	let previousTrustedTimestamp = trustedPlanTimestamp;
	for (const [index, record] of records.entries()) {
		if (!record || typeof record !== "object" || !record.entry)
			throw new Error("development execution registry record is invalid");
		const entry = record.entry;
		const pair = `${entry.candidateId}\0${entry.datasetSha256}`;
		const receipt = receiptsByPair.get(pair);
		const registrarKey = input.trustPolicy.registrarPublicKeys[entry.registrar];
		if (
			entry.schemaVersion !==
				"naia-memory-benchmark-development-execution-registry-entry-v1" ||
			entry.ordinal !== index + 1 ||
			entry.previousEntrySha256 !== previousHash ||
			entry.planSha256 !== planSha256 ||
			!validId(entry.registrar) ||
			!validHash(entry.planSha256) ||
			(entry.event !== "started" && entry.event !== "finished") ||
			!receipt ||
			entry.policySha256 !== receipt.policySha256 ||
			entry.executor !== receipt.executor ||
			entry.statement !== "DEVELOPMENT_EXECUTION_REGISTRY_EVENT" ||
			!registrarKey ||
			!hasValidEvidenceSignature(entry, registrarKey)
		)
			throw new Error("development execution registry entry is invalid");
		const declaredAt = validTime(entry.declaredAt);
		const signedAt = validTime(entry.signedAt);
		if (signedAt < declaredAt)
			throw new Error("development execution registry chronology is invalid");

		const receiptSha256 = evidenceObjectSha256(receipt);
		if (entry.event === "started") {
			if (
				entry.receiptSha256 !== null ||
				started.has(pair) ||
				finished.has(pair)
			)
				throw new Error(
					"development execution registry start event is invalid",
				);
			started.add(pair);
		} else {
			if (
				entry.receiptSha256 !== receiptSha256 ||
				!started.has(pair) ||
				finished.has(pair)
			)
				throw new Error(
					"development execution registry finish event is invalid",
				);
			finished.add(pair);
		}

		const entrySha256 = evidenceObjectSha256(entry);
		const timestamp = validateRfc3161DigestTimestampBinding({
			expectedArtifactSha256: entrySha256,
			evidence: record.timestampEvidence,
			trustPolicy: input.timestampTrustPolicy,
			commandRunner: input.commandRunner,
		});
		const trustedTimestamp = validTime(timestamp.timestampedAt);
		if (
			trustedTimestamp < previousTrustedTimestamp ||
			signedAt > trustedTimestamp
		)
			throw new Error(
				"development execution registry trusted chronology is invalid",
			);
		if (
			entry.event === "started" &&
			(trustedTimestamp > validTime(receipt.startedAt) ||
				signedAt > validTime(receipt.startedAt))
		)
			throw new Error(
				"development execution registry start was not committed before execution",
			);
		if (
			entry.event === "finished" &&
			(declaredAt < validTime(receipt.signedAt) ||
				signedAt < validTime(receipt.signedAt))
		)
			throw new Error(
				"development execution registry finish predates its signed receipt",
			);
		previousTrustedTimestamp = trustedTimestamp;
		previousHash = entrySha256;
	}
	if (
		started.size !== input.receipts.length ||
		finished.size !== input.receipts.length
	)
		throw new Error("development execution registry coverage is incomplete");
	if (previousHash === null)
		throw new Error("development execution registry head is missing");

	return {
		registeredDevelopmentExecutionChronologyExternallyVerified: true,
		offRegistryDevelopmentExecutionAbsenceExternallyVerified: false,
		registeredExecutionCount: input.receipts.length,
		registryHeadSha256: previousHash,
	};
}
