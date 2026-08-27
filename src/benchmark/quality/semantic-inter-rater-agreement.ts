const LABELS = [
	"current",
	"stale",
	"deleted",
	"irrelevant",
	"uncertain",
] as const;

export type SemanticJudgmentLabel = (typeof LABELS)[number];

export type RatedSemanticMemory = {
	subjectId: string;
	language: string;
	ratings: SemanticJudgmentLabel[];
};

type AgreementCell = {
	subjects: number;
	ratings: number;
	agreeingPairs: number;
	totalPairs: number;
	exactAgreementSubjects: number;
	disagreementSubjects: number;
	percentAgreement: number;
	exactAgreementRate: number;
	multiRaterKappa: number;
};

function rounded(value: number): number {
	return Number(value.toFixed(6));
}

function summarize(subjects: RatedSemanticMemory[]): AgreementCell {
	if (subjects.length === 0)
		throw new Error("agreement requires at least one rated memory");
	const labelCounts = new Map<SemanticJudgmentLabel, number>(
		LABELS.map((label) => [label, 0]),
	);
	let ratings = 0;
	let agreeingPairs = 0;
	let totalPairs = 0;
	let exactAgreementSubjects = 0;
	for (const subject of subjects) {
		if (subject.ratings.length < 2)
			throw new Error("agreement requires at least two ratings per memory");
		const counts = new Map<SemanticJudgmentLabel, number>();
		for (const label of subject.ratings) {
			if (!LABELS.includes(label))
				throw new Error("unsupported agreement label");
			counts.set(label, (counts.get(label) ?? 0) + 1);
			labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
			ratings += 1;
		}
		const pairs = (subject.ratings.length * (subject.ratings.length - 1)) / 2;
		totalPairs += pairs;
		agreeingPairs += [...counts.values()].reduce(
			(sum, count) => sum + (count * (count - 1)) / 2,
			0,
		);
		if (counts.size === 1) exactAgreementSubjects += 1;
	}
	const observed = agreeingPairs / totalPairs;
	const expected = [...labelCounts.values()].reduce(
		(sum, count) => sum + (count / ratings) ** 2,
		0,
	);
	const kappa =
		expected === 1
			? observed === 1
				? 1
				: 0
			: (observed - expected) / (1 - expected);
	return {
		subjects: subjects.length,
		ratings,
		agreeingPairs,
		totalPairs,
		exactAgreementSubjects,
		disagreementSubjects: subjects.length - exactAgreementSubjects,
		percentAgreement: rounded(observed),
		exactAgreementRate: rounded(exactAgreementSubjects / subjects.length),
		multiRaterKappa: rounded(kappa),
	};
}

export function consensusSemanticLabel(
	ratings: SemanticJudgmentLabel[],
): SemanticJudgmentLabel {
	if (ratings.length < 2)
		throw new Error("consensus requires at least two ratings");
	const counts = new Map<SemanticJudgmentLabel, number>();
	for (const label of ratings) counts.set(label, (counts.get(label) ?? 0) + 1);
	const highest = Math.max(...counts.values());
	const winners = LABELS.filter((label) => counts.get(label) === highest);
	return winners.length === 1 ? winners[0] : "uncertain";
}

export function calculateSemanticInterRaterAgreement(
	subjects: RatedSemanticMemory[],
) {
	const ids = new Set<string>();
	for (const subject of subjects) {
		if (!subject.subjectId.trim() || ids.has(subject.subjectId))
			throw new Error("agreement subject IDs must be unique");
		if (!subject.language.trim())
			throw new Error("agreement language is invalid");
		ids.add(subject.subjectId);
	}
	const languages = [
		...new Set(subjects.map((subject) => subject.language)),
	].sort();
	return {
		schemaVersion: "naia-memory-semantic-inter-rater-agreement-v1" as const,
		method:
			"pairwise observed agreement and pooled-category chance-corrected multi-rater kappa; ties resolve to uncertain for scoring",
		scopeCaveat:
			"Overall kappa pools category prevalence across languages; use byLanguage kappa for language-specific claims.",
		overall: summarize(subjects),
		byLanguage: Object.fromEntries(
			languages.map((language) => [
				language,
				summarize(subjects.filter((subject) => subject.language === language)),
			]),
		),
	};
}
