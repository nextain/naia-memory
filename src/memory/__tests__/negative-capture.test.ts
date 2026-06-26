import { describe, it, expect, afterEach } from "vitest";
import {
	classifyNegativeCapture,
	filterNegativeCapture,
} from "../negative-capture.js";
import { LocalAdapter } from "../adapters/local.js";
import { MemorySystem } from "../index.js";

describe("negative-capture — DROP unambiguous error signatures", () => {
	const dropCases: ReadonlyArray<[string, string]> = [
		["command not found: gh", "env:command-not-found"],
		["명령을 찾을 수 없음: gh", "env:command-not-found"],
		["gh is not installed", "env:not-installed"],
		["Cannot find module 'requests'", "env:not-installed"],
		["ModuleNotFoundError: No module named requests", "env:not-installed"],
		["API key가 없음", "env:credential-missing"],
		["GITHUB_TOKEN is missing", "env:credential-missing"],
		["permission denied", "env:access-denied"],
		["ENOENT: no such file or directory", "env:path-enoent"],
		["the search tool is broken", "tool-broken-claim"],
		["browser 도구가 작동 안 함", "tool-broken-claim"],
		["수정 도구가 고장남", "tool-broken-claim"], // 수정=noun, no FIX-completion → still dropped
		["ECONNREFUSED on gateway", "transient-error"],
		["오늘 뉴스 요약했음", "one-off-task"],
	];
	for (const [content, reason] of dropCases) {
		it(`drops "${content}" (${reason})`, () => {
			expect(classifyNegativeCapture(content)).toBe(reason);
		});
	}
});

describe("negative-capture — KEEP durable facts (no false positives)", () => {
	const keepCases: ReadonlyArray<string> = [
		// plain user facts
		"사용자 직업: 소프트웨어 엔지니어",
		"사용자 선호 에디터: VS Code",
		"사용자 거주지: 서울",
		"프로젝트 포트: 3000",
		"사용자 빌드 도구: webpack",
		// codex round-1 FP regressions
		"사용자 방 번호는 503호",
		"단축키: ctrl+s",
		"사용자 검색 키워드: 머신러닝",
		"정리: 사용자는 주말마다 방 정리를 선호",
		// codex round-2 FP regressions — durable config/policy knowledge
		"timeout 기본값은 30초다",
		"API rate limit은 분당 60회로 둔다",
		"사용자 토큰 정책: 없으면 자동 생성한다",
		"사용자는 admin 권한 없음",
		"gateway returned 503", // numeric handled by LLM prompt, not the deterministic backstop
		"service unavailable",
		"도구 실행 실패를 telemetry로 기록", // failure EVENT, not a broken-claim
		// capture-the-FIX
		"수정: PATH에 node 추가",
		"해결책: npm install 로 의존성 설치",
		"command not found 는 PATH로 수정됨", // fix-completion narrative kept
	];
	for (const content of keepCases) {
		it(`keeps "${content}"`, () => {
			expect(classifyNegativeCapture(content)).toBeNull();
		});
	}
});

describe("filterNegativeCapture — partition", () => {
	it("splits kept/dropped and preserves the kept objects", () => {
		const facts = [
			{ content: "사용자 직업: 소프트웨어 엔지니어", importance: 0.8 },
			{ content: "command not found: gh", importance: 0.2 },
			{ content: "사용자 선호 에디터: VS Code", importance: 0.6 },
			{ content: "the browser tool is broken", importance: 0.1 },
		];
		const { kept, dropped } = filterNegativeCapture(facts);
		expect(kept.map((f) => f.content)).toEqual([
			"사용자 직업: 소프트웨어 엔지니어",
			"사용자 선호 에디터: VS Code",
		]);
		expect(kept[0]!.importance).toBe(0.8);
		expect(dropped.map((d) => d.reason)).toEqual([
			"env:command-not-found",
			"tool-broken-claim",
		]);
	});

	it("handles null/empty input", () => {
		expect(filterNegativeCapture(null).kept).toEqual([]);
		expect(filterNegativeCapture(undefined).dropped).toEqual([]);
		expect(filterNegativeCapture([]).kept).toEqual([]);
	});

	it("empty/whitespace content is kept (no false drop)", () => {
		expect(classifyNegativeCapture("")).toBeNull();
		expect(classifyNegativeCapture("   ")).toBeNull();
	});
});

// Integration: the filter is wired into consolidateNow's chokepoint (index.ts).
describe("negative-capture integration — consolidateNow chokepoint", () => {
	let mem: MemorySystem | undefined;
	afterEach(async () => {
		await mem?.close();
		mem = undefined;
	});

	it("drops a broken-tool fact during consolidation, keeps the durable one", async () => {
		const tmp = `/tmp/negcap-int-${process.pid}-${Math.random().toString(36).slice(2)}.json`;
		const adapter = new LocalAdapter({ storePath: tmp });
		mem = new MemorySystem({
			adapter,
			factExtractor: async (episodes) =>
				episodes.flatMap((ep) => [
					{
						content: "사용자 선호 에디터: VS Code",
						entities: [],
						topics: [],
						importance: 0.8,
						maxEmotion: 0,
						sourceEpisodeIds: [ep.id],
					},
					{
						content: "the browser tool is broken",
						entities: [],
						topics: [],
						importance: 0.5,
						maxEmotion: 0,
						sourceEpisodeIds: [ep.id],
					},
				]),
		});
		await mem.init();
		await mem.encode(
			{ content: "에디터 얘기", role: "user" },
			{ project: "p", sessionId: "s" },
		);
		await mem.consolidateNow(true); // force = bypass 5-min age gate

		const stored: string[] = ((adapter as any).getStore?.()?.facts ?? []).map(
			(f: any) => String(f?.content ?? ""),
		);
		expect(stored.some((c) => c.includes("VS Code"))).toBe(true);
		expect(stored.some((c) => c.includes("broken"))).toBe(false);
	});
});
