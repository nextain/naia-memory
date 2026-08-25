import { describe, expect, it } from "vitest";
import {
	buildMiraclEnPrimarySampleReceipt,
	buildMiraclEnRetrievalCorpus,
	miraclEnSelectedQrelsSha256,
	miraclEnSelectedRelevantDocids,
	selectMiraclEnPreflightQueryIds,
	validateMiraclEnPassageStrata,
	verifyMiraclEnSourcePassage,
} from "./miracl-en-primary-sample-receipt.js";
import { MIRACL_MULTILINGUAL_CONTRACT } from "./miracl-multilingual-contract.js";

function queryFixture() {
	const rows = Array.from(
		{ length: MIRACL_MULTILINGUAL_CONTRACT.en.topics.queryCount },
		(_, index) => [`q${index.toString().padStart(3, "0")}`, `query ${index}`],
	);
	return {
		topics: `${rows.map(([id, query]) => `${id}\t${query}`).join("\n")}\n`,
		qrels: `${rows.map(([id], index) => `${id}\tQ0\td${index}\t1`).join("\n")}\n`,
	};
}

describe("MIRACL-en source-derived preflight receipt", () => {
	it("selects exactly 64 deterministic locked-query identities", () => {
		const fixture = queryFixture();
		const first = selectMiraclEnPreflightQueryIds(
			fixture.topics,
			fixture.qrels,
		);
		const second = selectMiraclEnPreflightQueryIds(
			fixture.topics,
			fixture.qrels,
		);
		expect(first).toEqual(second);
		expect(first).toHaveLength(64);
		expect(new Set(first).size).toBe(64);
		expect(first).toEqual([...first].sort());
	});

	it("rejects a qrels set that is not complete for the locked topics", () => {
		const fixture = queryFixture();
		expect(() =>
			selectMiraclEnPreflightQueryIds(
				fixture.topics,
				fixture.qrels.split("\n").slice(0, -2).join("\n"),
			),
		).toThrow("query set mismatch");
	});

	it("binds selected relevance sets independent of qrels row order", () => {
		const first = "q1\tQ0\td2\t1\nq1\tQ0\td1\t1\nq2\tQ0\td3\t1\n";
		const second = "q2\tQ0\td3\t1\nq1\tQ0\td1\t1\nq1\tQ0\td2\t1\n";
		expect(miraclEnSelectedQrelsSha256(first, ["q1", "q2"])).toBe(
			miraclEnSelectedQrelsSha256(second, ["q1", "q2"]),
		);
		expect(miraclEnSelectedQrelsSha256(first, ["q1"])).not.toBe(
			miraclEnSelectedQrelsSha256(first, ["q1", "q2"]),
		);
		expect(miraclEnSelectedRelevantDocids(first, ["q1", "q2"])).toEqual([
			"d1",
			"d2",
			"d3",
		]);
	});

	it("rejects a count-correct sample concentrated in one length stratum", () => {
		const forged = Array.from({ length: 8_192 }, (_, ordinal) => ({
			ordinal,
			docid: `d${ordinal}`,
			content: "short",
		}));
		expect(() => validateMiraclEnPassageStrata(forged)).toThrow(
			"strata are inconsistent",
		);
	});

	it("accepts exactly 1,024 passages in every configured length stratum", () => {
		const byteLengths = [1, 128, 256, 512, 1_024, 2_048, 4_096, 8_192];
		const passages = byteLengths.flatMap((length, stratum) =>
			Array.from({ length: 1_024 }, (_, offset) => ({
				ordinal: stratum * 1_024 + offset,
				docid: `d${stratum}-${offset}`,
				content: "x".repeat(length),
			})),
		);
		expect(() => validateMiraclEnPassageStrata(passages)).not.toThrow();
	});

	it("builds the retrieval corpus from stratified negatives and every qrel document", () => {
		const sample = [
			{ ordinal: 1, docid: "negative", content: "n" },
			{ ordinal: 3, docid: "relevant-2", content: "r2" },
		];
		const relevant = [
			{ ordinal: 2, docid: "relevant-1", content: "r1" },
			{ ordinal: 3, docid: "relevant-2", content: "r2" },
		];
		expect(
			buildMiraclEnRetrievalCorpus(sample, relevant, [
				"relevant-1",
				"relevant-2",
			]),
		).toEqual([
			{ ordinal: 1, docid: "negative", content: "n" },
			{ ordinal: 2, docid: "relevant-1", content: "r1" },
			{ ordinal: 3, docid: "relevant-2", content: "r2" },
		]);
	});

	it("rejects a retrieval corpus missing a selected qrel document", () => {
		expect(() =>
			buildMiraclEnRetrievalCorpus(
				[{ ordinal: 1, docid: "negative", content: "n" }],
				[{ ordinal: 2, docid: "relevant-1", content: "r1" }],
				["relevant-1", "relevant-2"],
			),
		).toThrow("does not cover every selected qrel");
	});

	it("rejects bytes that merely claim the locked source identity", () => {
		const contract = MIRACL_MULTILINGUAL_CONTRACT.en;
		expect(() =>
			buildMiraclEnPrimarySampleReceipt({
				sourceLockSha256: contract.corpus.expectedSourceLockSha256,
				scan: {
					documentCount: contract.corpus.expectedDocumentCount,
					docidsSha256: contract.corpus.expectedDocidsSha256,
					compressedShardCount: contract.corpus.shardCount,
					compressedBytes: 1,
					duplicateDocidCount: 0,
				},
				topicsBytes: Buffer.from("forged"),
				qrelsBytes: Buffer.from("forged"),
				passages: [],
				retrievalPassages: [],
				producerSourceManifest: {} as never,
			}),
		).toThrow("topics/qrels bytes");
	});

	it("rejects a self-consistent receipt passage whose body differs from the locked corpus", () => {
		const expected = {
			ordinal: 7,
			docid: "doc-7",
			content: "title\nforged body",
		};
		expect(() =>
			verifyMiraclEnSourcePassage(
				expected,
				{ docid: "doc-7", title: "title", text: "locked body" },
				7,
			),
		).toThrow("does not match the locked corpus");
	});

	it("accepts only the exact locked ordinal, identity, and composed body", () => {
		expect(() =>
			verifyMiraclEnSourcePassage(
				{ ordinal: 7, docid: "doc-7", content: "title\nlocked body" },
				{ docid: "doc-7", title: "title", text: "locked body" },
				7,
			),
		).not.toThrow();
	});
});
