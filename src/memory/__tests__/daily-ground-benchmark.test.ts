import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MemorySystem } from "../index.js";
import { SqliteAdapter } from "../adapters/sqlite.js";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Daily Ground Dynamic Benchmark (Gold Standard Verification)", () => {
    let memory: MemorySystem;
    let adapter: SqliteAdapter;
    let tempDir: string;
    let dbPath: string;

    beforeEach(async () => {
        tempDir = mkdtempSync(join(tmpdir(), "naia-memory-sqlite-daily-"));
        dbPath = join(tempDir, `test-daily-${randomUUID()}.db`);
        adapter = new SqliteAdapter({ dbPath });
        // Heuristic extractor 대신 엔티티 추출이 가능한 모킹된 extractor 사용
        const mockExtractor = async (episodes: any) => {
            return episodes.map((ep: any) => ({
                content: ep.content,
                entities: ep.content.includes("비건") ? ["비건", "식습관"] : 
                          ep.content.includes("생선") ? ["생선", "식습관"] :
                          ep.content.includes("요리") ? ["요리", "서두름"] :
                          ep.content.includes("코딩") ? ["코딩", "서두름"] : ["퇴사"],
                topics: ["personal"],
                importance: ep.content.includes("퇴사") ? 0.9 : 0.8,
                maxEmotion: 0.5,
                sourceEpisodeIds: [ep.id]
            }));
        };
        memory = new MemorySystem({ adapter, factExtractor: mockExtractor });
        await memory.init();
    });

    afterEach(async () => {
        await memory.close();
        rmSync(tempDir, { recursive: true, force: true });
    });

    it("should recall a manually constructed validity chain in history mode", async () => {
        const dayMs = 24 * 60 * 60 * 1000;
        const now = Date.now();

        // 1. 초기 가치관 (비건)
        await memory.encode(
            { content: "나는 동물권을 존중해서 완벽한 비건이야.", role: "user", timestamp: now - 30 * dayMs },
            { project: "personal", sessionId: "session-1" }
        );
        await memory.consolidateNow(true);

        // 2. 가치관 변화 (페스카테리언)
        // 모순 감지 프롬프트 대신 직접 팩트 체인을 형성하기 위해 
        // 기존 팩트를 찾아서 'superseded' 처리하는 로직을 시뮬레이션하거나
        // MemorySystem의 checkAndReconsolidate가 작동하도록 유도해야 함.
        // 여기서는 간단히 두 번째 팩트가 첫 번째를 supersedes 하도록 adapter에 직접 설정하거나
        // MemorySystem이 모순을 발견하도록 유도함.
        // Heuristic Contradiction Filter는 'not', 'no' 등을 보지만 '생선' vs '비건'은 못 볼 수 있음.
        // 테스트를 위해 직접 chain을 형성함.
        
        const all = await adapter.semantic.getAll();
        const vegan = all.find(f => f.content.includes("비건"))!;
		// This test constructs a historical chain directly. Keep the original
		// createdAt from consolidation, but make the validity interval explicit
		// so the R-Tree receives min_ts <= max_ts.
		vegan.validFrom = now - 30 * dayMs;

        const pescatarian = {
            id: "fact-pesca",
            content: "요즘 건강 때문에 생선은 먹기 시작했어. 페스카테리언이 된 거지.",
            entities: ["생선", "식습관"],
            topics: ["personal"],
            createdAt: now - 15 * dayMs,
            updatedAt: now - 15 * dayMs,
            importance: 0.8,
            maxEmotion: 0.5,
            recallCount: 0,
            lastAccessed: now - 15 * dayMs,
            strength: 0.8,
            status: "active" as const,
            supersedes: vegan.id,
            validFrom: now - 15 * dayMs,
            validTo: null,
            sourceEpisodes: [randomUUID()],
            encodingContext: { project: "personal" }
        };

        // 비건 팩트 업데이트
        vegan.status = "superseded";
        vegan.validTo = now - 15 * dayMs;
        vegan.successorId = pescatarian.id;
        
        await adapter.semantic.upsert(vegan);
        await adapter.semantic.upsert(pescatarian);

        // Verify the manually constructed predecessor interval survived the
        // SQLite write before exercising history retrieval.
        const storedChain = await adapter.semantic.getAll();
        const storedVegan = storedChain.find(f => f.id === vegan.id)!;
        expect(storedVegan.validFrom).toBe(now - 30 * dayMs);
        expect(storedVegan.validTo).toBe(now - 15 * dayMs);

        // 3. 질문 (history 모드)
        const query = "내 식습관의 변화를 알려줘.";
        const result = await memory.recall(query, { project: "personal", mode: "history" });

        expect(result.facts.some(f => f.content.includes("비건"))).toBe(true);
        expect(result.facts.some(f => f.content.includes("페스카테리언"))).toBe(true);
    });

    it("should intervene at the right time (Spike Timing Precision)", async () => {
        const spikeHandler = vi.fn().mockResolvedValue({ action: "acknowledge" });
        memory.on("spike", spikeHandler);

        const now = Date.now();

        // 1. 중요 팩트 저장 (퇴사)
        await memory.encode(
            { content: "오늘 5년 다닌 회사를 드디어 퇴사했어!", role: "user", timestamp: now - 1000 },
            { project: "work" }
        );
        
        // Spike 발사를 위해 Active Context 설정 (topic 매칭 필요)
        memory.setActiveContext({
            topics: ["퇴사", "커리어"],
            recentFactIds: [],
            scope: { project: "work" }
        });

        await memory.consolidateNow(true);

        // 검증: high-importance-relevant spike 발사 확인
        expect(spikeHandler).toHaveBeenCalled();
    });

    it("should support Cross-domain Analogy via Knowledge Graph", async () => {
        const now = Date.now();

        // '서두름'이라는 엔티티가 공통으로 포함됨
        await memory.encode(
            { content: "요리할 때 서두름 금지.", role: "user", timestamp: now - 5000 },
            { project: "hobby" }
        );

        await memory.encode(
            { content: "코딩할 때 너무 서두름.", role: "user", timestamp: now - 1000 },
            { project: "work" }
        );

        await memory.consolidateNow(true);

        // '코딩' 쿼리에서 '서두름' -> '요리'로 spreading activation 발생 기대
        // 꼼수(associate 50회) 제거. 자연스러운 학습 상태 유지.
        const query = "코딩 실수 줄이는 법?"; 
        const result = await memory.recall(query, { project: "work", crossProject: true } as any);

        // 검증: 요리 관련 팩트가 포함되어야 함
        expect(result.facts.some(f => f.content.includes("요리"))).toBe(true);
    });
});
