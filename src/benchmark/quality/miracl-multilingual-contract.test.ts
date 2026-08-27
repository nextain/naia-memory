import { describe, expect, it } from "vitest";
import {
	MIRACL_MULTILINGUAL_CONTRACT,
	canonicalMiraclCorpusManifest,
	collectHuggingFaceTreePages,
	miraclExecutionNamespace,
	parseHuggingFaceCorpusTree,
	resolveMiraclLanguageSelection,
	verifyMiraclCorpusManifest,
} from "./miracl-multilingual-contract.js";

describe("MIRACL multilingual evidence contract", () => {
	it("separates the Korean anchor from English and Arabic transfer runs", () => {
		expect(Object.keys(MIRACL_MULTILINGUAL_CONTRACT)).toEqual([
			"ko",
			"en",
			"ar",
		]);
		expect(MIRACL_MULTILINGUAL_CONTRACT.ko.role).toBe("anchor");
		expect(MIRACL_MULTILINGUAL_CONTRACT.en.role).toBe("transfer");
		expect(MIRACL_MULTILINGUAL_CONTRACT.ar.role).toBe("transfer");
	});

	it("canonicalizes corpus manifests independent of API ordering", () => {
		const left = { path: "x/docs-1.jsonl.gz", size: 2, sha256: "b".repeat(64) };
		const right = {
			path: "x/docs-0.jsonl.gz",
			size: 1,
			sha256: "a".repeat(64),
		};
		expect(canonicalMiraclCorpusManifest([left, right])).toBe(
			canonicalMiraclCorpusManifest([right, left]),
		);
	});

	it("fails closed before accepting an incomplete or substituted manifest", () => {
		expect(() => verifyMiraclCorpusManifest("en", [])).toThrow(
			"shard count mismatch",
		);
		const substituted = Array.from({ length: 66 }, (_, index) => ({
			path: `miracl-corpus-v1.0-en/docs-${index}.jsonl.gz`,
			size: index + 1,
			sha256: "a".repeat(64),
		}));
		expect(() => verifyMiraclCorpusManifest("en", substituted)).toThrow(
			"manifest digest mismatch",
		);
	});

	it("rejects a full-size manifest with invalid shard identity shape", () => {
		const malformed = Array.from({ length: 5 }, (_, index) => ({
			path: `substituted/docs-${index}.jsonl.gz`,
			size: index + 1,
			sha256: "a".repeat(64),
		}));
		expect(() => verifyMiraclCorpusManifest("ar", malformed)).toThrow(
			"manifest shape mismatch",
		);
	});

	it("accepts and code-point sorts the pinned Korean provider manifest", () => {
		const rows = [
			{
				path: "miracl-corpus-v1.0-ko/docs-2.jsonl.gz",
				size: 62_582_229,
				lfs: {
					oid: "93e90d098d78f50a9e76dd2e64608d65e0563787954f848da9b04286f81b75d9",
				},
			},
			{
				path: "miracl-corpus-v1.0-ko/docs-0.jsonl.gz",
				size: 87_965_596,
				lfs: {
					oid: "c56a31883a291504aa9c97968fb7a5fbcc9ea1099ee1810200249e1afb7fc55d",
				},
			},
			{
				path: "miracl-corpus-v1.0-ko/docs-1.jsonl.gz",
				size: 75_422_723,
				lfs: {
					oid: "fecd2886124e78c3aa87c59604ac9909c23165415c70a96f4edb95677b5ed0cd",
				},
			},
		];
		expect(
			parseHuggingFaceCorpusTree("ko", rows).map((row) => row.path),
		).toEqual([
			"miracl-corpus-v1.0-ko/docs-0.jsonl.gz",
			"miracl-corpus-v1.0-ko/docs-1.jsonl.gz",
			"miracl-corpus-v1.0-ko/docs-2.jsonl.gz",
		]);
	});

	it("rejects non-LFS and malformed provider tree rows", () => {
		expect(() => parseHuggingFaceCorpusTree("ar", {})).toThrow(
			"tree is not an array",
		);
		expect(() =>
			parseHuggingFaceCorpusTree("ar", [
				{ path: "miracl-corpus-v1.0-ar/docs-0.jsonl.gz", size: 1 },
			]),
		).toThrow("lacks LFS identity");
	});

	it("creates disjoint collection namespaces for every language", () => {
		const source = "a".repeat(64);
		const policy = "b".repeat(64);
		const namespaces = (["ko", "en", "ar"] as const).map((language) =>
			miraclExecutionNamespace(language, source, policy),
		);
		expect(new Set(namespaces).size).toBe(3);
		expect(namespaces[1]).toBe("naia_miracl_en_aaaaaaaa_bbbbbbbb");
	});

	it("requires explicit, visible partial multilingual qualification", () => {
		expect(resolveMiraclLanguageSelection([])).toEqual({
			languages: ["ko", "en", "ar"],
			omittedPreregistered: [],
			partial: false,
		});
		expect(() => resolveMiraclLanguageSelection(["ar"])).toThrow(
			"subset qualification requires --partial",
		);
		expect(resolveMiraclLanguageSelection(["--partial", "ar"])).toEqual({
			languages: ["ar"],
			omittedPreregistered: ["ko", "en"],
			partial: true,
		});
	});

	it("rejects ambiguous partial and duplicate language selections", () => {
		expect(() => resolveMiraclLanguageSelection(["--partial"])).toThrow(
			"requires at least one language",
		);
		expect(() =>
			resolveMiraclLanguageSelection(["--partial", "ko", "ko"]),
		).toThrow("duplicate MIRACL language");
	});

	it("collects same-origin pagination and resolves relative next links", async () => {
		const pages = new Map([
			["https://example.test/tree", { rows: [1], next: "/tree?page=2" }],
			["https://example.test/tree?page=2", { rows: [2], next: null }],
		]);
		const fetchPage = async (input: URL | RequestInfo) => {
			const page = pages.get(String(input));
			if (!page) return new Response(null, { status: 404 });
			return new Response(JSON.stringify(page.rows), {
				headers: page.next ? { link: `<${page.next}>; rel="next"` } : {},
			});
		};
		await expect(
			collectHuggingFaceTreePages(
				"https://example.test/tree",
				fetchPage as typeof fetch,
			),
		).resolves.toEqual([1, 2]);
	});

	it("rejects cross-origin and cyclic pagination", async () => {
		const crossOrigin = async () =>
			new Response("[]", {
				headers: { link: '<https://attacker.test/tree>; rel="next"' },
			});
		await expect(
			collectHuggingFaceTreePages(
				"https://example.test/tree",
				crossOrigin as typeof fetch,
			),
		).rejects.toThrow("pagination left");
		const cyclic = async () =>
			new Response("[]", {
				headers: { link: '</tree>; rel="next"' },
			});
		await expect(
			collectHuggingFaceTreePages(
				"https://example.test/tree",
				cyclic as typeof fetch,
			),
		).rejects.toThrow("cycle detected");
	});
});
