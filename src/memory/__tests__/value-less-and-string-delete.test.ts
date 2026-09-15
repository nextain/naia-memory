import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "../adapters/local.js";
import { MemorySystem } from "../index.js";
import type { DeleteCandidate, ExtractedFact, StructuredFact } from "../index.js";

let rootDir: string;
beforeEach(async () => {
	rootDir = await mkdtemp(join(tmpdir(), "value-less-delete-"));
});
afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true }).catch(() => {});
});

type Turn = { content: string; project: string; facts: (episodeId: string) => ExtractedFact[] };

function labelled(subject: string, property: string, value: string): StructuredFact {
	return { subject, property, value, polarity: "affirmed", cardinality: "single" };
}

function upsert(content: string, episodeId: string, structured?: StructuredFact): ExtractedFact {
	return { content, entities: [], topics: [], importance: 0.8, sourceEpisodeIds: [episodeId], ...(structured ? { structured } : {}) };
}

function remove(content: string, episodeId: string, utterance: string, targetQuote: string, structured: StructuredFact): ExtractedFact {
	return {
		...upsert(content, episodeId, structured),
		operation: "delete",
		deleteEvidence: { kind: "explicit_removal_request", evidenceQuote: utterance, targetQuote },
	};
}

async function run(turns: Turn[], approve: (candidates: DeleteCandidate[]) => string | null) {
	const offered: DeleteCandidate[][] = [];
	const adapter = new LocalAdapter(join(rootDir, `store-${randomUUID()}.json`));
	const system = new MemorySystem({
		adapter,
		consolidationIntervalMs: 0,
		factExtractor: async (episodes) =>
			episodes.flatMap((episode) => turns.find((turn) => turn.content === episode.content)!.facts(episode.id)),
		deleteVerifier: async (_episode, _fact, candidates) => {
			offered.push(candidates);
			const id = approve(candidates);
			return id ? { authorized: true, targetFactId: id } : { authorized: false };
		},
	});
	const start = Date.now() - 10 * 60 * 1000;
	for (const [index, turn] of turns.entries()) {
		await system.encode({ content: turn.content, role: "user", timestamp: start + index * 60_000 }, { project: turn.project });
	}
	const result = await system.consolidateNow(true);
	const facts = await adapter.semantic.getAll();
	await system.close();
	return { facts, offered, decisions: result.deleteDecisions ?? [] };
}

const statusOf = (facts: { content: string; status?: string }[], content: string) => facts.find((f) => f.content === content)?.status;

describe("value-less explicit delete naming the property", () => {
	const erase = "솔 프로젝트의 배포 채널 기억만 삭제해 줘. 숲 프로젝트는 그대로 둬.";

	it("archives the single active value in the project and leaves the other project alone", async () => {
		const { facts, offered, decisions } = await run(
			[
				{ content: "솔 프로젝트의 배포 채널은 사내 게시판이야.", project: "sol", facts: (e) => [upsert("솔 배포 채널: 사내 게시판", e, labelled("솔 프로젝트", "배포 채널", "사내 게시판"))] },
				{ content: "숲 프로젝트의 배포 채널은 소식지야.", project: "forest", facts: (e) => [upsert("숲 배포 채널: 소식지", e, labelled("숲 프로젝트", "배포 채널", "소식지"))] },
				{ content: erase, project: "sol", facts: (e) => [remove("솔 배포 채널: 사내 게시판", e, erase, "솔 프로젝트의 배포 채널", labelled("솔 프로젝트", "배포 채널", "사내 게시판"))] },
			],
			(candidates) => candidates[0]?.id ?? null,
		);
		expect(offered).toHaveLength(1);
		expect(offered[0].map((c) => [c.source, c.structured?.subject, c.structured?.property, c.structured?.value])).toEqual([
			["structured-label", "솔 프로젝트", "배포 채널", "사내 게시판"],
		]);
		expect(statusOf(facts, "솔 배포 채널: 사내 게시판")).toBe("archived");
		expect(facts.find((f) => f.content === "솔 배포 채널: 사내 게시판")?.deletedAt).toEqual(expect.any(Number));
		expect(statusOf(facts, "숲 배포 채널: 소식지")).toBe("active");
		expect(facts.find((f) => f.content === "숲 배포 채널: 소식지")?.deletedAt).toBeUndefined();
		expect(decisions).toEqual([
			expect.objectContaining({ outcome: "authorized", reasons: ["structured-label"], targetIds: [expect.any(String)] }),
		]);
	});

	it("records the grounding failure when the evidence quote is not the whole utterance", async () => {
		const { facts, offered, decisions } = await run(
			[
				{ content: "솔 프로젝트의 배포 채널은 사내 게시판이야.", project: "sol", facts: (e) => [upsert("솔 배포 채널: 사내 게시판", e, labelled("솔 프로젝트", "배포 채널", "사내 게시판"))] },
				{ content: erase, project: "sol", facts: (e) => [remove("솔 배포 채널: 사내 게시판", e, "솔 프로젝트의 배포 채널 기억만 삭제해 줘.", "솔 프로젝트의 배포 채널", labelled("솔 프로젝트", "배포 채널", "사내 게시판"))] },
			],
			(candidates) => candidates[0]?.id ?? null,
		);
		expect(offered).toHaveLength(0);
		expect(statusOf(facts, "솔 배포 채널: 사내 게시판")).toBe("active");
		expect(decisions).toEqual([
			expect.objectContaining({ outcome: "denied", reasons: ["evidence-not-whole-episode"], value: "사내 게시판" }),
		]);
	});

	it("offers nothing when the property holds more than one active value", async () => {
		const { facts, offered, decisions } = await run(
			[
				{ content: "솔 배포 채널은 사내 게시판이야.", project: "sol", facts: (e) => [upsert("솔 배포 채널: 사내 게시판", e, { ...labelled("솔 프로젝트", "배포 채널", "사내 게시판"), cardinality: "multi" })] },
				{ content: "솔 배포 채널에 메일링도 있어.", project: "sol", facts: (e) => [upsert("솔 배포 채널: 메일링", e, { ...labelled("솔 프로젝트", "배포 채널", "메일링"), cardinality: "multi" })] },
				{ content: erase, project: "sol", facts: (e) => [remove("솔 배포 채널: 사내 게시판", e, erase, "솔 프로젝트의 배포 채널", labelled("솔 프로젝트", "배포 채널", "사내 게시판"))] },
			],
			(candidates) => candidates[0]?.id ?? null,
		);
		expect(offered).toHaveLength(0);
		expect(facts.filter((f) => f.status === "archived")).toHaveLength(0);
		expect(decisions).toEqual([expect.objectContaining({ outcome: "denied", reasons: ["sibling-values>1"] })]);
	});
});

describe("delete of an unstructured fact by exact content", () => {
	const erase = "기억에서 창고 출입 암호를 지워 줘. 암호 값을 다시 알려 주지 마.";
	const code = "사용자 창고 출입 암호: 달빛상자";
	const note = "사용자 창고 출입 암호(테스트용): 가상 암호";
	const first = { content: "창고 출입 암호는 달빛상자야. 테스트용 가상 암호야.", project: "p", facts: (e: string) => [upsert(code, e), upsert(note, e)] };

	it("archives only the unstructured fact whose content equals the delete", async () => {
		const { facts, offered } = await run(
			[first, { content: erase, project: "p", facts: (e) => [remove(code, e, erase, "창고 출입 암호", { ...labelled("사용자", "창고 출입 암호", "달빛상자"), subjectId: "person:self", propertyId: "preference:tool" })] }],
			(candidates) => candidates[0]?.id ?? null,
		);
		expect(offered[0].map((c) => [c.source, c.content, c.structured])).toEqual([["string-exact", code, undefined]]);
		expect(statusOf(facts, code)).toBe("archived");
		expect(statusOf(facts, note)).toBe("active");
	});

	it("offers nothing when the user's target quote does not name the fact", async () => {
		const { facts, offered } = await run(
			[first, { content: erase, project: "p", facts: (e) => [remove(code, e, erase, "출입 암호를 지워", { ...labelled("사용자", "창고 출입 암호", "달빛상자"), subjectId: "person:self", propertyId: "preference:tool" })] }],
			(candidates) => candidates[0]?.id ?? null,
		);
		expect(offered).toHaveLength(0);
		expect(statusOf(facts, code)).toBe("active");
	});

	it("never offers an unstructured fact from the deleting utterance itself", async () => {
		const utterance = "창고 출입 암호 달빛상자는 지워 줘.";
		const { facts, offered } = await run(
			[{ content: utterance, project: "p", facts: (e) => [upsert("창고 출입 암호 달빛상자", e), remove("창고 출입 암호 달빛상자", e, utterance, "창고 출입 암호 달빛상자", labelled("사용자", "창고 출입 암호", "달빛상자"))] }],
			(candidates) => candidates[0]?.id ?? null,
		);
		expect(offered).toHaveLength(0);
		expect(statusOf(facts, "창고 출입 암호 달빛상자")).toBe("active");
	});
});

describe("delete of an unstructured fact holding the named value", () => {
	// Korean confirmation set ko-045 / ko-113: the original value was stored
	// without structure and the delete op's content is not that fact's content.
	const erase = "아까 말한 내 금고 비밀번호는 기억에서 지워 줘. 값은 다시 말하지 마.";
	const vault = "사용자 금고 비밀번호(테스트용): 3852";
	const email = "사용자 이메일 비밀번호(테스트용): 3852";
	const first = { content: "테스트용 가상 내 금고 비밀번호는 3852이고 이메일 비밀번호도 3852야.", project: "p", facts: (e: string) => [upsert(vault, e), upsert(email, e)] };
	const request = (target: string, value: string) => ({
		content: erase,
		project: "p",
		facts: (e: string) => [remove(erase, e, erase, target, labelled("사용자", "금고 비밀번호", value))],
	});

	it("offers the fact that names the target and holds the value, and archives it", async () => {
		const { facts, offered, decisions } = await run([first, request("금고 비밀번호", "3852")], (candidates) => candidates[0]?.id ?? null);
		expect(offered[0].map((c) => [c.source, c.content])).toEqual([["string-value", vault]]);
		expect(statusOf(facts, vault)).toBe("archived");
		expect(statusOf(facts, email)).toBe("active");
		expect(decisions).toEqual([expect.objectContaining({ outcome: "authorized", reasons: ["string-value"] })]);
	});

	it("offers nothing when the named value is not in the fact", async () => {
		const { facts, offered, decisions } = await run([first, request("금고 비밀번호", "1111")], (candidates) => candidates[0]?.id ?? null);
		expect(offered).toHaveLength(0);
		expect(statusOf(facts, vault)).toBe("active");
		expect(decisions).toEqual([expect.objectContaining({ outcome: "denied", reasons: ["no-candidate"] })]);
	});
});

describe("delete verifier payload", () => {
	it("shows labels for structured candidates and content for unstructured ones", async () => {
		const { buildLLMDeleteVerifier } = await import("../llm-delete-verifier.js");
		let prompt = "";
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
			prompt = JSON.parse(String(init?.body)).messages[0].content;
			return new Response(JSON.stringify({ choices: [{ message: { content: '{"authorized":false}' } }] }), { status: 200 });
		}) as typeof fetch;
		try {
			const verifier = buildLLMDeleteVerifier({ apiKey: "test", baseURL: "https://example.test/v1/" });
			const utterance = "솔 프로젝트의 배포 채널 기억만 삭제해 줘.";
			await verifier(
				{ id: "e3", content: utterance, role: "user" } as never,
				remove("솔 배포 채널: 사내 게시판", "e3", utterance, "솔 프로젝트의 배포 채널", labelled("솔 프로젝트", "배포 채널", "사내 게시판")),
				[
					{ id: "a", source: "structured-label", structured: labelled("솔 프로젝트", "배포 채널", "사내 게시판") },
					{ id: "b", source: "string-exact", content: "사용자 창고 출입 암호: 달빛상자" },
				],
			);
		} finally {
			globalThis.fetch = realFetch;
		}
		expect(prompt).toContain('{"id":"a","structured":{"subject":"솔 프로젝트","property":"배포 채널","value":"사내 게시판"');
		expect(prompt).toContain('{"id":"b","content":"사용자 창고 출입 암호: 달빛상자"}');
		expect(prompt).not.toContain("string-exact");
	});
});
