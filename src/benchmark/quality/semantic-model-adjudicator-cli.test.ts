import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSemanticModelAdjudicatorCli } from "./semantic-model-adjudicator-cli.js";

describe("semantic model adjudicator CLI", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		Reflect.deleteProperty(process.env, "GEMINI_API_KEY");
	});

	it("records empty retrievals without asking the model to reproduce them", async () => {
		const directory = mkdtempSync(resolve(tmpdir(), "semantic-model-judge-"));
		const packet = resolve(directory, "packet.json");
		const output = resolve(directory, "judgments.json");
		try {
			writeFileSync(
				packet,
				JSON.stringify({
					packetContentSha256: "packet-hash",
					samples: [
						{
							sampleId: "sample-empty",
							language: "ko",
							turns: [{ content: "기억을 지워줘." }],
							query: "무엇을 기억해?",
							retrieved: [],
						},
					],
				}),
			);
			process.env.GEMINI_API_KEY = "test-key";
			const fetchMock = vi.fn();
			vi.stubGlobal("fetch", fetchMock);

			await runSemanticModelAdjudicatorCli([
				`--packet=${packet}`,
				`--output=${output}`,
			]);

			expect(fetchMock).not.toHaveBeenCalled();
			const result = JSON.parse(readFileSync(output, "utf8"));
			expect(result.samples).toEqual([
				{
					sampleId: "sample-empty",
					judgments: [],
					adjudicatorId: "google-ai-studio/gemini-2.5-flash-lite",
					adjudicationMethod: "deterministic-no-retrieval",
				},
			]);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
