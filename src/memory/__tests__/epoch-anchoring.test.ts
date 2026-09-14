import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemorySystem } from "../index.js";
import { SqliteAdapter } from "../adapters/sqlite.js";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Epoch-based Anchoring", () => {
    let memory: MemorySystem;
    let adapter: SqliteAdapter;
    let tempDir: string;
    let tempDbPath: string;

    beforeEach(async () => {
        tempDir = mkdtempSync(join(tmpdir(), "naia-memory-sqlite-epoch-"));
        tempDbPath = join(tempDir, `test-epoch-${randomUUID()}.db`);
        adapter = new SqliteAdapter({ dbPath: tempDbPath });
        memory = new MemorySystem({ adapter });
        await memory.init();
    });

    afterEach(async () => {
        await memory.close();
        rmSync(tempDir, { recursive: true, force: true });
    });

    it("should resolve epoch anchor to temporal pivot for retrieval", async () => {
        const now = Date.now();
        const oneYearAgo = now - (365 * 24 * 60 * 60 * 1000);
        
        // 1. 에포크 등록: '대학 시절' (1년 전 시작)
        await memory.upsertEpoch({
            id: "epoch-college",
            name: "대학 시절",
            description: "대학교 재학 기간",
            start: oneYearAgo,
            end: oneYearAgo + (180 * 24 * 60 * 60 * 1000) // 6개월간
        });

        // 2. 대학 시절(1년 전)에 유효했던 팩트 저장
        // bi-temporal chain을 흉내내기 위해 팩트 직접 주입
        const oldFact = {
            id: "fact-hobby",
            content: "내 취미는 농구야.",
            entities: ["농구", "취미"],
            topics: ["personal"],
            createdAt: oneYearAgo - 10000, // 에포크 시작(oneYearAgo)보다 훨씬 전 생성
            updatedAt: oneYearAgo - 10000,
            importance: 0.7,
            recallCount: 0,
            lastAccessed: oneYearAgo - 10000,
            strength: 0.7,
            status: "superseded" as const, 
            validFrom: oneYearAgo - 10000,
            validTo: oneYearAgo + (200 * 24 * 60 * 60 * 1000),
            sourceEpisodes: [],
            encodingContext: { project: "personal" }
        };

        const newFact = {
            id: "fact-hobby-v2",
            content: "내 취미는 테니스야.",
            entities: ["테니스", "취미"],
            topics: ["personal"],
            createdAt: now - 1000,
            updatedAt: now - 1000,
            importance: 0.8,
            recallCount: 0,
            lastAccessed: now - 1000,
            strength: 0.8,
            status: "active" as const,
            validFrom: now - 2000,
            validTo: null,
            supersedes: "fact-hobby",
            sourceEpisodes: [],
            encodingContext: { project: "personal" }
        };

        await adapter.semantic.upsert(oldFact);
        await adapter.semantic.upsert(newFact);

        // 3. 일반 검색 (최신 취미인 '테니스'가 나와야 함)
        const currentResult = await memory.recall("내 취미가 뭐야?", { project: "personal" });
        expect(currentResult.facts[0].content).toContain("테니스");

        // 4. 에포크 앵커 검색 ('대학 시절' 앵커 사용 시 '농구'가 나와야 함)
        const epochResult = await memory.recall("내 취미가 뭐야?", { 
            project: "personal",
            mode: "at-time",
            epochAnchor: "대학 시절" 
        } as any);

        expect(epochResult.facts.length).toBeGreaterThan(0);
        expect(epochResult.facts[0].content).toContain("농구");
    });

    it("should retrieve multiple facts that overlap with the epoch range", async () => {
        const now = Date.now();
        const twoYearsAgo = now - (2 * 365 * 24 * 60 * 60 * 1000);
        
        // 1. 에포크 등록: '서울 거주 시절' (2년 전 ~ 1년 전)
        await memory.upsertEpoch({
            id: "epoch-seoul",
            name: "서울 거주 시절",
            start: twoYearsAgo,
            end: twoYearsAgo + (365 * 24 * 60 * 60 * 1000)
        });

        // 2. 해당 기간에 유효했던 여러 사실들 주입
        const facts = [
            {
                id: "fact-seoul-1",
                content: "강남역 근처에서 살았어.",
                validFrom: twoYearsAgo + 1000,
                validTo: twoYearsAgo + (500 * dayMs) // 에포크 종료 후까지 유효
            },
            {
                id: "fact-seoul-2",
                content: "매일 2호선을 타고 출근했어.",
                validFrom: twoYearsAgo - (10 * dayMs), // 에포크 시작 전부터 유효
                validTo: twoYearsAgo + (100 * dayMs)
            },
            {
                id: "fact-other",
                content: "현재는 부산에 살고 있어.",
                validFrom: now - (30 * dayMs),
                validTo: null
            }
        ];

        for (const f of facts) {
            await adapter.semantic.upsert({
                ...f,
                entities: [],
                topics: ["location"],
                createdAt: f.validFrom,
                updatedAt: f.validFrom,
                importance: 0.8,
                recallCount: 0,
                lastAccessed: f.validFrom,
                strength: 0.8,
                status: "active" as const,
                sourceEpisodes: []
            } as any);
        }

        // 3. 에포크 앵커 검색: '서울' 관련 팩트 2개가 모두 인출되어야 함
        const result = await memory.recall("어디 살았어?", { 
            project: "location",
            mode: "at-time",
            epochAnchor: "서울" 
        } as any);

        const contents = result.facts.map(f => f.content);
        expect(contents).toContain("강남역 근처에서 살았어.");
        expect(contents).toContain("매일 2호선을 타고 출근했어.");
        expect(contents).not.toContain("부산에 살고 있어.");
    });
});

const dayMs = 24 * 60 * 60 * 1000;
