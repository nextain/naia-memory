import { describe, expect, it } from "vitest";
import {
	NATIVE_CORPUS_CONTENT_HASH_ALGORITHM,
	NativeCorpusContentHasher,
	hashNativeCorpusDocumentContents,
} from "./native-corpus-content-hash.js";

describe("native corpus content hash", () => {
	const document = { docid: "doc-1", title: "제목", text: "본문" };

	it("pins the versioned algorithm and a known-answer vector", () => {
		expect(NATIVE_CORPUS_CONTENT_HASH_ALGORITHM).toBe(
			"sha256-domain-v1-u64be-utf16be",
		);
		expect(hashNativeCorpusDocumentContents([document])).toBe(
			"ee0b106b73ed02d85a7133e3a38c7b4266f4c7f2be64679b9d1f9e0e79b80d36",
		);
	});

	it("is deterministic for identical parsed corpus content", () => {
		expect(hashNativeCorpusDocumentContents([document])).toBe(
			hashNativeCorpusDocumentContents([{ ...document }]),
		);
	});

	it.each(["docid", "title", "text"] as const)(
		"binds the %s field",
		(field) => {
			expect(
				hashNativeCorpusDocumentContents([
					{ ...document, [field]: `${document[field]}-changed` },
				]),
			).not.toBe(hashNativeCorpusDocumentContents([document]));
		},
	);

	it("binds document order and boundaries", () => {
		const second = { docid: "doc-2", title: "ab", text: "c" };
		expect(hashNativeCorpusDocumentContents([document, second])).not.toBe(
			hashNativeCorpusDocumentContents([second, document]),
		);
		expect(
			hashNativeCorpusDocumentContents([
				{ docid: "doc-2", title: "a", text: "bc" },
			]),
		).not.toBe(hashNativeCorpusDocumentContents([second]));
	});

	it("distinguishes an empty corpus from empty document fields", () => {
		expect(hashNativeCorpusDocumentContents([])).not.toBe(
			hashNativeCorpusDocumentContents([{ docid: "", title: "", text: "" }]),
		);
	});

	it("preserves lone surrogates and Unicode normalization forms exactly", () => {
		const digest = (text: string) =>
			hashNativeCorpusDocumentContents([{ docid: "id", title: "", text }]);
		expect(digest("\ud800")).not.toBe(digest("�"));
		expect(digest("é")).not.toBe(digest("e\u0301"));
	});

	it("produces the same digest incrementally without retaining the corpus", () => {
		const documents = [
			document,
			{ docid: "doc-2", title: "두 번째", text: "내용" },
		];
		const hasher = new NativeCorpusContentHasher();
		for (const row of documents) hasher.update(row);
		expect(hasher.digest()).toBe(hashNativeCorpusDocumentContents(documents));
	});

	it("returns a stable digest and fails closed against updates after finalization", () => {
		const hasher = new NativeCorpusContentHasher();
		hasher.update(document);
		const digest = hasher.digest();
		expect(hasher.digest()).toBe(digest);
		expect(() => hasher.update(document)).toThrow("finalized");
	});
});
