// #25 보존 우선 회귀 — LocalAdapter.decay()/delete() 가 데이터를 *삭제하지 않고 보존*(status='archived')함을
// **어댑터 레벨 store 상태**로 핀한다. 적대검증(2026-06-21): 보존이 코드리딩으로만 보장돼, 미래 리팩터가
// hard-delete/splice 를 재도입해도 기존 suite(decay.test.ts=순수함수)가 못 잡던 갭을 닫는다.
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalAdapter } from "../adapters/local.js";
import type { Fact } from "../index.js";

function makeFact(content: string): Fact {
	return {
		id: randomUUID(), content, entities: ["test"], topics: ["testing"],
		createdAt: Date.now(), updatedAt: Date.now(), importance: 0.8,
		recallCount: 0, lastAccessed: Date.now(), strength: 0.8, status: "active", sourceEpisodes: [],
	};
}
function tmpAdapter(): LocalAdapter {
	return new LocalAdapter(join(tmpdir(), `naia-mem-preserve-${randomUUID()}.json`));
}

describe("LocalAdapter 보존 우선 회귀 (#25)", () => {
	it("decay() 는 strength 가 0 에 수렴해도 fact 를 store 에서 삭제하지 않는다(보존)", async () => {
		const a = tmpAdapter();
		const f = makeFact("Luke prefers dark mode");
		await a.semantic.upsert(f);
		// 먼 미래로 decay — strength 가 prune 임계 아래로 떨어져도 splice/삭제 X(보존 우선).
		await a.semantic.decay(Date.now() + 1000 * 60 * 60 * 24 * 3650); // +10년
		const kept = (await a.semantic.getAll()).find((x) => x.id === f.id);
		expect(kept).toBeDefined();                          // 삭제 안 됨(보존)
		expect(kept!.content).toBe("Luke prefers dark mode"); // 내용 온전
	});

	it("delete() 는 hard-delete 가 아니라 archive(데이터 보존)", async () => {
		const a = tmpAdapter();
		const f = makeFact("Order #A-7421 belongs to Jane");
		await a.semantic.upsert(f);
		await a.semantic.delete(f.id);
		const kept = (await a.semantic.getAll()).find((x) => x.id === f.id);
		expect(kept).toBeDefined();            // store 에서 제거 안 됨
		expect(kept!.status).toBe("archived"); // archive 로 redirect(데이터 파괴 X)
	});
});
