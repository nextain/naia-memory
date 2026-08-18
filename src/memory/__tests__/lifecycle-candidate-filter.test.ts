import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalAdapter } from "../adapters/local.js";
import type { Fact } from "../types.js";

function fact(content: string, status: Fact["status"]): Fact {
	const now = Date.now();
	return {
		id: randomUUID(),
		content,
		entities: [],
		topics: [],
		createdAt: now,
		updatedAt: now,
		importance: 0.5,
		recallCount: 0,
		lastAccessed: now,
		strength: 0.5,
		status,
		sourceEpisodes: [],
	};
}

describe("latest lifecycle filtering", () => {
	it("does not let superseded rows exhaust the pre-truncation candidate pool", async () => {
		const storePath = join(mkdtempSync(join(tmpdir(), "lifecycle-candidates-")), "store.json");
		const adapter = new LocalAdapter({ storePath });
		for (let index = 0; index < 6; index++) {
			await adapter.semantic.upsert(fact("shared retrieval phrase", "superseded"));
		}
		const active = fact("shared retrieval phrase", "active");
		await adapter.semantic.upsert(active);

		const latest = await adapter.semantic.search("shared retrieval phrase", 1);
		expect(latest.map((item) => item.id)).toEqual([active.id]);
	});

	it("does not let a matching topic override an explicit project in strict history mode", async () => {
		const storePath = join(mkdtempSync(join(tmpdir(), "history-project-scope-")), "store.json");
		const adapter = new LocalAdapter({ storePath });
		const allowed = fact("shared retrieval phrase", "active");
		allowed.encodingContext = { project: "profile" };
		const foreignOld = fact("shared retrieval phrase old", "superseded");
		foreignOld.encodingContext = { project: "foreign" };
		foreignOld.topics = ["profile"];
		const foreignNew = fact("shared retrieval phrase", "active");
		foreignNew.encodingContext = { project: "foreign" };
		foreignNew.topics = ["profile"];
		foreignOld.successorId = foreignNew.id;
		foreignNew.supersedes = foreignOld.id;

		for (const item of [allowed, foreignOld, foreignNew]) await adapter.semantic.upsert(item);

		const history = await adapter.semantic.search("shared retrieval phrase", 5, false, {
			project: "profile",
			scopeMode: "strict",
			mode: "history",
		});
		expect(history.map((item) => item.id)).toEqual([allowed.id]);
	});

	it("does not admit a project-less legacy row through a matching topic in strict mode", async () => {
		const storePath = join(mkdtempSync(join(tmpdir(), "strict-unscoped-")), "store.json");
		const adapter = new LocalAdapter({ storePath });
		const legacy = fact("shared retrieval phrase", "active");
		legacy.topics = ["profile"];
		await adapter.semantic.upsert(legacy);

		const result = await adapter.semantic.search("shared retrieval phrase", 5, false, {
			project: "profile",
			scopeMode: "strict",
		});
		expect(result).toEqual([]);
	});

	it("does not follow history links from an allowed anchor into a foreign project", async () => {
		const storePath = join(mkdtempSync(join(tmpdir(), "history-chain-scope-")), "store.json");
		const adapter = new LocalAdapter({ storePath });
		const foreignOld = fact("shared retrieval phrase old", "superseded");
		foreignOld.encodingContext = { project: "foreign" };
		const allowedNew = fact("shared retrieval phrase", "active");
		allowedNew.encodingContext = { project: "profile" };
		foreignOld.successorId = allowedNew.id;
		allowedNew.supersedes = foreignOld.id;

		for (const item of [foreignOld, allowedNew]) await adapter.semantic.upsert(item);

		const history = await adapter.semantic.search("shared retrieval phrase", 5, false, {
			project: "profile",
			scopeMode: "strict",
			mode: "history",
		});
		expect(history.map((item) => item.id)).toEqual([allowedNew.id]);
	});

	it("uses subject and property identity without receiving the answer value", async () => {
		const storePath = join(mkdtempSync(join(tmpdir(), "structured-query-")), "store.json");
		const adapter = new LocalAdapter({ storePath });
		const target = fact("shared retrieval phrase target value", "active");
		target.structured = {
			subject: "user",
			property: "preferred editor",
			value: "target value",
			polarity: "affirmed",
			cardinality: "single",
		};
		const distractor = fact("shared retrieval phrase distractor value", "active");
		distractor.structured = {
			subject: "colleague",
			property: "preferred editor",
			value: "distractor value",
			polarity: "affirmed",
			cardinality: "single",
		};
		for (const item of [distractor, target]) await adapter.semantic.upsert(item);

		const result = await adapter.semantic.search("shared retrieval phrase", 1, false, {
			structuredQuery: { subject: "user", property: "preferred editor" },
		});

		expect(result.map((item) => item.id)).toEqual([target.id]);
	});

	it("uses caller-owned opaque identity across query and fact languages", async () => {
		const storePath = join(mkdtempSync(join(tmpdir(), "structured-query-id-")), "store.json");
		const adapter = new LocalAdapter({ storePath });
		const target = fact("shared retrieval phrase 사용자 거주지 부산", "active");
		target.structured = {
			subject: "사용자", subjectId: "person:self",
			property: "거주지", propertyId: "profile:residence",
			value: "부산", polarity: "affirmed", cardinality: "single",
		};
		const distractor = fact("shared retrieval phrase User residence Seoul", "active");
		distractor.structured = {
			subject: "user", subjectId: "person:other",
			property: "residence", propertyId: "profile:residence",
			value: "Seoul", polarity: "affirmed", cardinality: "single",
		};
		for (const item of [distractor, target]) await adapter.semantic.upsert(item);

		const result = await adapter.semantic.search("shared retrieval phrase", 1, false, {
			structuredQuery: {
				subject: "I", subjectId: "person:self",
				property: "live", propertyId: "profile:residence",
			},
		});

		expect(result.map((item) => item.id)).toEqual([target.id]);
	});
});
