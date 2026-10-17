import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
	CapacitiesApiError,
	buildQuery,
	getApiKey,
	makeApiRequest,
} from "./api.js";

const realFetch = global.fetch;

function mockFetch(response: Partial<Response> | Record<string, unknown>) {
	const fn = mock(() => Promise.resolve(response as Response));
	global.fetch = fn as unknown as typeof fetch;
	return fn;
}

describe("API utilities", () => {
	beforeEach(() => {
		Reflect.deleteProperty(process.env, "CAPACITIES_API_KEY");
	});
	afterEach(() => {
		global.fetch = realFetch;
	});

	describe("getApiKey", () => {
		test("returns API key from environment", () => {
			process.env.CAPACITIES_API_KEY = "test-api-key";
			expect(getApiKey()).toBe("test-api-key");
		});

		test("throws when API key is not set", () => {
			expect(() => getApiKey()).toThrow(
				"CAPACITIES_API_KEY environment variable is required",
			);
		});
	});

	describe("buildQuery", () => {
		test("encodes values and skips undefined", () => {
			expect(buildQuery({ id: "a b&c=d", cursor: undefined, n: 5 })).toBe(
				"?id=a+b%26c%3Dd&n=5",
			);
		});
		test("returns empty string with no params", () => {
			expect(buildQuery({})).toBe("");
		});
	});

	describe("makeApiRequest", () => {
		test("sends auth headers", async () => {
			process.env.CAPACITIES_API_KEY = "test-api-key";
			const response = { ok: true };
			const fetchMock = mockFetch(response);

			expect(await makeApiRequest("/test-endpoint")).toBe(response as Response);
			expect(fetchMock).toHaveBeenCalledWith(
				"https://api.capacities.io/test-endpoint",
				{
					headers: {
						Authorization: "Bearer test-api-key",
						"Content-Type": "application/json",
					},
				},
			);
		});

		test("passes through additional options", async () => {
			process.env.CAPACITIES_API_KEY = "test-api-key";
			const fetchMock = mockFetch({ ok: true });
			await makeApiRequest("/test", { method: "POST", body: "{}" });
			expect(fetchMock).toHaveBeenCalledWith("https://api.capacities.io/test", {
				method: "POST",
				body: "{}",
				headers: {
					Authorization: "Bearer test-api-key",
					"Content-Type": "application/json",
				},
			});
		});

		test("does not leak raw response bodies in errors", async () => {
			process.env.CAPACITIES_API_KEY = "test-api-key";
			mockFetch({
				ok: false,
				status: 400,
				statusText: "Bad Request",
				text: async () => "SECRET-INTERNAL-DETAIL stack trace",
			});
			const err = await makeApiRequest("/test?id=abc").catch((e) => e);
			expect(err).toBeInstanceOf(CapacitiesApiError);
			expect(err.message).toBe(
				"Capacities API error: 400 Bad Request on /test",
			);
			expect(err.message).not.toContain("SECRET");
			expect(err.message).not.toContain("abc");
		});

		test("includes only a safe error code from JSON bodies", async () => {
			process.env.CAPACITIES_API_KEY = "test-api-key";
			mockFetch({
				ok: false,
				status: 400,
				statusText: "Bad Request",
				text: async () =>
					JSON.stringify({
						code: "cap_invalid_input",
						message: "leaky detail",
					}),
			});
			const err = await makeApiRequest("/test").catch((e) => e);
			expect(err.message).toContain("cap_invalid_input");
			expect(err.message).not.toContain("leaky");
		});

		test("handles 401", async () => {
			process.env.CAPACITIES_API_KEY = "test-api-key";
			mockFetch({
				ok: false,
				status: 401,
				statusText: "Unauthorized",
				text: async () => "",
			});
			const err = await makeApiRequest("/x").catch((e) => e);
			expect(err.status).toBe(401);
			expect(err.message).toContain("authentication failed (401)");
			expect(err.message).toContain("CAPACITIES_API_KEY");
		});

		test("handles 403", async () => {
			process.env.CAPACITIES_API_KEY = "test-api-key";
			mockFetch({
				ok: false,
				status: 403,
				statusText: "Forbidden",
				text: async () => "",
			});
			const err = await makeApiRequest("/x").catch((e) => e);
			expect(err.status).toBe(403);
			expect(err.message).toContain("forbidden (403)");
		});

		test("handles 429 and 5xx", async () => {
			process.env.CAPACITIES_API_KEY = "test-api-key";
			mockFetch({
				ok: false,
				status: 429,
				statusText: "Too Many",
				text: async () => "",
			});
			expect((await makeApiRequest("/x").catch((e) => e)).message).toContain(
				"rate limit",
			);
			mockFetch({
				ok: false,
				status: 500,
				statusText: "ISE",
				text: async () => "boom",
			});
			const err = await makeApiRequest("/x").catch((e) => e);
			expect(err.message).toContain("500");
			expect(err.message).not.toContain("boom");
		});
	});
});
