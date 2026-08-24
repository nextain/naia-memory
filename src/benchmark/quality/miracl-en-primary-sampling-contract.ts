export const MIRACL_EN_PREFLIGHT_SAMPLE_SEED =
	"naia-miracl-en-primary-v1" as const;

export const MIRACL_EN_PREFLIGHT_STRATA = [
	0,
	128,
	256,
	512,
	1_024,
	2_048,
	4_096,
	8_192,
	Number.POSITIVE_INFINITY,
] as const;

export const MIRACL_EN_PREFLIGHT_PER_STRATUM = 1_024;

export function englishPreflightStratumFor(length: number): number {
	for (let index = 0; index < MIRACL_EN_PREFLIGHT_STRATA.length - 1; index += 1)
		if (
			length >= (MIRACL_EN_PREFLIGHT_STRATA[index] ?? 0) &&
			length <
				(MIRACL_EN_PREFLIGHT_STRATA[index + 1] ?? Number.POSITIVE_INFINITY)
		)
			return index;
	throw new Error("passage length is outside configured strata");
}

export function compareCanonicalText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
