import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MemoryUpdateContract } from "./memory-update-contract.js";
import {
	type SUPPORTED_SEMANTIC_ENGINES,
	buildSemanticCampaignPlan,
} from "./semantic-campaign-cli.js";
import { expectedSemanticRetrievalSurface } from "./semantic-raw-cli.js";

function sha256(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function sha256Json(value: unknown): string {
	return sha256(JSON.stringify(value));
}

export function semanticBlindFixture(
	directory: string,
	options?: {
		engines: Array<(typeof SUPPORTED_SEMANTIC_ENGINES)[number]>;
		schemaVersion: "naia-memory-semantic-campaign-v3";
	},
) {
	const contract: MemoryUpdateContract = {
		schemaVersion: "naia-memory-update-contract-v1",
		tier: "semantic-update-interpretation",
		construction: "generated-diagnostic",
		cases: [
			{
				id: "ko-update",
				familyId: "update",
				split: "diagnostic",
				language: "ko",
				turns: [
					{ content: "저는 부산에 살아요.", at: "2026-01-01T00:00:00Z" },
					{ content: "이제 서울로 이사했어요.", at: "2026-02-01T00:00:00Z" },
				],
				query: "지금 어디에 살고 있나요?",
				expectedCurrentIds: ["seoul"],
				forbiddenStaleIds: ["busan"],
				expectedDeletedIds: [],
				noUpdateIds: [],
				expectedDecision: "update",
			},
		],
	};
	const contractPath = resolve(directory, "contract.json");
	writeFileSync(contractPath, JSON.stringify(contract));
	const executionSeed = "frozen-campaign";
	const engines = options?.engines ?? ["hindsight", "mem0", "naia"];
	const repetitions = engines.length;
	const runs = buildSemanticCampaignPlan(
		executionSeed,
		repetitions,
		engines,
	).map((run) => {
		const benchmarkCase = contract.cases[0];
		const output =
			run.engine === "plain-vector"
				? {
						ingestionReceipts: [
							{ outcome: "native-operations", nativeOperationCount: 1 },
							{ outcome: "native-operations", nativeOperationCount: 1 },
						],
						nativeState: benchmarkCase.turns.map((turn, turnIndex) => ({
							nativeId: `turn-${String(turnIndex + 1).padStart(6, "0")}`,
							content: turn.content,
						})),
						retrieved: [
							{
								nativeId: "turn-000002",
								content: benchmarkCase.turns[1]?.content ?? "",
							},
						],
					}
				: {
						ingestionReceipts: [{ outcome: "opaque" }],
						nativeState: [
							{ nativeId: `${run.engine}-native`, content: "서울 거주" },
						],
						retrieved: [
							{ nativeId: `${run.engine}-native`, content: "서울 거주" },
						],
					};
		const artifact = {
			schemaVersion: "naia-memory-semantic-raw-artifact-v2",
			disclosure: {
				engine: run.engine,
				executionSeed: run.caseExecutionSeed,
				topK: 5,
			},
			cases: [
				{
					caseId: benchmarkCase.id,
					executionPosition: 1,
					language: benchmarkCase.language,
					fixtureSha256: sha256Json({
						language: benchmarkCase.language,
						turns: benchmarkCase.turns,
						query: benchmarkCase.query,
					}),
					engineInputSha256: sha256Json({
						language: benchmarkCase.language,
						turns: benchmarkCase.turns.map(({ content }) => ({ content })),
						query: benchmarkCase.query,
					}),
					ingestionPolicy: "sequential-turn-commit-v1",
					temporalInputPolicy: "engine-default-ingest-time-v1",
					retrievalSurface: expectedSemanticRetrievalSurface(run.engine),
					...output,
					outputSha256: sha256Json(output),
				},
			],
		};
		const bytes = JSON.stringify(artifact);
		writeFileSync(resolve(directory, run.outputFile), bytes);
		return { ...run, artifactSha256: sha256(bytes) };
	});
	const campaign = {
		schemaVersion:
			options?.schemaVersion ?? ("naia-memory-semantic-campaign-v2" as const),
		disclosure: {
			executionSeed,
			repetitions,
			topK: 5,
			...(options ? { engines } : {}),
		},
		runs,
	};
	const campaignPath = resolve(directory, "campaign.json");
	writeFileSync(campaignPath, JSON.stringify(campaign));
	return { contract, contractPath, campaign, campaignPath };
}
