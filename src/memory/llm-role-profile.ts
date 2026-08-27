export type DevelopmentLlmRole = "expert" | "main" | "sub";
export type MemoryLlmRole = DevelopmentLlmRole | "memory";
export type LlmTransportAuth = "bearer" | "x-anyllm";
export interface LlmRoleProfile {
	provider?: string;
	model?: string;
	baseUrl?: string;
	credentialRef?: string;
	auth?: LlmTransportAuth;
	inherit?: MemoryLlmRole;
}
export interface ThreeTierLlmProfiles {
	expert?: LlmRoleProfile;
	main?: LlmRoleProfile;
	sub?: LlmRoleProfile /** Functional override, not a development tier. */;
	memory?: LlmRoleProfile;
}
export interface ResolvedMemoryLlmProfile {
	sourceRole: "sub" | "memory";
	provider: string;
	model: string;
	baseUrl?: string;
	credentialRef?: string;
	auth?: LlmTransportAuth;
}
export function resolveMemoryLlmProfile(
	profiles: ThreeTierLlmProfiles,
): ResolvedMemoryLlmProfile {
	const sourceRole: "sub" | "memory" = profiles.memory ? "memory" : "sub";
	const resolved = resolveRole(sourceRole, profiles, new Set());
	if (!resolved.provider || !resolved.model)
		throw new Error(
			`LLM profile "${sourceRole}" must resolve both provider and model.`,
		);
	return Object.freeze({
		sourceRole,
		provider: resolved.provider,
		model: resolved.model,
		...(resolved.baseUrl ? { baseUrl: resolved.baseUrl } : {}),
		...(resolved.credentialRef
			? { credentialRef: resolved.credentialRef }
			: {}),
		...(resolved.auth ? { auth: resolved.auth } : {}),
	});
}
function resolveRole(
	role: MemoryLlmRole,
	profiles: ThreeTierLlmProfiles,
	seen: Set<MemoryLlmRole>,
): LlmRoleProfile {
	if (seen.has(role))
		throw new Error(`LLM profile inheritance cycle at "${role}".`);
	seen.add(role);
	const profile = profiles[role];
	if (!profile) throw new Error(`LLM profile "${role}" is not configured.`);
	const parent = profile.inherit
		? resolveRole(profile.inherit, profiles, seen)
		: undefined;
	return {
		provider: profile.provider ?? parent?.provider,
		model: profile.model ?? parent?.model,
		baseUrl: profile.baseUrl ?? parent?.baseUrl,
		credentialRef: profile.credentialRef ?? parent?.credentialRef,
		auth: profile.auth ?? parent?.auth,
	};
}
