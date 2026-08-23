import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	MIRACL_EN_QDRANT_DEFAULT_PORT,
	MIRACL_EN_QDRANT_IMAGE,
	createEnglishQdrantLaunchPlan,
	resolveEnglishQdrantLaunchStorage,
} from "./qdrant-service-launch-plan.js";

describe("English Qdrant launch plan", () => {
	it("pins an isolated loopback service and HDD storage", () => {
		const plan = createEnglishQdrantLaunchPlan({
			storagePath: "/var/mnt/hdd/naia-memory/miracl-en-qdrant",
		});
		expect(plan.qdrantUrl).toBe(
			`http://127.0.0.1:${MIRACL_EN_QDRANT_DEFAULT_PORT}`,
		);
		expect(plan.image).toBe(MIRACL_EN_QDRANT_IMAGE);
		expect(plan.podmanArguments).toEqual([
			"run",
			"--detach",
			"--name",
			"naia-memory-qdrant-miracl-en",
			"--publish",
			"127.0.0.1:6344:6333",
			"--volume",
			"/var/mnt/hdd/naia-memory/miracl-en-qdrant:/qdrant/storage:rw",
			MIRACL_EN_QDRANT_IMAGE,
		]);
	});

	it("resolves the live mount path and rejects a symlink outside its root", () => {
		const base = realpathSync(mkdtempSync(join(tmpdir(), "qdrant-plan-")));
		const root = join(base, "hdd");
		const storage = join(root, "storage");
		const outside = join(base, "outside");
		mkdirSync(storage, { recursive: true });
		mkdirSync(outside);
		expect(resolveEnglishQdrantLaunchStorage(storage, root)).toBe(storage);
		const escaped = join(root, "escaped");
		symlinkSync(outside, escaped, "dir");
		expect(() => resolveEnglishQdrantLaunchStorage(escaped, root)).toThrow(
			"inside the allowed root",
		);
	});

	it("rejects shared, unsafe, or mutable launch inputs", () => {
		const storagePath = "/var/mnt/hdd/naia-memory/miracl-en-qdrant";
		expect(() =>
			createEnglishQdrantLaunchPlan({ storagePath, port: "6334" }),
		).toThrow("reserved Arabic port");
		for (const port of ["0", "00", "65536", "1e3", " 6344"]) {
			expect(() =>
				createEnglishQdrantLaunchPlan({ storagePath, port }),
			).toThrow("port is invalid");
		}
		expect(() =>
			createEnglishQdrantLaunchPlan({ storagePath: "/var/home/luke/en" }),
		).toThrow("allowed root");
		expect(() =>
			createEnglishQdrantLaunchPlan({
				storagePath,
				image: "docker.io/qdrant/qdrant:latest",
			}),
		).toThrow("immutable official digest");
	});
});
