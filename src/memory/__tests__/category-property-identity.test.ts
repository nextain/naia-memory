import { describe, expect, it } from "vitest";
import {
	MEMORY_PROPERTY_IDENTITY,
	MEMORY_PROPERTY_IDS,
} from "../memory-identity-ontology.js";
import { findStructuredSupersessions } from "../structured-facts.js";
import type { Fact, StructuredFact } from "../types.js";

function structured(propertyId: string, property: string, value: string): StructuredFact {
	return {
		subject: "user",
		subjectId: "person:self",
		property,
		propertyId,
		value,
		polarity: "affirmed",
		cardinality: "single",
	};
}

function stored(id: string, fields: StructuredFact): Fact {
	return {
		id,
		content: `${fields.property}: ${fields.value}`,
		entities: [],
		topics: [],
		createdAt: 1,
		updatedAt: 1,
		importance: 0.7,
		recallCount: 0,
		lastAccessed: 1,
		strength: 0.8,
		sourceEpisodes: ["e1"],
		status: "active",
		structured: fields,
	} as Fact;
}

describe("replacement identity for category property IDs", () => {
	it("declares every vocabulary property ID", () => {
		expect(Object.keys(MEMORY_PROPERTY_IDENTITY).sort()).toEqual([...MEMORY_PROPERTY_IDS].sort());
	});

	it("does not replace a different property that shares a category ID", () => {
		// az3 ko-01: meeting tea and coffee-bean sourcing both became beverage-consumption.
		const tea = stored("tea", structured("profile:beverage-consumption", "차 종류", "보리차"));
		const beans = structured("profile:beverage-consumption", "커피 원두 출처", "동료가 주문");
		expect(findStructuredSupersessions([tea], beans)).toEqual([]);
	});

	it("replaces a value under a category ID when the property label is the same", () => {
		// az3 ko-03: gift set count 36 -> 63 under plan:activity.
		const before = stored("sets", structured("plan:activity", "답례품 수량", "36세트"));
		const after = structured("plan:activity", " 답례품  수량", "63세트");
		expect(findStructuredSupersessions([before], after).map((f) => f.id)).toEqual(["sets"]);
	});

	it("replaces an attribute ID across languages", () => {
		const before = stored("home", structured("profile:residence", "거주지", "서울"));
		const after = structured("profile:residence", "residence", "Busan");
		expect(findStructuredSupersessions([before], after).map((f) => f.id)).toEqual(["home"]);
	});

	it("treats an ID outside the vocabulary as a category", () => {
		const before = stored("x", structured("health:allergy", "allergy", "peanut"));
		expect(findStructuredSupersessions([before], structured("health:allergy", "알레르기", "shrimp"))).toEqual([]);
		expect(findStructuredSupersessions([before], structured("health:allergy", "allergy", "shrimp")).map((f) => f.id)).toEqual(["x"]);
	});
});
