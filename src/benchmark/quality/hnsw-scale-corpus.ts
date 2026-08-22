import { createHash } from "node:crypto";

export interface ScaleFact {
	id: string;
	statement: string;
}

export interface ContaminationReceipt {
	targetSize: number;
	baseSize: number;
	generatedSize: number;
	uniqueIds: number;
	uniqueStatements: number;
	baseDuplicateStatements: number;
	generatedStatementCollisions: number;
	exactReferenceCollisions: number;
	referenceSubstringCollisions: number;
	domainCount: number;
	templateFamilyCount: number;
	construction: "deterministic-multi-domain-diagnostic";
	corpusSha256: string;
}

const KO_DOMAINS = [
	"물류",
	"천문",
	"농업",
	"제조",
	"해양",
	"건축",
	"보건",
	"에너지",
	"기상",
	"철도",
	"교육",
	"산림",
	"수자원",
	"도서관",
	"통신",
	"고고학",
	"식품",
	"항공",
	"재난",
	"지도",
	"음향",
	"생태",
	"재료",
	"교통",
	"문화재",
	"광학",
	"로봇",
	"지질",
	"원예",
	"소방",
	"수산",
	"환경",
];
const EN_DOMAINS = [
	"logistics",
	"astronomy",
	"agriculture",
	"manufacturing",
	"marine",
	"architecture",
	"health",
	"energy",
	"weather",
	"railway",
	"education",
	"forestry",
	"water",
	"library",
	"telecom",
	"archaeology",
	"food",
	"aviation",
	"disaster",
	"mapping",
	"acoustics",
	"ecology",
	"materials",
	"transport",
	"heritage",
	"optics",
	"robotics",
	"geology",
	"horticulture",
	"fire safety",
	"fisheries",
	"environment",
];
const KO_REGIONS = [
	"가람",
	"누리",
	"다온",
	"라온",
	"마루",
	"바다",
	"새롬",
	"하람",
	"솔빛",
	"한결",
	"여울",
	"미리내",
	"온새미",
	"해오름",
	"푸른샘",
	"별하",
	"아라",
	"늘봄",
	"샛별",
	"한울",
	"도담",
	"윤슬",
	"초롱",
	"나래",
	"해든",
	"이든",
	"다솜",
	"누림",
	"보람",
	"슬기",
	"예람",
	"고운",
];
const EN_REGIONS = [
	"Aster",
	"Beryl",
	"Cedar",
	"Dover",
	"Elm",
	"Fjord",
	"Grove",
	"Haven",
	"Iris",
	"Juniper",
	"Kestrel",
	"Linden",
	"Mesa",
	"Northstar",
	"Orchid",
	"Prairie",
	"Quartz",
	"Ridge",
	"Summit",
	"Tamarack",
	"Umber",
	"Vale",
	"Willow",
	"Xenia",
	"Yarrow",
	"Zephyr",
	"Amber",
	"Brook",
	"Cliff",
	"Delta",
	"Estuary",
	"Flint",
];
const UNITS = [
	"단계",
	"구역",
	"노드",
	"주기",
	"분기",
	"계층",
	"경로",
	"묶음",
	"지점",
	"차수",
	"범위",
	"회차",
	"모듈",
	"단위",
	"구간",
	"등급",
];
const EN_UNITS = [
	"stage",
	"sector",
	"node",
	"cycle",
	"branch",
	"layer",
	"route",
	"batch",
	"station",
	"degree",
	"range",
	"round",
	"module",
	"unit",
	"section",
	"grade",
];

const TEMPLATE_FAMILY_COUNT = 32;

function mixIndex(index: number, salt: number): number {
	let value = (index + salt) >>> 0;
	value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
	value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
	return (value ^ (value >>> 16)) >>> 0;
}

function generatedStatement(language: string, index: number): string {
	const domainIndex = mixIndex(index, 0x9e3779b9) % KO_DOMAINS.length;
	const regionIndex = mixIndex(index, 0x243f6a88) % KO_REGIONS.length;
	const unitIndex = mixIndex(index, 0xb7e15162) % UNITS.length;
	const templateIndex = mixIndex(index, 0xdeadbeef) % TEMPLATE_FAMILY_COUNT;
	const serial = mixIndex(index, 0xa5a5a5a5);
	const code = `${String.fromCharCode(65 + (serial % 26))}${String(index).padStart(6, "0")}`;
	const value = 1000 + ((index * 7919 + 104729) % 8999);
	const day = 1 + ((index * 17) % 28);
	const hour = 6 + ((index * 11) % 17);
	const ko = {
		domain: KO_DOMAINS[domainIndex],
		region: KO_REGIONS[regionIndex],
		unit: UNITS[unitIndex],
	};
	const en = {
		domain: EN_DOMAINS[domainIndex],
		region: EN_REGIONS[regionIndex],
		unit: EN_UNITS[unitIndex],
	};
	const koTemplates = [
		() =>
			`${ko.region} ${ko.domain} 관측소의 ${ko.unit} ${code} 기준값은 ${value}이다.`,
		() =>
			`${day}일 ${hour}시에 ${ko.region} 지역의 ${ko.domain} 점검 ${code}가 완료되었다.`,
		() =>
			`${ko.domain} 담당자는 ${code} 장비를 ${ko.region} ${ko.unit}에 배정했다.`,
		() =>
			`${ko.region}에서 출발한 ${code} 화물은 ${value}번 ${ko.domain} 창고에 도착한다.`,
		() =>
			`${code} 프로젝트의 다음 ${ko.domain} 검토는 ${day}일이며 장소는 ${ko.region}이다.`,
		() =>
			`${ko.region} 팀은 ${ko.domain} 실험 ${code}에 표본 ${value}개를 사용했다.`,
		() =>
			`${ko.domain} 안내서 ${code}의 ${ko.unit} 책임자는 ${ko.region} 연구원이다.`,
		() =>
			`${hour}시 이후 ${ko.region} ${ko.domain} 시설은 ${code} 절차로 전환한다.`,
		() =>
			`${code} 센서가 기록한 ${ko.region}의 ${ko.domain} 측정치는 ${value} 단위였다.`,
		() =>
			`${ko.region} 회의에서 ${ko.domain} 안건 ${code}를 ${day}일로 연기했다.`,
		() =>
			`${ko.domain} 자원 ${code}의 보관 위치는 ${ko.region} ${ko.unit} ${value}번이다.`,
		() =>
			`${ko.region} 교육 과정 ${code}는 ${ko.domain} 실습을 ${hour}시에 시작한다.`,
		() =>
			`${code} 요청에 따라 ${ko.domain} 보고서 ${value}호를 ${ko.region}에 전달했다.`,
		() =>
			`${ko.region} 사용자는 ${ko.domain} 알림 ${code}를 ${day}일마다 받도록 설정했다.`,
		() =>
			`${ko.domain} 계약 ${code}에는 ${ko.region}의 ${ko.unit} 한도가 ${value}로 적혀 있다.`,
		() =>
			`${value}번 기록은 ${code} 변경 뒤 ${ko.region} ${ko.domain} 보관함으로 이동했다.`,
		() =>
			`기록 ${code}: ${ko.region}의 ${ko.domain} 기준은 ${value}, 적용 구간은 ${ko.unit}이다.`,
		() =>
			`${day}일자 ${ko.domain} 일지에는 ${ko.region} 작업 ${code}가 ${hour}시에 시작됐다고 적혀 있다.`,
		() =>
			`${ko.unit} 담당 변경으로 ${code} 장비의 관리 지역이 ${ko.region}으로 정해졌다.`,
		() =>
			`${value}번 창고가 받을 물품은 ${ko.region} 발 ${code}이며 분류는 ${ko.domain}이다.`,
		() =>
			`${day}일에는 ${ko.region}에서 ${code} 과제의 ${ko.domain} 검토가 열린다.`,
		() =>
			`표본 수 ${value}인 ${code} 실험을 맡은 곳은 ${ko.region} ${ko.domain} 팀이다.`,
		() =>
			`${code} 안내서 중 ${ko.domain} 관련 ${ko.unit}은 ${ko.region} 연구원이 관리한다.`,
		() =>
			`${ko.region} 시설 운영 규칙: ${hour}시부터 ${code} 절차, 대상은 ${ko.domain}이다.`,
		() =>
			`${value} 단위라는 값은 ${ko.region} ${ko.domain} 센서 ${code}에서 나왔다.`,
		() =>
			`${code} 안건의 새 일정은 ${day}일이다. 결정 장소는 ${ko.region} ${ko.domain} 회의였다.`,
		() =>
			`보관표에 따르면 ${ko.domain} 자원 ${code}는 ${value}번 ${ko.unit}, ${ko.region}에 있다.`,
		() =>
			`${hour}시에 시작하는 ${code} 과정은 ${ko.region}에서 진행되는 ${ko.domain} 실습이다.`,
		() =>
			`${ko.region} 수신 기록은 ${value}호 ${ko.domain} 보고서가 요청 ${code}로 전달됐음을 보여준다.`,
		() =>
			`${day}일 간격 알림 ${code}의 지역은 ${ko.region}, 주제는 ${ko.domain}으로 설정됐다.`,
		() =>
			`${value}로 제한되는 항목은 계약 ${code}의 ${ko.region} ${ko.domain} ${ko.unit}이다.`,
		() =>
			`${code} 변경 이력에 의해 ${value}번 기록의 현재 위치는 ${ko.region} ${ko.domain} 보관함이다.`,
	];
	const enTemplates = [
		() =>
			`The ${en.unit} ${code} reference value at the ${en.region} ${en.domain} station is ${value}.`,
		() =>
			`Inspection ${code} for ${en.domain} in ${en.region} finished at ${hour}:00 on day ${day}.`,
		() =>
			`The ${en.domain} coordinator assigned device ${code} to the ${en.region} ${en.unit}.`,
		() =>
			`Cargo ${code} from ${en.region} will arrive at ${en.domain} warehouse ${value}.`,
		() =>
			`Project ${code} has its next ${en.domain} review in ${en.region} on day ${day}.`,
		() =>
			`The ${en.region} team used ${value} samples for ${en.domain} experiment ${code}.`,
		() =>
			`Researcher ${en.region} owns the ${en.unit} section of ${en.domain} guide ${code}.`,
		() =>
			`After ${hour}:00, the ${en.region} ${en.domain} facility switches to procedure ${code}.`,
		() =>
			`Sensor ${code} measured ${value} units for ${en.domain} activity in ${en.region}.`,
		() =>
			`The ${en.region} meeting moved ${en.domain} item ${code} to day ${day}.`,
		() =>
			`Resource ${code} is stored at ${en.region} ${en.unit} ${value} for ${en.domain}.`,
		() =>
			`Course ${code} in ${en.region} starts its ${en.domain} exercise at ${hour}:00.`,
		() => `Request ${code} sent ${en.domain} report ${value} to ${en.region}.`,
		() =>
			`A user in ${en.region} scheduled ${en.domain} alert ${code} every ${day} days.`,
		() =>
			`Contract ${code} sets the ${en.region} ${en.domain} ${en.unit} limit to ${value}.`,
		() =>
			`Record ${value} moved to the ${en.region} ${en.domain} archive after change ${code}.`,
		() =>
			`Log ${code}: the ${en.domain} baseline in ${en.region} is ${value} for the ${en.unit}.`,
		() =>
			`The day-${day} ${en.domain} journal says ${en.region} task ${code} began at ${hour}:00.`,
		() =>
			`A change of ${en.unit} ownership placed device ${code} under the ${en.region} region.`,
		() =>
			`Warehouse ${value} expects item ${code} from ${en.region}, classified as ${en.domain}.`,
		() =>
			`On day ${day}, ${en.region} hosts the ${en.domain} review for assignment ${code}.`,
		() =>
			`${en.region}'s ${en.domain} team owns experiment ${code}, which contains ${value} samples.`,
		() =>
			`In guide ${code}, researcher ${en.region} maintains the ${en.domain} ${en.unit}.`,
		() =>
			`${en.region} facility rule: use procedure ${code} for ${en.domain} after ${hour}:00.`,
		() =>
			`The value of ${value} units came from sensor ${code} for ${en.domain} in ${en.region}.`,
		() =>
			`Item ${code} now falls on day ${day}, as decided by the ${en.region} ${en.domain} meeting.`,
		() =>
			`The storage table locates ${en.domain} resource ${code} at ${en.region} ${en.unit} ${value}.`,
		() =>
			`Starting at ${hour}:00, course ${code} teaches a ${en.domain} exercise in ${en.region}.`,
		() =>
			`${en.region}'s receipt confirms report ${value} for ${en.domain} arrived via request ${code}.`,
		() =>
			`Alert ${code} is configured for ${en.domain} in ${en.region} at a ${day}-day interval.`,
		() =>
			`The limited field in contract ${code} is the ${en.region} ${en.domain} ${en.unit}: ${value}.`,
		() =>
			`Change ${code} makes the ${en.region} ${en.domain} archive the current home of record ${value}.`,
	];
	return language === "ko"
		? koTemplates[templateIndex]()
		: enTemplates[templateIndex]();
}

export function normalizeForContamination(text: string): string {
	return text
		.normalize("NFKC")
		.toLocaleLowerCase("und")
		.replace(/[\p{P}\p{S}\s]+/gu, "")
		.trim();
}

export function buildScaleCorpus(options: {
	language: string;
	baseFacts: ScaleFact[];
	referenceTexts: string[];
	targetSize: number;
}): { facts: ScaleFact[]; receipt: ContaminationReceipt } {
	const { language, baseFacts, referenceTexts, targetSize } = options;
	if (!Number.isSafeInteger(targetSize) || targetSize < baseFacts.length) {
		throw new Error(
			`targetSize must be an integer >= base size (${baseFacts.length})`,
		);
	}
	const referenceNorms = referenceTexts
		.map(normalizeForContamination)
		.filter((value) => value.length >= 8);
	const facts = [...baseFacts];
	for (let index = 0; facts.length < targetSize; index++) {
		facts.push({
			id: `scale-${language}-${String(index).padStart(6, "0")}`,
			statement: generatedStatement(language, index),
		});
	}
	const ids = new Set<string>();
	const statements = new Set<string>();
	let baseDuplicateStatements = 0;
	let generatedStatementCollisions = 0;
	let exactReferenceCollisions = 0;
	let referenceSubstringCollisions = 0;
	const referenceSet = new Set(referenceNorms);
	for (const fact of facts) {
		const normalized = normalizeForContamination(fact.statement);
		if (ids.has(fact.id)) {
			throw new Error(`scale corpus contains duplicate id: ${fact.id}`);
		}
		ids.add(fact.id);
		if (statements.has(normalized)) {
			if (fact.id.startsWith("scale-")) generatedStatementCollisions++;
			else baseDuplicateStatements++;
		}
		statements.add(normalized);
		if (fact.id.startsWith("scale-")) {
			if (referenceSet.has(normalized)) exactReferenceCollisions++;
			if (
				referenceNorms.some(
					(reference) =>
						normalized.includes(reference) || reference.includes(normalized),
				)
			) {
				referenceSubstringCollisions++;
			}
		}
	}
	if (generatedStatementCollisions > 0) {
		throw new Error(
			"generated scale corpus contains normalized statement collisions",
		);
	}
	if (exactReferenceCollisions > 0 || referenceSubstringCollisions > 0) {
		throw new Error("generated scale corpus overlaps labeled reference text");
	}
	const corpusSha256 = createHash("sha256")
		.update(facts.map(({ id, statement }) => `${id}\0${statement}\n`).join(""))
		.digest("hex");
	return {
		facts,
		receipt: {
			targetSize,
			baseSize: baseFacts.length,
			generatedSize: targetSize - baseFacts.length,
			uniqueIds: ids.size,
			uniqueStatements: statements.size,
			baseDuplicateStatements,
			generatedStatementCollisions,
			exactReferenceCollisions,
			referenceSubstringCollisions,
			domainCount: KO_DOMAINS.length,
			templateFamilyCount: TEMPLATE_FAMILY_COUNT,
			construction: "deterministic-multi-domain-diagnostic",
			corpusSha256,
		},
	};
}
