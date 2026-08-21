import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type MemoryUpdateContract,
	computeFamilySplitDigest,
} from "./memory-update-contract.js";
import { runSemanticPublicGateCli } from "./semantic-public-gate-cli.js";

const roots: string[] = [];

async function root(): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), "naia-semantic-public-gate-"));
	roots.push(path);
	return path;
}

function publicContract(): MemoryUpdateContract {
	const languages = ["ko", "en", "ja"] as const;
	const decisions = ["update", "delete", "no-update"] as const;
	const cases = Array.from({ length: 102 }, (_, index) => {
		const language = languages[index % languages.length] ?? "ko";
		const decision =
			decisions[Math.floor(index / languages.length) % decisions.length] ??
			"update";
		const isDelete = decision === "delete";
		const isNoUpdate = decision === "no-update";
		return {
			id: `public-${index}`,
			familyId: `family-public-${index}`,
			split: "test" as const,
			language,
			turns: [{ content: `content-${index}`, at: "2026-01-01T00:00:00Z" }],
			query: `query-${index}`,
			expectedCurrentIds: ["current"],
			forbiddenStaleIds: ["stale"],
			expectedDeletedIds: isDelete ? ["deleted"] : [],
			noUpdateIds: isNoUpdate ? ["unchanged"] : [],
			expectedDecision: decision,
			provenance: {
				authorId: `author-${language}`,
				authorNativeLanguages: [language],
				authoredAt: "2026-01-02T00:00:00Z",
				reviewerId: `reviewer-${language}`,
				reviewerNativeLanguages: [language],
				reviewedAt: "2026-01-03T00:00:00Z",
				reviewDecision: "accepted" as const,
			},
		};
	});
	return {
		schemaVersion: "naia-memory-update-contract-v1",
		tier: "semantic-update-interpretation",
		construction: "independent-native-reviewed",
		familySplitFreeze: {
			frozenAt: "2026-01-04T00:00:00Z",
			digest: computeFamilySplitDigest(cases) as `sha256:${string}`,
		},
		cases,
	};
}

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(
		roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("semantic public gate CLI", () => {
	it("reports only held-out test cases and distinct families", async () => {
		const output: string[] = [];
		vi.spyOn(process.stdout, "write").mockImplementation((value) => {
			output.push(String(value));
			return true;
		});
		const contractPath = join(await root(), "public.json");
		await writeFile(contractPath, JSON.stringify(publicContract()));
		expect(await runSemanticPublicGateCli([contractPath])).toBe(0);
		expect(JSON.parse(output.pop() ?? "{}")).toEqual({
			promotable: true,
			testCaseCount: 102,
			testFamilyCount: 102,
		});
	});

	it("uses exit code 2 for invalid arity", async () => {
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		expect(await runSemanticPublicGateCli([])).toBe(2);
	});

	it("fails closed with sanitized unreadable and malformed errors", async () => {
		const output: string[] = [];
		vi.spyOn(process.stdout, "write").mockImplementation((value) => {
			output.push(String(value));
			return true;
		});
		const directory = await root();
		expect(
			await runSemanticPublicGateCli([join(directory, "missing.json")]),
		).toBe(1);
		expect(JSON.parse(output.pop() ?? "{}")).toEqual({
			promotable: false,
			failure: "contract is unreadable",
		});

		const malformed = join(directory, "malformed.json");
		await writeFile(malformed, "{");
		expect(await runSemanticPublicGateCli([malformed])).toBe(1);
		expect(JSON.parse(output.pop() ?? "{}")).toEqual({
			promotable: false,
			failure: "contract is not valid JSON",
		});

		const nullRoot = join(directory, "null.json");
		await writeFile(nullRoot, "null");
		expect(await runSemanticPublicGateCli([nullRoot])).toBe(1);
		expect(JSON.parse(output.pop() ?? "{}")).toEqual({
			promotable: false,
			failure: "contract root must be an object",
		});

		const arrayRoot = join(directory, "array.json");
		await writeFile(arrayRoot, "[]");
		expect(await runSemanticPublicGateCli([arrayRoot])).toBe(1);
		expect(JSON.parse(output.pop() ?? "{}").failure).toBe(
			"contract root must be an object",
		);

		const missingCases = join(directory, "missing-cases.json");
		await writeFile(missingCases, "{}");
		expect(await runSemanticPublicGateCli([missingCases])).toBe(1);
		expect(JSON.parse(output.pop() ?? "{}").failure).toBe(
			"contract cases must be an array",
		);

		const pilot = publicContract();
		pilot.cases = pilot.cases.slice(0, 3);
		if (!pilot.familySplitFreeze)
			throw new Error("fixture requires a family split freeze");
		pilot.familySplitFreeze.digest = computeFamilySplitDigest(
			pilot.cases,
		) as `sha256:${string}`;
		const pilotPath = join(directory, "pilot.json");
		await writeFile(pilotPath, JSON.stringify(pilot));
		expect(await runSemanticPublicGateCli([pilotPath])).toBe(1);
		expect(JSON.parse(output.pop() ?? "{}").failure).toBe(
			"public semantic gate requires at least 100 test cases",
		);
	});

	it("rejects oversized input before parsing", async () => {
		const output: string[] = [];
		vi.spyOn(process.stdout, "write").mockImplementation((value) => {
			output.push(String(value));
			return true;
		});
		const oversized = join(await root(), "oversized.json");
		await writeFile(oversized, Buffer.alloc(16 * 1024 * 1024 + 1));
		expect(await runSemanticPublicGateCli([oversized])).toBe(1);
		expect(JSON.parse(output.pop() ?? "{}").failure).toBe(
			"contract exceeds the 16 MiB intake limit",
		);
	});
});
