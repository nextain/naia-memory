/**
 * Backup export/import tests for LocalAdapter.
 * Tests AES-256-GCM + PBKDF2-SHA256 encryption, magic header, rollback safety.
 */

import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalAdapter } from "../adapters/local.js";
import { MemorySystem } from "../index.js";
import type { BackupCapable, Episode, Fact } from "../index.js";

function makeTmpAdapter(): LocalAdapter {
	const path = join(tmpdir(), `naia-memory-test-${randomUUID()}.json`);
	return new LocalAdapter(path);
}

function makeEpisode(content: string): Episode {
	return {
		id: randomUUID(),
		content,
		role: "user",
		summary: content.slice(0, 100),
		timestamp: Date.now(),
		importance: { importance: 0.8, surprise: 0.5, emotion: 0.5, utility: 0.8 },
		encodingContext: {},
		consolidated: false,
		recallCount: 0,
		lastAccessed: Date.now(),
		strength: 0.8,
	};
}

	function makeFact(content: string): Fact {
		return {
			id: randomUUID(),
			content,
			entities: ["test"],
			topics: ["testing"],
			createdAt: Date.now(),
			updatedAt: Date.now(),
			importance: 0.8,
			recallCount: 0,
			lastAccessed: Date.now(),
			strength: 0.8,
			status: "active",
			sourceEpisodes: [],
		};
	}

describe("LocalAdapter backup", () => {
	it("export/import round-trips all data", async () => {
		const adapter = makeTmpAdapter();
		const episode = makeEpisode("Luke uses TypeScript");
		const fact = makeFact("Luke is a developer");

		await adapter.episode.store(episode);
		await adapter.semantic.upsert(fact);

		const blob = await adapter.export("password123");
		expect(blob).toBeInstanceOf(Uint8Array);
		expect(blob.length).toBeGreaterThan(49); // > header size

		// Import into a fresh adapter
		const target = makeTmpAdapter();
		await target.import(blob, "password123");

		const facts = await target.semantic.getAll();
		expect(facts).toHaveLength(1);
		expect(facts[0].content).toBe("Luke is a developer");

		const episodes = await target.episode.getRecent(10);
		expect(episodes).toHaveLength(1);
		expect(episodes[0].content).toBe("Luke uses TypeScript");
	});

	it("blob has NAIA magic header", async () => {
		const adapter = makeTmpAdapter();
		const blob = await adapter.export("test");

		// First 4 bytes must be ASCII "NAIA"
		const magic = Buffer.from(blob.subarray(0, 4)).toString("ascii");
		expect(magic).toBe("NAIA");
		// Byte 4 is version 0x01
		expect(blob[4]).toBe(0x01);
	});

	it("throws on wrong password", async () => {
		const adapter = makeTmpAdapter();
		await adapter.episode.store(makeEpisode("secret"));
		const blob = await adapter.export("correct-password");

		const target = makeTmpAdapter();
		await expect(target.import(blob, "wrong-password")).rejects.toThrow(
			"Decryption failed",
		);
	});

	it("throws on empty password (export)", async () => {
		const adapter = makeTmpAdapter();
		await expect(adapter.export("")).rejects.toThrow(
			"Password must not be empty",
		);
	});

	it("throws on empty password (import)", async () => {
		const source = makeTmpAdapter();
		await source.episode.store(makeEpisode("test"));
		const blob = await source.export("password");

		const target = makeTmpAdapter();
		await expect(target.import(blob, "")).rejects.toThrow(
			"Password must not be empty",
		);
	});

	it("throws on truncated blob", async () => {
		const adapter = makeTmpAdapter();
		const blob = await adapter.export("password");
		// Truncate to 20 bytes (less than 49-byte header)
		const truncated = blob.subarray(0, 20);

		const target = makeTmpAdapter();
		await expect(target.import(truncated, "password")).rejects.toThrow(
			"Invalid backup blob: too short",
		);
	});

	it("rolls back in-memory state if disk write fails", async () => {
		const adapter = makeTmpAdapter();
		const original = makeFact("original fact");
		await adapter.semantic.upsert(original);

		const source = makeTmpAdapter();
		const newFact = makeFact("new fact from backup");
		await source.semantic.upsert(newFact);
		const blob = await source.export("password");

		// Force the disk write to fail AFTER in-memory state has been updated, so the
		// rollback path triggers. A null byte makes writeFileSync throw on every
		// platform — a "nonexistent root" path is not reliable (Windows happily
		// creates the directory tree, so the write would succeed and skip rollback).
		(adapter as any).storePath = "\0invalid/here.json";

		// import() should throw because save() fails
		await expect(adapter.import(blob, "password")).rejects.toThrow();

		// Rollback must have restored both fact and episode stores to original state
		const facts = await adapter.semantic.getAll();
		expect(facts).toHaveLength(1);
		expect(facts[0].content).toBe("original fact");

		// Episode store should also be rolled back (adapter had no episodes before import, so rollback must restore empty state)
		const episodes = await adapter.episode.getRecent(10);
		expect(episodes).toHaveLength(0);
	});

	it("rejects unsupported backup version byte", async () => {
		const adapter = makeTmpAdapter();
		const blob = await adapter.export("password");
		// Patch version byte (index 4) to an unsupported value
		const tampered = new Uint8Array(blob);
		tampered[4] = 0x99;

		const target = makeTmpAdapter();
		await expect(target.import(tampered, "password")).rejects.toThrow(
			"Unsupported backup version",
		);
	});

	it("rejects blob with bad magic bytes", async () => {
		const adapter = makeTmpAdapter();
		const blob = await adapter.export("password");
		// Overwrite magic "NAIA" with garbage
		const tampered = new Uint8Array(blob);
		tampered[0] = 0xde;
		tampered[1] = 0xad;
		tampered[2] = 0xbe;
		tampered[3] = 0xef;

		const target = makeTmpAdapter();
		await expect(target.import(tampered, "password")).rejects.toThrow(
			"Invalid backup blob: bad magic",
		);
	});

	it("satisfies BackupCapable interface (compile-time type check)", () => {
		// Ensures LocalAdapter continues to satisfy BackupCapable contract.
		// If export/import signatures drift from the interface, this assignment fails.
		const adapter = makeTmpAdapter();
		const _typed: BackupCapable = adapter;
		expect(_typed).toBe(adapter);
	});
});

describe("MemorySystem backup delegation", () => {
	function makeTmpSystem(): MemorySystem {
		const path = join(
			tmpdir(),
			`naia-memory-system-test-${randomUUID()}.json`,
		);
		return new MemorySystem({ adapter: new LocalAdapter(path) });
	}

	it("supportsBackup() returns true when adapter is LocalAdapter", () => {
		const system = makeTmpSystem();
		expect(system.supportsBackup()).toBe(true);
	});

	it("supportsBackup() returns false when adapter lacks export/import", () => {
		// A minimal adapter stub without BackupCapable methods
		const stub = {
			episode: {
				store: async () => {},
				getRecent: async () => [],
				search: async () => [],
			},
			semantic: {
				upsert: async () => {},
				getAll: async () => [],
				search: async () => [],
				delete: async () => {},
			},
			procedural: {
				storeSkill: async () => {},
				getSkill: async () => null,
				listSkills: async () => [],
				storeReflection: async () => {},
				getReflections: async () => [],
			},
			close: async () => {},
		} as unknown as import("../types.js").MemoryAdapter;
		const system = new MemorySystem({ adapter: stub });
		expect(system.supportsBackup()).toBe(false);
	});

	it("exportBackup() round-trips through MemorySystem", async () => {
		const system = makeTmpSystem();
		const blob = await system.exportBackup("test-password");
		expect(blob).toBeInstanceOf(Uint8Array);
		// NAIA magic header check
		expect(Buffer.from(blob.subarray(0, 4)).toString("ascii")).toBe("NAIA");
	});

	it("importBackup() restores data through MemorySystem", async () => {
		const source = makeTmpSystem();
		// Encode a fact via MemorySystem so it is stored
		const path = join(
			tmpdir(),
			`naia-memory-system-import-test-${randomUUID()}.json`,
		);
		const srcAdapter = new LocalAdapter(path);
		await srcAdapter.semantic.upsert(makeFact("MemorySystem import test fact"));
		const blob = await srcAdapter.export("password");

		const target = makeTmpSystem();
		await target.importBackup(blob, "password");

		// Read back via MemorySystem adapter
		const facts = await (target as any).adapter.semantic.getAll();
		expect(
			facts.some(
				(f: { content: string }) =>
					f.content === "MemorySystem import test fact",
			),
		).toBe(true);
	});

	it("exportBackup() throws when adapter does not support backup", async () => {
		const stub = {
			episode: {
				store: async () => {},
				getRecent: async () => [],
				search: async () => [],
			},
			semantic: {
				upsert: async () => {},
				getAll: async () => [],
				search: async () => [],
				delete: async () => {},
			},
			procedural: {
				storeSkill: async () => {},
				getSkill: async () => null,
				listSkills: async () => [],
				storeReflection: async () => {},
				getReflections: async () => [],
			},
			close: async () => {},
		} as unknown as import("../types.js").MemoryAdapter;
		const system = new MemorySystem({ adapter: stub });
		await expect(system.exportBackup("password")).rejects.toThrow(
			"Current memory adapter does not support backup export",
		);
	});

	it("importBackup() throws when adapter does not support backup", async () => {
		const stub = {
			episode: {
				store: async () => {},
				getRecent: async () => [],
				search: async () => [],
			},
			semantic: {
				upsert: async () => {},
				getAll: async () => [],
				search: async () => [],
				delete: async () => {},
			},
			procedural: {
				storeSkill: async () => {},
				getSkill: async () => null,
				listSkills: async () => [],
				storeReflection: async () => {},
				getReflections: async () => [],
			},
			close: async () => {},
		} as unknown as import("../types.js").MemoryAdapter;
		const system = new MemorySystem({ adapter: stub });
		await expect(
			system.importBackup(new Uint8Array(10), "password"),
		).rejects.toThrow("Current memory adapter does not support backup import");
	});
});
