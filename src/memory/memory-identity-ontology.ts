export const MEMORY_SUBJECT_IDS = ["person:self"] as const;

export const MEMORY_PROPERTY_IDS = [
	"profile:name",
	"profile:pronouns",
	"profile:residence",
	"profile:occupation",
	"profile:organization",
	"profile:timezone",
	"profile:language",
	"profile:allergy",
	"profile:diet",
	"profile:medication",
	"profile:beverage-consumption",
	"profile:hobby",
	"plan:activity",
	"routine:morning",
	"preference:animal",
	"preference:book-genre",
	"preference:color",
	"preference:editor",
	"preference:food",
	"preference:music-genre",
	"preference:tool",
	"preference:travel-destination",
	"preference:communication",
] as const;

const SUBJECT_IDS = new Set<string>(MEMORY_SUBJECT_IDS);
const PROPERTY_IDS = new Set<string>(MEMORY_PROPERTY_IDS);

export function isMemorySubjectId(value: unknown): value is string {
	return typeof value === "string" && SUBJECT_IDS.has(value);
}

export function isMemoryPropertyId(value: unknown): value is string {
	return typeof value === "string" && PROPERTY_IDS.has(value);
}

const GENERIC_IDENTITY_TOKENS = new Set([
	"profile",
	"preference",
	"prefer",
	"preferred",
	"routine",
]);

function identityTokens(value: string): Set<string> {
	return new Set(
		value
			.normalize("NFC")
			.toLocaleLowerCase("en")
			.match(/[a-z]+/g)
			?.filter((token) => !GENERIC_IDENTITY_TOKENS.has(token)) ?? [],
	);
}

export function inferEnglishMemoryPropertyId(
	property: string,
): string | undefined {
	if ([...property].some((character) => (character.codePointAt(0) ?? 0) > 0x7f))
		return undefined;
	const propertyTokens = identityTokens(property);
	if (propertyTokens.size === 0) return undefined;
	const candidates = MEMORY_PROPERTY_IDS.filter((propertyId) => {
		const idTokens = identityTokens(propertyId);
		return (
			[...propertyTokens].every((token) => idTokens.has(token)) ||
			[...idTokens].every((token) => propertyTokens.has(token))
		);
	});
	return candidates.length === 1 ? candidates[0] : undefined;
}
