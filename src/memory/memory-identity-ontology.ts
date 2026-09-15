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

/**
 * How much a property ID identifies by itself.
 *
 * - "attribute": a person holds one value (name, residence). The ID alone
 *   identifies the property, so "거주지" and "residence" replace each other.
 * - "category": the ID groups many distinct properties (plan:activity covers
 *   a proof deadline and a postcard arrival; beverage-consumption covers
 *   meeting tea and coffee-bean sourcing). The ID alone does not identify the
 *   property, so replacement also requires the same property label.
 *
 * Known limit: within a category, an update restated in another language (a
 * different label) is not treated as a replacement and the old fact stays
 * active. Keeping a stale fact is the less harmful error under the
 * preservation-first rule.
 */
export const MEMORY_PROPERTY_IDENTITY: Readonly<
	Record<(typeof MEMORY_PROPERTY_IDS)[number], "attribute" | "category">
> = {
	"profile:name": "attribute",
	"profile:pronouns": "attribute",
	"profile:residence": "attribute",
	"profile:occupation": "attribute",
	"profile:organization": "category",
	"profile:timezone": "attribute",
	"profile:language": "attribute",
	"profile:allergy": "category",
	"profile:diet": "category",
	"profile:medication": "category",
	"profile:beverage-consumption": "category",
	"profile:hobby": "category",
	"plan:activity": "category",
	"routine:morning": "category",
	"preference:animal": "category",
	"preference:book-genre": "category",
	"preference:color": "category",
	"preference:editor": "category",
	"preference:food": "category",
	"preference:music-genre": "category",
	"preference:tool": "category",
	"preference:travel-destination": "category",
	"preference:communication": "category",
};

/** Unknown IDs are treated as categories: identity must not rest on an ID the vocabulary does not define. */
export function isAttributePropertyId(value: string): boolean {
	return (MEMORY_PROPERTY_IDENTITY as Record<string, string>)[value] === "attribute";
}

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
