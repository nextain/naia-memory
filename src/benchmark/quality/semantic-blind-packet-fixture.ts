import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MemoryUpdateContract } from "./memory-update-contract.js";
import { buildSemanticCampaignPlan } from "./semantic-campaign-cli.js";

function sha256(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function sha256Json(value: unknown): string {
	return sha256(JSON.stringify(value));
}

export function semanticBlindFixture(directory: string) {
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
	const runs = buildSemanticCampaignPlan(executionSeed, 2).map((run) => {
		const output = {
			ingestionReceipts: [{ outcome: "opaque" }],
			nativeState: [{ nativeId: `${run.engine}-native`, content: "서울 거주" }],
			retrieved: [{ nativeId: `${run.engine}-native`, content: "서울 거주" }],
		};
		const benchmarkCase = contract.cases[0];
		const artifact = {
			schemaVersion: "naia-memory-semantic-raw-artifact-v2",
			disclosure: { engine: run.engine, executionSeed: run.caseExecutionSeed },
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
					retrievalSurface: "engine-native-semantic-memory-v1",
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
		schemaVersion: "naia-memory-semantic-campaign-v1" as const,
		disclosure: { executionSeed, repetitions: 2, topK: 5 },
		runs,
	};
	const campaignPath = resolve(directory, "campaign.json");
	writeFileSync(campaignPath, JSON.stringify(campaign));
	return { contract, contractPath, campaign, campaignPath };
}
