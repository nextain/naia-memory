import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
	canonicalNativeCorpusJsonl,
	extractNativeCorpusDocuments,
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
});
