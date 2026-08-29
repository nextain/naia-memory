import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface H3Contract {
	schema_version: string;
	source: {
		dataset_cases: number;
		dataset_revision: string;
		dataset_sha256: string;
		upstream_harness_revision: string;
		upstream_file_sha256: Record<string, string>;
	};
	retrieval: {
		top_k: number;
		labels_hidden_until_freeze: string[];
	};
	reader: { model: string; temperature: number; max_output_tokens: number };
	judge: { model: string; temperature: number; max_output_tokens: number };
	decision_rule: {
		support: string;
		refute: string;
		superiority_boundary: string;
	};
}

const sha256Pattern = /^[a-f0-9]{64}$/;
const revisionPattern = /^[a-f0-9]{40}$/;

async function loadContract(): Promise<H3Contract> {
	const url = new URL("./longmemeval-h3-contract.json", import.meta.url);
	return JSON.parse(await readFile(url, "utf8")) as H3Contract;
}

describe("LongMemEval H3 preregistration", () => {
	it("pins the immutable dataset and official evaluator surface", async () => {
		const contract = await loadContract();

		expect(contract.schema_version).toBe("naia.longmemeval.h3.v1");
		expect(contract.source.dataset_cases).toBe(500);
		expect(contract.source.dataset_revision).toMatch(revisionPattern);
		expect(contract.source.dataset_sha256).toMatch(sha256Pattern);
		expect(contract.source.upstream_harness_revision).toMatch(revisionPattern);
		expect(Object.keys(contract.source.upstream_file_sha256)).toHaveLength(5);
		expect(Object.values(contract.source.upstream_file_sha256)).toEqual(
			expect.arrayContaining([expect.stringMatching(sha256Pattern)]),
		);
	});

	it("freezes the official top-50 reader and judge conditions", async () => {
		const contract = await loadContract();

		expect(contract.retrieval.top_k).toBe(50);
		expect(contract.retrieval.labels_hidden_until_freeze).toEqual([
			"answer",
			"answer_session_ids",
			"has_answer",
		]);
		expect(contract.reader).toMatchObject({
			model: "gpt-4o-2024-08-06",
			temperature: 0,
			max_output_tokens: 800,
		});
		expect(contract.judge).toMatchObject({
			model: "gpt-4o-2024-08-06",
			temperature: 0,
			max_output_tokens: 10,
		});
	});

	it("prevents a protocol-matched result from becoming an unsupported SOTA claim", async () => {
		const contract = await loadContract();

		expect(contract.decision_rule.support).toContain(
			"keyword-fallback control",
		);
		expect(contract.decision_rule.refute).toContain("label-isolation failure");
		expect(contract.decision_rule.superiority_boundary).toContain(
			"does not establish global SOTA",
		);
	});
});
