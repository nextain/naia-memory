export const MAX_MESSAGES_PER_REQUEST = 64;

export interface ValidatedMemoryMessage {
	role: "user" | "assistant" | "tool";
	content: string;
}

export interface ValidatedMemoryRequest {
	messages: ValidatedMemoryMessage[];
	userId: string;
	timestamp: number | undefined;
}

export function validateMessageBatchSize(messages: unknown[]): void {
	if (messages.length > MAX_MESSAGES_PER_REQUEST) {
		throw new RangeError(
			`messages must contain at most ${MAX_MESSAGES_PER_REQUEST} items`,
		);
	}
}

export function parseOptionalTimestamp(value: unknown): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new TypeError("timestamp must be a finite number");
	}
	return value;
}

export function parseMemoryRequest(value: unknown): ValidatedMemoryRequest {
	if (!value || typeof value !== "object") {
		throw new TypeError("request body must be an object");
	}
	const body = value as Record<string, unknown>;
	if (!Array.isArray(body.messages) || body.messages.length === 0) {
		throw new TypeError("messages and user_id required");
	}
	if (typeof body.user_id !== "string" || body.user_id.length === 0) {
		throw new TypeError("messages and user_id required");
	}
	validateMessageBatchSize(body.messages);
	if (
		body.messages.some((message) => {
			if (!message || typeof message !== "object") return true;
			const candidate = message as Record<string, unknown>;
			return (
				typeof candidate.content !== "string" ||
				typeof candidate.role !== "string" ||
				!["user", "assistant", "tool"].includes(candidate.role)
			);
		})
	) {
		throw new TypeError("invalid message role or content");
	}
	return {
		messages: body.messages as ValidatedMemoryMessage[],
		userId: body.user_id,
		timestamp: parseOptionalTimestamp(body.timestamp),
	};
}
