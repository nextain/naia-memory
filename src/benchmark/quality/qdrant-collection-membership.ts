import { createHash } from "node:crypto";

interface QdrantScrollPoint {
	id?: unknown;
	payload?: { docid?: unknown };
}

interface QdrantScrollResponse {
	result?: {
		points?: QdrantScrollPoint[];
		next_page_offset?: unknown;
	};
}

export interface QdrantCollectionMembershipEvidence {
	documentCount: number;
	docidsSha256: string;
	firstPointId: number;
	lastPointId: number;
}

export async function auditQdrantCollectionMembership(options: {
	baseUrl: string;
	collectionName: string;
	expectedDocumentCount: number;
	pageSize?: number;
	fetchImpl?: typeof fetch;
}): Promise<QdrantCollectionMembershipEvidence> {
	const pageSize = options.pageSize ?? 10_000;
	if (
		!Number.isSafeInteger(options.expectedDocumentCount) ||
		options.expectedDocumentCount < 1 ||
		!Number.isSafeInteger(pageSize) ||
		pageSize < 1
	)
		throw new Error("invalid Qdrant membership audit shape");
	const fetchImpl = options.fetchImpl ?? fetch;
	const docids = createHash("sha256");
	let count = 0;
	let offset: number | undefined;
	let firstPointId = 0;
	let lastPointId = 0;
	for (;;) {
		const response = await fetchImpl(
			`${options.baseUrl}/collections/${encodeURIComponent(options.collectionName)}/points/scroll`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					limit: pageSize,
					offset,
					with_payload: ["docid"],
					with_vector: false,
				}),
			},
		);
		if (!response.ok)
			throw new Error(`Qdrant membership scroll HTTP ${response.status}`);
		const body = (await response.json()) as QdrantScrollResponse;
		const points = body.result?.points;
		if (!Array.isArray(points))
			throw new Error("Qdrant membership scroll result missing");
		if (points.length === 0 && body.result?.next_page_offset !== undefined)
			throw new Error("Qdrant membership scroll made no progress");
		for (const point of points) {
			// The full-corpus ingestion contract assigns `ordinal + 1` as the
			// Qdrant point ID. Strictly checking every ID binds scroll order to the
			// checkpoint's canonical document order and rejects gaps or duplicates.
			const expectedPointId = count + 1;
			if (point.id !== expectedPointId)
				throw new Error("Qdrant membership point ordinal mismatch");
			if (
				typeof point.payload?.docid !== "string" ||
				point.payload.docid.length === 0 ||
				point.payload.docid.includes("\n") ||
				point.payload.docid.includes("\r")
			)
				throw new Error("Qdrant membership docid mismatch");
			if (count === 0) firstPointId = point.id;
			lastPointId = point.id;
			docids.update(`${point.payload.docid}\n`);
			count++;
			if (count > options.expectedDocumentCount)
				throw new Error("Qdrant membership cardinality mismatch");
		}
		const next = body.result?.next_page_offset;
		if (next === null || next === undefined) break;
		if (!Number.isSafeInteger(next) || next !== count + 1)
			throw new Error("Qdrant membership continuation mismatch");
		offset = next as number;
	}
	if (count !== options.expectedDocumentCount)
		throw new Error("Qdrant membership cardinality mismatch");
	return {
		documentCount: count,
		docidsSha256: docids.digest("hex"),
		firstPointId,
		lastPointId,
	};
}
