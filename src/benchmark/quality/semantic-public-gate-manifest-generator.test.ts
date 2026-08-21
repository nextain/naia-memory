import {
	mkdtemp,
	readFile,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateSemanticPublicGateManifest } from "./semantic-public-gate-manifest-generator.js";
import { SEMANTIC_PUBLIC_GATE_ARTIFACT_NAMES } from "./semantic-public-gate-manifest.js";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

async function fixture() {
	const directory = await mkdtemp(
		join(tmpdir(), "naia-public-gate-generator-"),
	);
	roots.push(directory);
	const artifacts: Record<string, string> = {};
	for (const name of SEMANTIC_PUBLIC_GATE_ARTIFACT_NAMES) {
		const path = `${name}.json`;
		await writeFile(join(directory, path), `${JSON.stringify({ name })}\n`);
		artifacts[name] = path;
	}
	const draft = {
		schemaVersion: "naia-memory-semantic-public-gate-manifest-draft-v1",
		blindingSeed: "held-secret-seed",
		artifacts,
	};
	const draftPath = join(directory, "manifest-draft.json");
	await writeFile(draftPath, JSON.stringify(draft));
	return { artifacts, directory, draft, draftPath };
}

describe("semantic public gate manifest generator", () => {
	it("writes deterministic hash-pinned bytes and does not disclose the seed", async () => {
		const first = await fixture();
		const firstPath = join(first.directory, "manifest-a.json");
		const firstResult = await generateSemanticPublicGateManifest(
			first.draftPath,
			firstPath,
		);
		const firstBytes = await readFile(firstPath);

		const secondPath = join(first.directory, "manifest-b.json");
		const secondResult = await generateSemanticPublicGateManifest(
			first.draftPath,
			secondPath,
		);
		expect(await readFile(secondPath)).toEqual(firstBytes);
		expect(secondResult.sha256).toBe(firstResult.sha256);
		expect(firstResult).not.toHaveProperty("blindingSeed");
		await expect(
			stat(firstPath).then((value) => value.mode & 0o777),
		).resolves.toBe(0o600);
	});

	it("pins source mutations and preserves an existing output", async () => {
		const current = await fixture();
		const beforePath = join(current.directory, "before.json");
		await generateSemanticPublicGateManifest(current.draftPath, beforePath);
		await writeFile(
			join(current.directory, current.artifacts.contract as string),
			'{"changed":true}\n',
		);
		const afterPath = join(current.directory, "after.json");
		await generateSemanticPublicGateManifest(current.draftPath, afterPath);
		const before = JSON.parse(await readFile(beforePath, "utf8"));
		const after = JSON.parse(await readFile(afterPath, "utf8"));
		expect(after.artifacts.contract.sha256).not.toBe(
			before.artifacts.contract.sha256,
		);

		const occupiedPath = join(current.directory, "occupied.json");
		await writeFile(occupiedPath, "preserve-me");
		await expect(
			generateSemanticPublicGateManifest(current.draftPath, occupiedPath),
		).rejects.toThrow();
		expect(await readFile(occupiedPath, "utf8")).toBe("preserve-me");
	});

	it("rejects unknown keys, escapes, and final or intermediate symlinks", async () => {
		const unknown = await fixture();
		await writeFile(
			unknown.draftPath,
			JSON.stringify({ ...unknown.draft, unexpected: true }),
		);
		await expect(
			generateSemanticPublicGateManifest(
				unknown.draftPath,
				join(unknown.directory, "unknown.json"),
			),
		).rejects.toThrow("fields are invalid");

		const escaped = await fixture();
		escaped.draft.artifacts.contract = "../contract.json";
		await writeFile(escaped.draftPath, JSON.stringify(escaped.draft));
		await expect(
			generateSemanticPublicGateManifest(
				escaped.draftPath,
				join(escaped.directory, "escaped.json"),
			),
		).rejects.toThrow("escapes draft directory");

		const linked = await fixture();
		const outside = await mkdtemp(
			join(tmpdir(), "naia-public-gate-generator-outside-"),
		);
		roots.push(outside);
		await writeFile(join(outside, "contract.json"), "{}\n");
		await symlink(outside, join(linked.directory, "outside"));
		linked.draft.artifacts.contract = "outside/contract.json";
		await writeFile(linked.draftPath, JSON.stringify(linked.draft));
		await expect(
			generateSemanticPublicGateManifest(
				linked.draftPath,
				join(linked.directory, "linked.json"),
			),
		).rejects.toThrow("through a symbolic link");

		const finalLink = await fixture();
		await symlink(
			join(finalLink.directory, "contract.json"),
			join(finalLink.directory, "contract-link.json"),
		);
		finalLink.draft.artifacts.contract = "contract-link.json";
		await writeFile(finalLink.draftPath, JSON.stringify(finalLink.draft));
		await expect(
			generateSemanticPublicGateManifest(
				finalLink.draftPath,
				join(finalLink.directory, "final-link.json"),
			),
		).rejects.toThrow("unreadable");
	});

	it("rejects oversized sources and output outside the campaign directory", async () => {
		const current = await fixture();
		await writeFile(
			join(current.directory, "contract.json"),
			Buffer.alloc(16 * 1024 * 1024 + 1),
		);
		await expect(
			generateSemanticPublicGateManifest(
				current.draftPath,
				join(current.directory, "large.json"),
			),
		).rejects.toThrow("exceeds the 16 MiB");
		await expect(
			generateSemanticPublicGateManifest(
				current.draftPath,
				join(tmpdir(), "outside-manifest.json"),
			),
		).rejects.toThrow("new file in the draft directory");
	});
});
