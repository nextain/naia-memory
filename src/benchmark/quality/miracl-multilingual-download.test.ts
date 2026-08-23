import { describe, expect, it } from "vitest";
import {
	miraclDownloadFiles,
	miraclProviderUrl,
	miraclSourceLockReceipt,
	miraclSourceRoot,
	parseMiraclSourceLockReceipt,
} from "./miracl-multilingual-download.js";

const corpus = [
	{
		path: "miracl-corpus-v1.0-ar/docs-0.jsonl.gz",
		size: 94_104_175,
		sha256: "f3c38eaa54836397aae4793bb052430646028c2c958c1a54fb71900c83f5dcee",
	},
	{
		path: "miracl-corpus-v1.0-ar/docs-1.jsonl.gz",
		size: 83_793_880,
		sha256: "77f67390f95a69ae2447fffb2a62c0de9d28e8d0eb3bf97cfe04e85c1924cd42",
	},
	{
		path: "miracl-corpus-v1.0-ar/docs-2.jsonl.gz",
		size: 70_295_610,
		sha256: "8c10dda6b56429841e730432aa75d3338e37b605410b936b4fc6c914521d2aec",
	},
	{
		path: "miracl-corpus-v1.0-ar/docs-3.jsonl.gz",
		size: 64_551_259,
		sha256: "0d0a02ec18ca8e246f0af5788077fa23f1de35d5a40dee6cacc4fe5a2b91f904",
	},
	{
		path: "miracl-corpus-v1.0-ar/docs-4.jsonl.gz",
		size: 7_227_421,
		sha256: "4b75ab6cac6ae8615a60f1b278460dd3d9ef776ea002a6684a6757631fec62fc",
	},
];

describe("MIRACL multilingual download", () => {
	it("builds a language-isolated, revision-pinned source plan", () => {
		const files = miraclDownloadFiles("ar", corpus);
		expect(files).toHaveLength(7);
		expect(miraclSourceRoot("ar")).toBe(
			".cache/benchmark-sources/miracl-ar-v1.0",
		);
		expect(miraclProviderUrl(files[0])).toContain(
			"miracl/miracl/resolve/5be20db9509754dadad47689368639fcec739c00/",
		);
		expect(miraclProviderUrl(files[6])).toContain(
			"miracl/miracl-corpus/resolve/d921ec7e349ce0d28daf30b2da9da5ee698bef0d/",
		);
	});

	it("binds the receipt digest to language and ordered files", () => {
		const files = miraclDownloadFiles("ar", corpus);
		const receipt = miraclSourceLockReceipt("ar", files);
		expect(receipt.sourceLockSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(
			miraclSourceLockReceipt("ar", [...files].reverse()).sourceLockSha256,
		).not.toBe(receipt.sourceLockSha256);
	});

	it("rejects a receipt whose declared digest does not bind its files", () => {
		const receipt = miraclSourceLockReceipt(
			"ar",
			miraclDownloadFiles("ar", corpus),
		);
		expect(parseMiraclSourceLockReceipt("ar", receipt)).toEqual(receipt);
		expect(() =>
			parseMiraclSourceLockReceipt("ar", {
				...receipt,
				sourceLockSha256: "0".repeat(64),
			}),
		).toThrow();
	});
});
