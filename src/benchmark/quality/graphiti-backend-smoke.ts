import { randomUUID } from "node:crypto";
import type {
	GraphitiNativeFact,
	GraphitiSemanticClient,
} from "./bridge-graphiti-semantic.js";

export type GraphitiBackendSmokeResult = {
	schemaVersion: 1;
	passed: boolean;
	checks: {
		episodeCommit: boolean;
		namespaceIsolation: boolean;
		supersessionObserved: boolean;
		searchStateIdentity: boolean;
	};
	counts: {
		beforeUpdate: number;
		afterUpdate: number;
		isolatedGroup: number;
		expiredFromCurrentState: number;
		newInCurrentState: number;
		searchResults: number;
	};
};

export type GraphitiBackendSmokeOptions = {
	pollIntervalMs?: number;
	timeoutMs?: number;
	wait?: (milliseconds: number) => Promise<void>;
};

export async function runGraphitiBackendSmoke(
	client: GraphitiSemanticClient,
	options: GraphitiBackendSmokeOptions = {},
): Promise<GraphitiBackendSmokeResult> {
	const groupA = `graphiti-smoke-a-${randomUUID()}`;
	const groupB = `graphiti-smoke-b-${randomUUID()}`;
	const pollIntervalMs = options.pollIntervalMs ?? 250;
	const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
	const wait =
		options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
	let outcome: GraphitiBackendSmokeResult | undefined;
	let executionError: unknown;
	try {
		await ingestAndWait(
			client,
			groupA,
			"저는 서울에 살고 있습니다.",
			pollIntervalMs,
			timeoutMs,
			wait,
		);
		const before = await client.listCurrentFacts(groupA);
		await ingestAndWait(
			client,
			groupB,
			"저는 제주도에서 감귤 농장을 운영합니다.",
			pollIntervalMs,
			timeoutMs,
			wait,
		);
		const isolated = await client.listCurrentFacts(groupB);
		const groupAAfterB = await client.listCurrentFacts(groupA);
		await ingestAndWait(
			client,
			groupA,
			"서울에서 부산으로 이사했습니다. 이제 서울에 살지 않고 부산에 삽니다.",
			pollIntervalMs,
			timeoutMs,
			wait,
		);
		const after = await client.listCurrentFacts(groupA);
		const search = await client.searchFacts({
			query: "지금 어디에 살고 있나요?",
			groupIds: [groupA],
			maxFacts: 10,
		});

		const beforeIds = new Set(before.map((fact) => fact.uuid));
		const afterIds = new Set(after.map((fact) => fact.uuid));
		const expired = [...beforeIds].filter((id) => !afterIds.has(id));
		const created = [...afterIds].filter((id) => !beforeIds.has(id));
		const state = new Map(after.map((fact) => [fact.uuid, fact.fact]));
		const namespaceIsolation =
			before.length > 0 &&
			isolated.length > 0 &&
			groupAAfterB.length === before.length &&
			before.every((fact) =>
				groupAAfterB.some((candidate) => sameFact(fact, candidate)),
			) &&
			!isolated.some((fact) => beforeIds.has(fact.uuid));
		const searchStateIdentity =
			search.length > 0 &&
			search.every((fact) => state.get(fact.uuid) === fact.fact);
		const supersessionObserved = expired.length > 0 && created.length > 0;
		const checks = {
			episodeCommit: true,
			namespaceIsolation,
			supersessionObserved,
			searchStateIdentity,
		};
		outcome = {
			schemaVersion: 1,
			passed: Object.values(checks).every(Boolean),
			checks,
			counts: {
				beforeUpdate: before.length,
				afterUpdate: after.length,
				isolatedGroup: isolated.length,
				expiredFromCurrentState: expired.length,
				newInCurrentState: created.length,
				searchResults: search.length,
			},
		};
	} catch (error) {
		executionError = error;
	}

	const cleanup = await Promise.allSettled([
		client.deleteGroup(groupA),
		client.deleteGroup(groupB),
	]);
	const cleanupErrors = cleanup
		.filter(
			(result): result is PromiseRejectedResult => result.status === "rejected",
		)
		.map((failure) => failure.reason);
	if (cleanupErrors.length > 0)
		throw new AggregateError(
			executionError === undefined
				? cleanupErrors
				: [executionError, ...cleanupErrors],
			"Graphiti smoke cleanup failed",
		);
	if (executionError !== undefined) throw executionError;
	if (outcome === undefined)
		throw new Error("Graphiti smoke produced no outcome");
	return outcome;
}

async function ingestAndWait(
	client: GraphitiSemanticClient,
	groupId: string,
	content: string,
	pollIntervalMs: number,
	timeoutMs: number,
	wait: (milliseconds: number) => Promise<void>,
): Promise<void> {
	const uuid = randomUUID();
	await client.addEpisode({
		uuid,
		groupId,
		content,
		name: `smoke-${uuid}`,
		sourceDescription: "Graphiti pinned-backend smoke probe",
	});
	const deadline = Date.now() + timeoutMs;
	while (!(await client.hasEpisode({ uuid, groupId }))) {
		if (Date.now() >= deadline)
			throw new Error("Graphiti smoke episode commit timed out");
		await wait(pollIntervalMs);
	}
}

function sameFact(
	left: GraphitiNativeFact,
	right: GraphitiNativeFact | undefined,
): boolean {
	return (
		right !== undefined && left.uuid === right.uuid && left.fact === right.fact
	);
}
