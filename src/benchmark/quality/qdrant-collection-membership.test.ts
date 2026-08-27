import { describe, expect, it } from "vitest";
import { auditQdrantCollectionMembership } from "./qdrant-collection-membership.js";

function response(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

describe("auditQdrantCollectionMembership", () => {
	it("hashes every payload docid in strict point-id order", async () => {
		const pages = [
			{
				result: {
					points: [{ id: 1, payload: { docid: "a" } }],
					next_page_offset: 2,
				},
			},
			{
				result: {
					points: [{ id: 2, payload: { docid: "b" } }],
					next_page_offset: null,
				},
			},
		];
		const fetchImpl = async () => response(pages.shift());
		await expect(
			auditQdrantCollectionMembership({
				baseUrl: "http://127.0.0.1:6334",
				collectionName: "collection",
				expectedDocumentCount: 2,
				pageSize: 1,
				fetchImpl: fetchImpl as typeof fetch,
			}),
		).resolves.toEqual({
			documentCount: 2,
			docidsSha256:
				"911169ddaaf146aff539f58c26c489af3b892dff0fe283c1c264c65ae5aa59a2",
			firstPointId: 1,
			lastPointId: 2,
		});
	});

	it.each([
		[[{ id: 2, payload: { docid: "a" } }], "ordinal"],
		[[{ id: 1, payload: { docid: "a\nb" } }], "docid"],
	])("rejects substituted collection membership", async (points, message) => {
		const fetchImpl = async () =>
			response({ result: { points, next_page_offset: null } });
		await expect(
			auditQdrantCollectionMembership({
				baseUrl: "http://127.0.0.1:6334",
				collectionName: "collection",
				expectedDocumentCount: 1,
				fetchImpl: fetchImpl as typeof fetch,
			}),
		).rejects.toThrow(message);
	});

	it("rejects a continuation that skips a point id", async () => {
		const fetchImpl = async () =>
			response({
				result: {
					points: [{ id: 1, payload: { docid: "a" } }],
					next_page_offset: 3,
				},
			});
		await expect(
			auditQdrantCollectionMembership({
				baseUrl: "http://127.0.0.1:6334",
				collectionName: "collection",
				expectedDocumentCount: 2,
				fetchImpl: fetchImpl as typeof fetch,
			}),
		).rejects.toThrow("continuation");
	});

	it("rejects extra points beyond the expected cardinality", async () => {
		const fetchImpl = async () =>
			response({
				result: {
					points: [
						{ id: 1, payload: { docid: "a" } },
						{ id: 2, payload: { docid: "b" } },
					],
					next_page_offset: null,
				},
			});
		await expect(
			auditQdrantCollectionMembership({
				baseUrl: "http://127.0.0.1:6334",
				collectionName: "collection",
				expectedDocumentCount: 1,
				fetchImpl: fetchImpl as typeof fetch,
			}),
		).rejects.toThrow("cardinality");
	});
});
