import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Fact, MemoryAdapter } from "../../memory/types.js";
import {
	NaiaLifecycleBridge,
	createNaiaLifecycleBridge,
} from "./bridge-naia-lifecycle.js";

describe("Naia lifecycle bridge", () => {
	it("uses one structured property across predecessor and successor versions", async () => {
		const facts: Fact[] = [];
		const adapter = {
			semantic: {
				async upsert(fact: Fact) {
					const index = facts.findIndex((existing) => existing.id === fact.id);
					if (index >= 0) {
						facts[index] = fact;
						return;
					}
					facts.push(fact);
				},
				async delete(id: string) {
					const index = facts.findIndex((fact) => fact.id === id);
					if (index < 0) return false;
					facts.splice(index, 1);
					return true;
				},
				async getAll() {
					return facts;
				},
			},
		} as unknown as MemoryAdapter;
		const close = vi.fn(async () => {});
		const bridge = new NaiaLifecycleBridge(adapter, close);
		await bridge.apply({
			op: "add",
			logicalId: "v1",
			content: "서울",
			at: "2026-01-01T00:00:01Z",
		});
		await bridge.apply({
			op: "replace",
			logicalId: "v2",
			replacesLogicalId: "v1",
			content: "부산",
			at: "2026-01-01T00:00:02Z",
		});
		expect(await bridge.getActiveState()).toEqual([
			{ logicalId: "v2", content: "부산" },
		]);
		expect(facts[0]?.structured?.propertyId).toBe(
			facts[1]?.structured?.propertyId,
		);
		expect(facts.find((fact) => fact.id === "v1")).toMatchObject({
			status: "superseded",
			successorId: "v2",
			validTo: Date.parse("2026-01-01T00:00:02Z"),
		});
		expect(facts.find((fact) => fact.id === "v2")).toMatchObject({
			status: "active",
			supersedes: "v1",
		});
		await bridge.close();
		expect(close).toHaveBeenCalledOnce();
	});

	it("executes replacement and deletion against the real LocalAdapter", async () => {
		const directory = await mkdtemp(join(tmpdir(), "naia-lifecycle-"));
		const storePath = join(directory, "memory.json");
		const bridge = await createNaiaLifecycleBridge({ storePath });
		try {
			await bridge.apply({
				op: "add",
				logicalId: "v1",
				content: "서울",
				at: "2026-01-01T00:00:01Z",
			});
			await bridge.apply({
				op: "add",
				logicalId: "keep",
				content: "파란색",
				at: "2026-01-01T00:00:02Z",
			});
			await bridge.apply({
				op: "replace",
				logicalId: "v2",
				replacesLogicalId: "v1",
				content: "부산",
				at: "2026-01-01T00:00:03Z",
			});
			await bridge.apply({
				op: "delete",
				logicalId: "keep",
				at: "2026-01-01T00:00:04Z",
			});
			expect(await bridge.getActiveState()).toEqual([
				{ logicalId: "v2", content: "부산" },
			]);
		} finally {
			await bridge.close();
			await rm(directory, { recursive: true, force: true });
		}
	});
});
