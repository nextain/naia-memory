import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
	canonicalNativeCorpusJsonl,
	extractNativeCorpusDocuments,
	scanNativeCorpusDocuments,
} from "./native-corpus-extract.js";

describe("native MIRACL corpus extraction", () => {
	it("extracts exactly the locked IDs in canonical order", async () => {
		const directory = await mkdtemp(join(tmpdir(), "naia-native-corpus-"));
		const shard = join(directory, "docs.jsonl.gz");
		await writeFile(
			shard,
			gzipSync(
				[
					JSON.stringify({ docid: "b", title: "B", text: "두 번째" }),
					JSON.stringify({ docid: "a", title: "A", text: "첫 번째" }),
					JSON.stringify({ docid: "c", title: "C", text: "제외" }),
				].join("\n"),
			),
		);
		const result = await extractNativeCorpusDocuments(
			[shard],
			new Set(["a", "b"]),
		);
		expect(result.map(({ docid }) => docid)).toEqual(["a", "b"]);
		expect(canonicalNativeCorpusJsonl(result)).toBe(
			'{"docid":"a","title":"A","text":"첫 번째"}\n{"docid":"b","title":"B","text":"두 번째"}\n',
		);
	});

	it("fails closed when a required ID is absent", async () => {
		const directory = await mkdtemp(join(tmpdir(), "naia-native-corpus-"));
		const shard = join(directory, "docs.jsonl.gz");
		await writeFile(
			shard,
			gzipSync(JSON.stringify({ docid: "a", title: "A", text: "text" })),
		);
		await expect(
			extractNativeCorpusDocuments([shard], new Set(["missing"])),
		).rejects.toThrow("missing 1 required documents");
	});

	it("preserves Korean UTF-8 across decompression chunk boundaries", async () => {
		const directory = await mkdtemp(join(tmpdir(), "naia-native-corpus-"));
		const shard = join(directory, "docs.jsonl.gz");
		const text = `경계-${"가나다라마바사".repeat(20_000)}-끝`;
		await writeFile(
			shard,
			gzipSync(JSON.stringify({ docid: "ko", title: "한글", text })),
		);
		const [result] = await extractNativeCorpusDocuments(
			[shard],
			new Set(["ko"]),
		);
		expect(result?.text).toBe(text);
	});

	it("streams the complete corpus with stable ordinals and backpressure", async () => {
		const directory = await mkdtemp(join(tmpdir(), "naia-native-corpus-"));
		const shard = join(directory, "docs.jsonl.gz");
		await writeFile(
			shard,
			gzipSync(
				[
					JSON.stringify({ docid: "a", title: "A", text: "첫 번째" }),
					JSON.stringify({ docid: "b", title: "B", text: "두 번째" }),
				].join("\n"),
			),
		);
		const observed: string[] = [];
		let callbackActive = false;
		const receipt = await scanNativeCorpusDocuments(
			[shard],
			async (document, ordinal) => {
				expect(callbackActive).toBe(false);
				callbackActive = true;
				await Promise.resolve();
				observed.push(`${ordinal}:${document.docid}`);
				callbackActive = false;
			},
		);
		expect(observed).toEqual(["0:a", "1:b"]);
		expect(receipt).toEqual({
			documentCount: 2,
			docidsSha256:
				"911169ddaaf146aff539f58c26c489af3b892dff0fe283c1c264c65ae5aa59a2",
		});
	});

	it("fails closed on duplicate IDs during a full scan", async () => {
		const directory = await mkdtemp(join(tmpdir(), "naia-native-corpus-"));
		const shard = join(directory, "docs.jsonl.gz");
		await writeFile(
			shard,
			gzipSync(
				[
					JSON.stringify({ docid: "same", title: "A", text: "one" }),
					JSON.stringify({ docid: "same", title: "B", text: "two" }),
				].join("\n"),
			),
		);
		let consumed = 0;
		await expect(
			scanNativeCorpusDocuments([shard], () => consumed++, {
				duplicateWorkDirectory: directory,
			}),
		).rejects.toThrow("duplicate corpus document: same");
		expect(consumed).toBe(1);
		expect(
			(await readdir(directory)).filter((name) =>
				name.startsWith("naia-corpus-docids-"),
			),
		).toEqual([]);
	});

	it("detects a non-adjacent duplicate before consuming that row", async () => {
		const directory = await mkdtemp(join(tmpdir(), "naia-native-corpus-"));
		const shard = join(directory, "docs.jsonl.gz");
		await writeFile(
			shard,
			gzipSync(
				[
					JSON.stringify({ docid: "repeat", title: "A", text: "one" }),
					JSON.stringify({ docid: "between", title: "B", text: "two" }),
					JSON.stringify({ docid: "repeat", title: "C", text: "three" }),
				].join("\n"),
			),
		);
		const consumed: string[] = [];
		await expect(
			scanNativeCorpusDocuments(
				[shard],
				(document) => consumed.push(document.docid),
				{ duplicateWorkDirectory: directory },
			),
		).rejects.toThrow("duplicate corpus document: repeat");
		expect(consumed).toEqual(["repeat", "between"]);
	});

	it("detects a duplicate carried across corpus shards", async () => {
		const directory = await mkdtemp(join(tmpdir(), "naia-native-corpus-"));
		const first = join(directory, "docs-0.jsonl.gz");
		const second = join(directory, "docs-1.jsonl.gz");
		await writeFile(
			first,
			gzipSync(JSON.stringify({ docid: "shared", title: "A", text: "one" })),
		);
		await writeFile(
			second,
			gzipSync(JSON.stringify({ docid: "shared", title: "B", text: "two" })),
		);
		let consumed = 0;
		await expect(
			scanNativeCorpusDocuments([first, second], () => consumed++, {
				duplicateWorkDirectory: directory,
			}),
		).rejects.toThrow("duplicate corpus document: shared");
		expect(consumed).toBe(1);
	});
});
