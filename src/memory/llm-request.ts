// Shared OpenAI-compatible chat/completions request helpers for memory-LLM calls (nextain/naia-shell#692).

/** GPT-5 family ids, bare or provider-qualified: "gpt-5", "gpt-5.4-nano", "gpt-5-4-nano", "azure:gpt-5.4-nano",
 *  "openai/gpt-5-mini". Azure GPT-5 reasoning deployments accept only the default temperature. */
export function isGpt5FamilyModel(model: string | undefined): boolean {
	return /(?:^|[:/])gpt-5(?:$|[.\-_])/i.test(String(model ?? "").trim());
}

/** `temperature` field for a request body. `override`: number = send it, null = omit, undefined = model default
 *  (omit for GPT-5 family, else `fallback`). Non-finite numbers are treated as undefined. */
export function temperatureField(
	model: string | undefined,
	fallback: number,
	override?: number | null,
): { temperature?: number } {
	if (override === null) return {};
	if (typeof override === "number" && Number.isFinite(override)) return { temperature: override };
	if (isGpt5FamilyModel(model)) return {};
	return { temperature: fallback };
}

/** `<base>/chat/completions` with exactly one "/" between, whether or not `baseURL` ends with slashes. */
export function chatCompletionsUrl(baseURL: string): string {
	return `${String(baseURL ?? "").trim().replace(/\/+$/, "")}/chat/completions`;
}
