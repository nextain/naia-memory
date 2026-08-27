export interface DeleteVerifierEndpointConfig {
	apiKey: string;
	baseURL: string;
	model: string;
}

/**
 * Delete mutation stays disabled unless an operator configures a distinct
 * verifier endpoint explicitly. A warning-only same-provider fallback would
 * weaken the secondary-decision boundary without making that visible to callers.
 */
export function resolveDeleteVerifierConfig(options: {
	extractorBaseURL: string;
	extractorModel: string;
	extractorProvider: string;
	environment: NodeJS.ProcessEnv;
}): DeleteVerifierEndpointConfig | undefined {
	const apiKey = options.environment.DELETE_VERIFIER_API_KEY;
	const baseURL = options.environment.DELETE_VERIFIER_BASE_URL;
	const model = options.environment.DELETE_VERIFIER_MODEL;
	const provider = options.environment.DELETE_VERIFIER_PROVIDER;
	if (!apiKey || !baseURL || !model || !provider) return undefined;
	if (
		baseURL.replace(/\/+$/, "") === options.extractorBaseURL.replace(/\/+$/, "")
	)
		return undefined;
	if (model.toLocaleLowerCase() === options.extractorModel.toLocaleLowerCase())
		return undefined;
	if (
		provider.toLocaleLowerCase() ===
		options.extractorProvider.toLocaleLowerCase()
	)
		return undefined;
	return {
		apiKey,
		baseURL,
		model,
	};
}
