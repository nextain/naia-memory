import type { RequestHandler } from "express";
import type { MemorySystem } from "../memory/index.js";
import { parseMemoryRequest } from "./request-validation.js";

interface MemoryPostDependencies {
	readonly system: Pick<MemorySystem, "encode">;
	readonly throttle: () => Promise<void>;
	readonly afterEncoded: () => void;
}

/** HTTP boundary for role-preserving memory ingestion. */
export function createMemoryPostHandler(
	dependencies: MemoryPostDependencies,
): RequestHandler {
	return async (req, res) => {
		let request: ReturnType<typeof parseMemoryRequest>;
		try {
			request = parseMemoryRequest(req.body);
		} catch (error) {
			res.status(400).json({ error: (error as Error).message });
			return;
		}

		try {
			let encodedCount = 0;
			for (const message of request.messages) {
				try {
					await dependencies.throttle();
					await dependencies.system.encode(
						{
							content: message.content,
							role: message.role,
							timestamp: request.timestamp,
						},
						{ project: request.userId },
					);
					encodedCount++;
				} catch (error) {
					if (encodedCount > 0) dependencies.afterEncoded();
					throw error;
				}
			}
			dependencies.afterEncoded();
			res.json({ results: [] });
		} catch (error) {
			const message = (error as Error).message;
			console.error("ADD error:", message.slice(0, 300));
			res.status(500).json({ error: message.slice(0, 200) });
		}
	};
}
