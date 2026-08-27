import { describe, expect, it } from "vitest";
import { resolveDeleteVerifierConfig } from "./delete-verifier-config.js";

describe("delete verifier production configuration", () => {
	it("fails closed when explicit verifier credentials are absent", () => {
		expect(
			resolveDeleteVerifierConfig({
				extractorBaseURL: "https://extractor.example/v1",
				extractorModel: "extractor-model",
				extractorProvider: "extractor-provider",
				environment: {},
			}),
		).toBeUndefined();
	});

	it("fails closed when the verifier shares the extractor endpoint", () => {
		expect(
			resolveDeleteVerifierConfig({
				extractorBaseURL: "https://shared.example/v1/",
				extractorModel: "extractor-model",
				extractorProvider: "extractor-provider",
				environment: {
					DELETE_VERIFIER_API_KEY: "separate-key",
					DELETE_VERIFIER_BASE_URL: "https://shared.example/v1",
					DELETE_VERIFIER_MODEL: "verifier-model",
					DELETE_VERIFIER_PROVIDER: "verifier-provider",
				},
			}),
		).toBeUndefined();
	});

	it("fails closed when the verifier shares the extractor model", () => {
		expect(
			resolveDeleteVerifierConfig({
				extractorBaseURL: "https://extractor.example/v1",
				extractorModel: "shared-model",
				extractorProvider: "extractor-provider",
				environment: {
					DELETE_VERIFIER_API_KEY: "separate-key",
					DELETE_VERIFIER_BASE_URL: "https://verifier.example/v1",
					DELETE_VERIFIER_MODEL: "shared-model",
					DELETE_VERIFIER_PROVIDER: "verifier-provider",
				},
			}),
		).toBeUndefined();
	});

	it("fails closed when the shared model differs only by case", () => {
		expect(
			resolveDeleteVerifierConfig({
				extractorBaseURL: "https://extractor.example/v1",
				extractorModel: "Shared-Model",
				extractorProvider: "extractor-provider",
				environment: {
					DELETE_VERIFIER_API_KEY: "separate-key",
					DELETE_VERIFIER_BASE_URL: "https://verifier.example/v1",
					DELETE_VERIFIER_MODEL: "shared-model",
					DELETE_VERIFIER_PROVIDER: "verifier-provider",
				},
			}),
		).toBeUndefined();
	});

	it("fails closed when the verifier model is not explicit", () => {
		expect(
			resolveDeleteVerifierConfig({
				extractorBaseURL: "https://extractor.example/v1",
				extractorModel: "extractor-model",
				extractorProvider: "extractor-provider",
				environment: {
					DELETE_VERIFIER_API_KEY: "separate-key",
					DELETE_VERIFIER_BASE_URL: "https://verifier.example/v1",
				},
			}),
		).toBeUndefined();
	});

	it("fails closed when the verifier shares the extractor provider", () => {
		expect(
			resolveDeleteVerifierConfig({
				extractorBaseURL: "https://extractor.example/v1",
				extractorModel: "extractor-model",
				extractorProvider: "shared-provider",
				environment: {
					DELETE_VERIFIER_API_KEY: "separate-key",
					DELETE_VERIFIER_BASE_URL: "https://verifier.example/v1",
					DELETE_VERIFIER_MODEL: "verifier-model",
					DELETE_VERIFIER_PROVIDER: "SHARED-PROVIDER",
				},
			}),
		).toBeUndefined();
	});

	it("accepts an explicit distinct verifier endpoint", () => {
		expect(
			resolveDeleteVerifierConfig({
				extractorBaseURL: "https://extractor.example/v1",
				extractorModel: "extractor-model",
				extractorProvider: "extractor-provider",
				environment: {
					DELETE_VERIFIER_API_KEY: "verifier-key",
					DELETE_VERIFIER_BASE_URL: "https://verifier.example/v1",
					DELETE_VERIFIER_MODEL: "verifier-model",
					DELETE_VERIFIER_PROVIDER: "verifier-provider",
				},
			}),
		).toEqual({
			apiKey: "verifier-key",
			baseURL: "https://verifier.example/v1",
			model: "verifier-model",
		});
	});
});
