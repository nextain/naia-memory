export const MAX_EXACT_BINOMIAL_TRIALS = 1023;

export function exactBinomialUpperTail(
	successes: number,
	trials: number,
): number {
	if (
		!Number.isInteger(successes) ||
		!Number.isInteger(trials) ||
		successes < 0 ||
		trials < 0 ||
		successes > trials
	)
		throw new Error("exact sign test counts are invalid");
	if (trials === 0) return 1;
	if (trials > MAX_EXACT_BINOMIAL_TRIALS)
		throw new Error("exact sign test exceeds numerical range");
	let probability = 2 ** -trials;
	let total = 0;
	for (let count = 0; count <= trials; count++) {
		if (count >= successes) total += probability;
		if (count < trials) probability *= (trials - count) / (count + 1);
	}
	return Math.min(1, total);
}

export function holmRejectedCount(pValues: number[], alpha: number): number {
	if (
		!Number.isFinite(alpha) ||
		alpha <= 0 ||
		alpha >= 1 ||
		pValues.some(
			(pValue) => !Number.isFinite(pValue) || pValue < 0 || pValue > 1,
		)
	)
		throw new Error("Holm inputs are invalid");
	const ordered = [...pValues].sort((a, b) => a - b);
	let rejected = 0;
	for (let index = 0; index < ordered.length; index++) {
		const pValue = ordered[index];
		if (pValue !== undefined && pValue <= alpha / (ordered.length - index))
			rejected++;
		else break;
	}
	return rejected;
}
