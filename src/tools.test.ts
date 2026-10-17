import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { TOOLS, _resetSpaceCacheForTests, callTool } from "./tools.js";

const realFetch = global.fetch;

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];

/** Queue JSON responses (in order); each call to fetch consumes one. */
function queue(...bodies: unknown[]) {
	calls = [];
	let i = 0;
	global.fetch = mock((url: string, init?: RequestInit) => {
		calls.push({ url: String(url), init });
		const body = bodies[Math.min(i++, bodies.length - 1)];
		const text = typeof body === "string" ? body : JSON.stringify(body ?? {});
		return Promise.resolve({
			ok: true,
			status: 200,
			text: async () => text,
			json: async () => JSON.parse(text),
		} as Response);
	}) as unknown as typeof fetch;
}

const body = (i: number) => JSON.parse(String(calls[i].init?.body));
const OBJ = "7d2e7f8a-4c3b-4e1d-9f0a-123456789abc";

beforeEach(() => {
	process.env.CAPACITIES_API_KEY = "test-key";
	_resetSpaceCacheForTests();
});
afterEach(() => {
	global.fetch = realFetch;
});

describe("tool registry", () => {
	test("has unique names and object input schemas", () => {
		const names = TOOLS.map((t) => t.name);
		expect(new Set(names).size).toBe(names.length);
		for (const t of TOOLS) expect(t.inputSchema.type).toBe("object");
	});

	test("does not register legacy beta tools", () => {
		const names = TOOLS.map((t) => t.name);
		for (const legacy of [
			"capacities_list_spaces",
			"capacities_get_space_info",
			"capacities_save_weblink",
			"capacities_save_to_daily_note",
		]) {
			expect(names).not.toContain(legacy);
		}
	});

	test("spaceId is never required", () => {
		for (const t of TOOLS)
			expect(t.inputSchema.required).not.toContain("spaceId");
	});

	test("rejects unknown tools and invalid input", async () => {
		await expect(callTool("nope", {})).rejects.toThrow("Unknown tool");
		await expect(callTool("capacities_search", {})).rejects.toThrow(
			"Invalid arguments for capacities_search: query",
		);
		await expect(
			callTool("capacities_create_task", { title: "x", status: "bogus" }),
		).rejects.toThrow("status");
	});
});

describe("get_object_type_shape", () => {
	const structures = {
		structures: [
			{
				id: "RootPage",
				title: "Page",
				pluralName: "Pages",
				labelColor: "x",
				propertyDefinitions: [{ id: "title" }],
				collections: [],
			},
			{
				id: "MediaImage",
				title: "Image",
				pluralName: "Images",
				labelColor: "y",
				propertyDefinitions: [],
				collections: [],
			},
		],
	};

	test("calls GET /space/structures", async () => {
		queue(structures);
		const out = JSON.parse(
			await callTool("capacities_get_object_type_shape", {}),
		);
		expect(calls[0].url).toBe("https://api.capacities.io/space/structures");
		expect(out.structures).toHaveLength(2);
	});

	test("summary + excludeMediaTypes", async () => {
		queue(structures);
		const out = JSON.parse(
			await callTool("capacities_get_object_type_shape", {
				summary: true,
				excludeMediaTypes: true,
			}),
		);
		expect(out.structures).toEqual([
			{
				id: "RootPage",
				title: "Page",
				pluralName: "Pages",
				labelColor: "x",
				propertyCount: 1,
				collections: [],
			},
		]);
	});
});

describe("create_task / create_page", () => {
	test("quotes the title so colons survive and sends no extra call when title matches", async () => {
		queue({
			id: OBJ,
			properties: { title: { type: "title", title: { value: "Fix: bug #1" } } },
		});
		await callTool("capacities_create_task", {
			title: "Fix: bug #1",
			status: "todo",
			priority: "high",
		});
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe("https://api.capacities.io/object/markdown");
		expect(body(0).structureId).toBe("RootTask");
		expect(body(0).markdown).toBe(
			'---\ntitle: "Fix: bug #1"\nstatus: todo\npriority: high\n---\n',
		);
	});

	test("patches the title when the API drops it", async () => {
		queue(
			{ id: OBJ, properties: {} },
			{
				id: OBJ,
				properties: { title: { type: "title", title: { value: "My task" } } },
			},
		);
		const out = JSON.parse(
			await callTool("capacities_create_task", { title: "My task" }),
		);
		expect(calls).toHaveLength(2);
		expect(calls[1].init?.method).toBe("PATCH");
		expect(body(1)).toEqual({
			id: OBJ,
			markdown: '---\ntitle: "My task"\n---\n',
		});
		expect(out.note).toContain("Title was applied");
	});

	test("create_page works without spaceId", async () => {
		queue({
			id: OBJ,
			properties: { title: { type: "title", title: { value: "P" } } },
		});
		await callTool("capacities_create_page", { title: "P", mdText: "hello" });
		expect(body(0).structureId).toBe("RootPage");
		expect(body(0).markdown).toContain("hello");
	});
});

describe("encoding and spaceId", () => {
	test("read_object_content encodes ids", async () => {
		queue("# md");
		await callTool("capacities_read_object_content", { objectId: "a/b?c=d" });
		expect(calls[0].url).toBe(
			"https://api.capacities.io/object/markdown?id=a%2Fb%3Fc%3Dd",
		);
	});

	test("get_object_link resolves spaceId via GET /space when omitted", async () => {
		queue({ id: OBJ, structureId: "RootPage" }, { id: "space-1", title: "S" });
		const out = JSON.parse(
			await callTool("capacities_get_object_link", { objectId: OBJ }),
		);
		expect(calls[1].url).toBe("https://api.capacities.io/space");
		expect(out.appLink).toBe(`https://app.capacities.io/space-1/${OBJ}`);
	});

	test("get_object_link uses provided spaceId without extra call", async () => {
		queue({ id: OBJ });
		const out = JSON.parse(
			await callTool("capacities_get_object_link", {
				objectId: OBJ,
				spaceId: "sp",
			}),
		);
		expect(calls).toHaveLength(1);
		expect(out.appLink).toBe(`https://app.capacities.io/sp/${OBJ}`);
	});
});

describe("unchanged tools", () => {
	test("search", async () => {
		queue({ results: [] });
		await callTool("capacities_search", {
			query: "x",
			structureIds: ["RootPage"],
			limit: 5,
		});
		expect(calls[0].url).toBe("https://api.capacities.io/objects/search");
		expect(body(0)).toEqual({
			query: "x",
			structureIds: ["RootPage"],
			limit: 5,
		});
	});

	test("append_to_daily_note normalizes date", async () => {
		queue("");
		await callTool("capacities_append_to_daily_note", {
			mdText: "hi",
			date: "2026-07-16",
		});
		expect(calls[0].url).toBe(
			"https://api.capacities.io/blocks/daily-note/append",
		);
		expect(body(0)).toEqual({
			markdown: "hi",
			date: "2026-07-16T00:00:00.000Z",
		});
	});

	test("update_object wraps bare yaml", async () => {
		queue({ id: OBJ });
		await callTool("capacities_update_object", {
			objectId: OBJ,
			mdText: "status: done",
		});
		expect(calls[0].init?.method).toBe("PATCH");
		expect(body(0).markdown).toBe("---\nstatus: done\n---\n");
	});

	test("append_to_object", async () => {
		queue({ id: OBJ });
		await callTool("capacities_append_to_object", {
			objectId: OBJ,
			mdText: "a\nb",
		});
		expect(calls[0].url).toBe("https://api.capacities.io/blocks/append");
		expect(body(0).blocks).toHaveLength(2);
	});
});
