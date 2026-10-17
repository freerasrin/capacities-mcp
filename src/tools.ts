import { z } from "zod";

import { buildQuery, makeApiRequest } from "./api.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const id = (what: string) => z.string().trim().min(1, `${what} is required`);

/**
 * spaceId is advisory only: Capacities v1 tokens are scoped to a single space,
 * so no endpoint takes it. It is only used to build app links.
 */
const spaceIdOptional = z.string().trim().min(1).optional();

type ToolHandler = (args: never) => Promise<string>;

interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: {
		type: "object";
		properties: Record<string, unknown>;
		required: string[];
	};
	schema: z.ZodTypeAny;
	handler: ToolHandler;
}

const spaceIdProp = {
	type: "string",
	description:
		"Optional and advisory. Capacities API tokens are scoped to one space, so this is not needed; it is only used to build app links.",
};

export async function parseResponse(
	response: Response,
	successMessage: string,
): Promise<string> {
	const responseText = await response.text();
	if (!responseText.trim())
		return `Success: ${successMessage} (no response data)`;
	try {
		return JSON.stringify(JSON.parse(responseText), null, 2);
	} catch {
		return `${successMessage}. Response: ${responseText}`;
	}
}

async function postAndReturn(
	endpoint: string,
	body: Record<string, unknown>,
	successMessage: string,
): Promise<string> {
	const response = await makeApiRequest(endpoint, {
		method: "POST",
		body: JSON.stringify(body),
	});
	return parseResponse(response, successMessage);
}

async function getJson(endpoint: string): Promise<unknown> {
	const response = await makeApiRequest(endpoint);
	const text = await response.text();
	if (!text.trim()) return null;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

/** Convert plain text / simple markdown to Capacities TextBlocks for the blocks API */
export function markdownToBlocks(
	markdown: string,
): Array<Record<string, unknown>> {
	const blocks: Array<Record<string, unknown>> = [];
	for (const line of markdown.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		blocks.push({
			type: "TextBlock",
			tokens: [{ type: "TextToken", text: trimmed, style: {} }],
			hierarchy: { key: "Base", val: 0 },
		});
	}
	if (blocks.length === 0) {
		blocks.push({
			type: "TextBlock",
			tokens: [{ type: "TextToken", text: markdown, style: {} }],
			hierarchy: { key: "Base", val: 0 },
		});
	}
	return blocks;
}

/**
 * Normalizes a user-supplied date (plain "YYYY-MM-DD" or full ISO) to the
 * UTC-midnight ISO 8601 format the v1 API expects for daily notes.
 */
export function normalizeDailyNoteDate(date?: string): string | undefined {
	if (!date) return undefined;
	const trimmed = date.trim();
	if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
		return `${trimmed}T00:00:00.000Z`;
	}
	const parsed = new Date(trimmed);
	if (Number.isNaN(parsed.getTime())) {
		throw new Error(
			`Invalid date "${date}". Use "YYYY-MM-DD" or a full ISO 8601 timestamp.`,
		);
	}
	return new Date(
		Date.UTC(
			parsed.getUTCFullYear(),
			parsed.getUTCMonth(),
			parsed.getUTCDate(),
		),
	).toISOString();
}

/** Quote a scalar for YAML frontmatter (JSON strings are valid YAML double-quoted scalars). */
function yamlString(value: string): string {
	return JSON.stringify(value);
}

function readTitle(data: unknown): string | null | undefined {
	if (!data || typeof data !== "object") return undefined;
	const props = (data as { properties?: Record<string, unknown> }).properties;
	const title = props?.title as
		| { title?: { value?: string | null } }
		| undefined;
	if (!title) return undefined;
	return title.title?.value ?? null;
}

/**
 * Create an object from markdown and make sure the title actually landed.
 *
 * Root cause of the old "title silently dropped" bug: the title was passed as
 * an unquoted YAML scalar in frontmatter, so titles containing ": ", "#", etc.
 * were mis-parsed, and the API does not report a failure when a frontmatter
 * key is ignored. We now (1) quote the title, and (2) verify the returned
 * title, issuing a PATCH to set it if it is missing or different.
 */
async function createWithTitle(
	structureId: string,
	title: string,
	frontmatterLines: string[],
	body: string,
	successMessage: string,
): Promise<string> {
	const markdown = `---\n${[`title: ${yamlString(title)}`, ...frontmatterLines].join("\n")}\n---\n${body}`;
	const response = await makeApiRequest("/object/markdown", {
		method: "POST",
		body: JSON.stringify({ structureId, markdown }),
	});
	const text = await response.text();
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		return text.trim()
			? `${successMessage}. Response: ${text}`
			: successMessage;
	}

	const created = (data as { id?: string } | null)?.id;
	const returnedTitle = readTitle(data);
	if (created && returnedTitle !== title) {
		const patched = await makeApiRequest("/object/markdown", {
			method: "PATCH",
			body: JSON.stringify({
				id: created,
				markdown: `---\ntitle: ${yamlString(title)}\n---\n`,
			}),
		});
		const patchedText = await patched.text();
		try {
			return JSON.stringify(
				{
					...JSON.parse(patchedText),
					note: "Title was applied via follow-up update",
				},
				null,
				2,
			);
		} catch {
			return JSON.stringify(data, null, 2);
		}
	}
	return JSON.stringify(data, null, 2);
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const searchSchema = z.object({
	query: id("query"),
	structureIds: z.array(id("structureId")).optional(),
	limit: z.number().int().min(1).max(50).optional(),
});

const readObjectSchema = z.object({
	objectId: id("objectId"),
	spaceId: spaceIdOptional,
});

const getObjectLinkSchema = readObjectSchema;

const appendDailySchema = z.object({
	mdText: id("mdText"),
	date: z.string().optional(),
	noTimeStamp: z.boolean().optional(),
});

const getDailySchema = z.object({ date: z.string().optional() });

const createPageSchema = z.object({
	spaceId: spaceIdOptional,
	title: id("title"),
	mdText: z.string().optional(),
});

const isoDate = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}/, "must be ISO 8601 (YYYY-MM-DD)");

const createTaskSchema = z.object({
	spaceId: spaceIdOptional,
	title: id("title"),
	status: z.enum(["todo", "done"]).optional(),
	priority: z.enum(["low", "medium", "high"]).optional(),
	dueDate: isoDate.optional(),
	deadlineDate: isoDate.optional(),
	mdText: z.string().optional(),
});

const createObjectSchema = z.object({
	spaceId: spaceIdOptional,
	structureId: id("structureId"),
	mdText: id("mdText"),
});

const appendToObjectSchema = z.object({
	objectId: id("objectId"),
	spaceId: spaceIdOptional,
	mdText: id("mdText"),
});

const updateObjectSchema = appendToObjectSchema;

const typeShapeSchema = z.object({
	summary: z.boolean().optional(),
	structureIds: z.array(id("structureId")).optional(),
	excludeMediaTypes: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

type Args<S extends z.ZodTypeAny> = z.infer<S>;

async function handleSearch(args: Args<typeof searchSchema>) {
	const body: Record<string, unknown> = { query: args.query };
	if (args.structureIds && args.structureIds.length > 0) {
		body.structureIds = args.structureIds;
	}
	if (args.limit) body.limit = args.limit;
	return postAndReturn("/objects/search", body, "Search completed");
}

async function handleReadObjectContent(args: Args<typeof readObjectSchema>) {
	const response = await makeApiRequest(
		`/object/markdown${buildQuery({ id: args.objectId })}`,
	);
	const responseText = await response.text();
	if (!responseText.trim()) return "Object content is empty";
	// The endpoint may return raw markdown or JSON — handle both
	try {
		return JSON.stringify(JSON.parse(responseText), null, 2);
	} catch {
		return responseText;
	}
}

async function handleAppendToDailyNote(args: Args<typeof appendDailySchema>) {
	const body: Record<string, unknown> = { markdown: args.mdText };
	const date = normalizeDailyNoteDate(args.date);
	if (date) body.date = date;
	if (args.noTimeStamp !== undefined) body.noTimeStamp = args.noTimeStamp;
	return postAndReturn(
		"/blocks/daily-note/append",
		body,
		"Content appended to daily note (processed asynchronously — may take a moment to appear)",
	);
}

async function handleGetDailyNote(args: Args<typeof getDailySchema>) {
	const normalizedDate = normalizeDailyNoteDate(args.date);
	const searchDate = normalizedDate
		? normalizedDate.slice(0, 10)
		: new Date().toISOString().slice(0, 10);

	const searchResponse = await makeApiRequest("/objects/search", {
		method: "POST",
		body: JSON.stringify({
			query: searchDate,
			structureIds: ["RootDailyNote"],
		}),
	});
	const searchData = (await searchResponse.json()) as {
		results?: Array<{ id: string; structureId: string; title: string }>;
	};

	const match = searchData.results?.find((r) =>
		r.title?.startsWith(searchDate),
	);
	if (!match) {
		return JSON.stringify(
			{
				date: searchDate,
				found: false,
				message:
					"No daily note exists yet for this date. capacities_append_to_daily_note will create it on first write.",
			},
			null,
			2,
		);
	}

	const content = await getJson(
		`/object/markdown${buildQuery({ id: match.id })}`,
	);
	return JSON.stringify(
		{ date: searchDate, found: true, id: match.id, content },
		null,
		2,
	);
}

async function handleCreatePage(args: Args<typeof createPageSchema>) {
	return createWithTitle(
		"RootPage",
		args.title,
		[],
		args.mdText ?? "",
		"Page created",
	);
}

async function handleCreateTask(args: Args<typeof createTaskSchema>) {
	const lines: string[] = [];
	if (args.status) lines.push(`status: ${args.status}`);
	if (args.priority) lines.push(`priority: ${args.priority}`);
	if (args.dueDate) lines.push(`dueDate: ${args.dueDate}`);
	if (args.deadlineDate) lines.push(`deadlineDate: ${args.deadlineDate}`);
	return createWithTitle(
		"RootTask",
		args.title,
		lines,
		args.mdText ?? "",
		"Task created",
	);
}

async function handleCreateObject(args: Args<typeof createObjectSchema>) {
	return postAndReturn(
		"/object/markdown",
		{ structureId: args.structureId, markdown: args.mdText },
		"Object created",
	);
}

async function handleAppendToObject(args: Args<typeof appendToObjectSchema>) {
	return postAndReturn(
		"/blocks/append",
		{
			id: args.objectId,
			position: { type: "end" },
			blocks: markdownToBlocks(args.mdText),
		},
		"Content appended to object",
	);
}

async function handleUpdateObject(args: Args<typeof updateObjectSchema>) {
	// Ensure the mdText is wrapped in frontmatter delimiters
	const markdown = args.mdText.trimStart().startsWith("---")
		? args.mdText
		: `---\n${args.mdText}\n---\n`;
	const response = await makeApiRequest("/object/markdown", {
		method: "PATCH",
		body: JSON.stringify({ id: args.objectId, markdown }),
	});
	return parseResponse(response, "Object updated");
}

let cachedSpaceId: string | undefined;

/** Resolve the token's space id (cached) for building app links. */
async function resolveSpaceId(provided?: string): Promise<string | undefined> {
	if (provided) return provided;
	if (cachedSpaceId) return cachedSpaceId;
	try {
		const data = (await getJson("/space")) as { id?: string } | null;
		cachedSpaceId = data?.id;
	} catch {
		// advisory only — link is optional
	}
	return cachedSpaceId;
}

export function _resetSpaceCacheForTests() {
	cachedSpaceId = undefined;
}

async function handleGetObjectLink(args: Args<typeof getObjectLinkSchema>) {
	const objectData = await getJson(
		`/object${buildQuery({ id: args.objectId })}`,
	);
	const spaceId = await resolveSpaceId(args.spaceId);
	return JSON.stringify(
		{
			objectId: args.objectId,
			spaceId,
			appLink: spaceId
				? `https://app.capacities.io/${encodeURIComponent(spaceId)}/${encodeURIComponent(args.objectId)}`
				: undefined,
			objectData,
		},
		null,
		2,
	);
}

async function handleGetObjectTypeShape(args: Args<typeof typeShapeSchema>) {
	const data = (await getJson("/space/structures")) as {
		structures?: Array<{
			id: string;
			title: string;
			pluralName: string;
			labelColor: string;
			propertyDefinitions?: unknown[];
			collections?: Array<{ id: string; title: string }>;
		}>;
	} | null;
	if (!data?.structures) return JSON.stringify(data, null, 2);

	let structures = data.structures;
	if (args.structureIds && args.structureIds.length > 0) {
		const wanted = new Set(args.structureIds);
		structures = structures.filter((s) => wanted.has(s.id));
	}
	if (args.excludeMediaTypes) {
		structures = structures.filter((s) => !s.id.startsWith("Media"));
	}
	if (args.summary) {
		return JSON.stringify(
			{
				structures: structures.map((s) => ({
					id: s.id,
					title: s.title,
					pluralName: s.pluralName,
					labelColor: s.labelColor,
					propertyCount: s.propertyDefinitions?.length ?? 0,
					collections: s.collections ?? [],
				})),
			},
			null,
			2,
		);
	}
	return JSON.stringify({ structures }, null, 2);
}

// --- Net-new v1 tools -------------------------------------------------------

const deleteObjectSchema = z.object({
	objectId: id("objectId"),
	hardDelete: z.boolean().optional(),
});

const createFromUrlSchema = z.object({
	url: z.string().trim().url("url must be a valid URL"),
	title: z.string().min(1).optional(),
	description: z.string().optional(),
	mdText: z.string().max(200000).optional(),
});

const pagination = {
	cursor: z.string().trim().min(1).optional(),
	pageSize: z.number().int().min(1).max(100).optional(),
};

const listByTypeSchema = z.object({
	structureId: id("structureId"),
	...pagination,
});
const listByTagSchema = z.object({ tagId: id("tagId"), ...pagination });
const listByCollectionSchema = z.object({
	collectionId: id("collectionId"),
	...pagination,
});

const updateBlockSchema = z
	.object({
		objectId: id("objectId"),
		blockId: id("blockId"),
		propertyId: z.string().trim().min(1).optional(),
		text: z.string().min(1).optional(),
		block: z
			.object({ type: z.string().min(1) })
			.passthrough()
			.optional(),
	})
	.refine((v) => (v.text === undefined) !== (v.block === undefined), {
		message: "provide exactly one of 'text' or 'block'",
		path: ["text"],
	});

const deleteBlockSchema = z.object({
	objectId: id("objectId"),
	blockId: id("blockId"),
});

const getSpaceSchema = z.object({});

async function handleDeleteObject(args: Args<typeof deleteObjectSchema>) {
	const response = await makeApiRequest(
		`/object${buildQuery({ id: args.objectId, hardDelete: args.hardDelete })}`,
		{ method: "DELETE" },
	);
	return parseResponse(
		response,
		args.hardDelete
			? "Object permanently deleted"
			: "Object moved to trash (pass hardDelete=true to delete permanently)",
	);
}

async function handleCreateFromUrl(args: Args<typeof createFromUrlSchema>) {
	const body: Record<string, unknown> = { url: args.url };
	const properties: Record<string, unknown> = {};
	if (args.title !== undefined) {
		properties.title = { type: "title", title: { value: args.title } };
	}
	if (args.description !== undefined) {
		properties.description = {
			type: "text",
			text: { value: args.description },
		};
	}
	if (Object.keys(properties).length > 0) body.properties = properties;
	if (args.mdText) body.markdown = args.mdText;
	return postAndReturn("/object/url", body, "Object created from URL");
}

async function listObjects(
	endpoint: string,
	objectId: string,
	args: { cursor?: string; pageSize?: number },
) {
	const response = await makeApiRequest(
		`${endpoint}${buildQuery({ id: objectId, cursor: args.cursor, pageSize: args.pageSize })}`,
	);
	return parseResponse(response, "Objects listed");
}

async function handleListByType(args: Args<typeof listByTypeSchema>) {
	return listObjects("/objects/structure", args.structureId, args);
}
async function handleListByTag(args: Args<typeof listByTagSchema>) {
	return listObjects("/objects/tag", args.tagId, args);
}
async function handleListByCollection(
	args: Args<typeof listByCollectionSchema>,
) {
	return listObjects("/objects/collection", args.collectionId, args);
}

async function handleUpdateBlock(args: Args<typeof updateBlockSchema>) {
	const block =
		args.block ??
		({
			type: "TextBlock",
			tokens: [{ type: "TextToken", text: args.text, style: {} }],
			hierarchy: { key: "Base", val: 0 },
		} as Record<string, unknown>);
	const body: Record<string, unknown> = {
		id: args.objectId,
		blockId: args.blockId,
		block,
	};
	if (args.propertyId) body.propertyId = args.propertyId;
	const response = await makeApiRequest("/blocks/block", {
		method: "PATCH",
		body: JSON.stringify(body),
	});
	return parseResponse(response, "Block updated");
}

async function handleDeleteBlock(args: Args<typeof deleteBlockSchema>) {
	const response = await makeApiRequest(
		`/block${buildQuery({ objectId: args.objectId, blockId: args.blockId })}`,
		{ method: "DELETE" },
	);
	return parseResponse(response, "Block deleted");
}

async function handleGetSpace() {
	const response = await makeApiRequest("/space");
	return parseResponse(response, "Space retrieved");
}

const listPagingProps = {
	cursor: {
		type: "string",
		description:
			"Pagination cursor: pass the nextCursor from the previous page.",
	},
	pageSize: {
		type: "number",
		description: "Results per page (1-100, default 100).",
	},
};

const NET_NEW_TOOLS: ToolDefinition[] = [
	{
		name: "capacities_delete_object",
		description:
			"Delete an object. By default it is moved to trash (recoverable); pass hardDelete=true to delete permanently (irreversible). Confirm with the user before hard-deleting.",
		inputSchema: {
			type: "object",
			properties: {
				objectId: {
					type: "string",
					description: "UUID of the object to delete",
				},
				hardDelete: {
					type: "boolean",
					description:
						"If true, permanently delete instead of moving to trash. Default: false",
				},
			},
			required: ["objectId"],
		},
		schema: deleteObjectSchema,
		handler: handleDeleteObject as ToolHandler,
	},
	{
		name: "capacities_create_from_url",
		description:
			"Save a URL as a weblink/media object (replaces the old save_weblink). Optionally override the title/description and add markdown notes.",
		inputSchema: {
			type: "object",
			properties: {
				url: { type: "string", description: "The URL to save" },
				title: { type: "string", description: "Optional title override" },
				description: {
					type: "string",
					description: "Optional description override",
				},
				mdText: {
					type: "string",
					description: "Optional markdown added to the object's notes",
				},
			},
			required: ["url"],
		},
		schema: createFromUrlSchema,
		handler: handleCreateFromUrl as ToolHandler,
	},
	{
		name: "capacities_list_objects_by_type",
		description:
			"List object summaries (id, structureId, title) of a given type, 100 at a time. Get structure IDs from capacities_get_object_type_shape (or built-ins like RootPage, RootTask).",
		inputSchema: {
			type: "object",
			properties: {
				structureId: {
					type: "string",
					description: "Structure ID, e.g. 'RootPage' or a custom type UUID",
				},
				...listPagingProps,
			},
			required: ["structureId"],
		},
		schema: listByTypeSchema,
		handler: handleListByType as ToolHandler,
	},
	{
		name: "capacities_list_objects_by_tag",
		description:
			"List object summaries that carry a given tag, 100 at a time. Tags are objects of type RootTag; find a tag's ID with capacities_search (structureIds ['RootTag']).",
		inputSchema: {
			type: "object",
			properties: {
				tagId: { type: "string", description: "UUID of the tag object" },
				...listPagingProps,
			},
			required: ["tagId"],
		},
		schema: listByTagSchema,
		handler: handleListByTag as ToolHandler,
	},
	{
		name: "capacities_list_objects_by_collection",
		description:
			"List object summaries in a collection (database), 100 at a time. Collection IDs come from capacities_get_object_type_shape.",
		inputSchema: {
			type: "object",
			properties: {
				collectionId: {
					type: "string",
					description: "UUID of the collection",
				},
				...listPagingProps,
			},
			required: ["collectionId"],
		},
		schema: listByCollectionSchema,
		handler: handleListByCollection as ToolHandler,
	},
	{
		name: "capacities_update_block",
		description:
			"Replace the content of a single block in an object. Block IDs come from the object's blocks (GET /object via capacities_get_object_link's objectData). Provide either 'text' (plain-text replacement) or 'block' (a full Capacities block JSON, e.g. {type:'TextBlock',tokens:[...],hierarchy:{key:'Base',val:0}}).",
		inputSchema: {
			type: "object",
			properties: {
				objectId: {
					type: "string",
					description: "UUID of the object containing the block",
				},
				blockId: { type: "string", description: "ID of the block to update" },
				propertyId: {
					type: "string",
					description:
						"Optional property definition id that contains the block",
				},
				text: {
					type: "string",
					description: "Plain text to replace the block with (TextBlock)",
				},
				block: {
					type: "object",
					description: "Full replacement block JSON (alternative to 'text')",
				},
			},
			required: ["objectId", "blockId"],
		},
		schema: updateBlockSchema,
		handler: handleUpdateBlock as ToolHandler,
	},
	{
		name: "capacities_delete_block",
		description:
			"Delete a single block (including nested child blocks) from an object. Irreversible.",
		inputSchema: {
			type: "object",
			properties: {
				objectId: {
					type: "string",
					description: "UUID of the object containing the block",
				},
				blockId: { type: "string", description: "ID of the block to delete" },
			},
			required: ["objectId", "blockId"],
		},
		schema: deleteBlockSchema,
		handler: handleDeleteBlock as ToolHandler,
	},
	{
		name: "capacities_get_space",
		description:
			"Get information (id, title, icon) about the space the API token is scoped to.",
		inputSchema: { type: "object", properties: {}, required: [] },
		schema: getSpaceSchema,
		handler: handleGetSpace as ToolHandler,
	},
];

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const TOOL_DEFINITIONS: ToolDefinition[] = [
	{
		name: "capacities_get_object_type_shape",
		description:
			"List the object types (structures) in the space with their IDs, writable property definitions (id, type, label options) and collections. Call this before capacities_create_object / capacities_update_object to learn the structureId and which frontmatter keys are writable. Use 'summary' for a lightweight listing.",
		inputSchema: {
			type: "object",
			properties: {
				summary: {
					type: "boolean",
					description:
						"If true, return only structure names, IDs and collections (no property definitions). Default: false",
				},
				structureIds: {
					type: "array",
					items: { type: "string" },
					description: "Only return structures with these IDs.",
				},
				excludeMediaTypes: {
					type: "boolean",
					description:
						"If true, exclude built-in media structures (MediaImage, MediaPDF, ...). Default: false",
				},
			},
			required: [],
		},
		schema: typeShapeSchema,
		handler: handleGetObjectTypeShape as ToolHandler,
	},
	{
		name: "capacities_create_page",
		description:
			"Create a new Page object with a title and optional markdown content.",
		inputSchema: {
			type: "object",
			properties: {
				spaceId: spaceIdProp,
				title: { type: "string", description: "The title of the page" },
				mdText: {
					type: "string",
					description: "Optional markdown content for the page body",
				},
			},
			required: ["title"],
		},
		schema: createPageSchema,
		handler: handleCreatePage as ToolHandler,
	},
	{
		name: "capacities_create_task",
		description:
			"Create a Task object with a title, optional status, priority, dates, and body content.",
		inputSchema: {
			type: "object",
			properties: {
				spaceId: spaceIdProp,
				title: { type: "string", description: "The title of the task" },
				status: {
					type: "string",
					enum: ["todo", "done"],
					description: "Task completion status (default: todo)",
				},
				priority: {
					type: "string",
					enum: ["low", "medium", "high"],
					description: "Task priority level",
				},
				dueDate: {
					type: "string",
					description: "Due date in ISO 8601 format (YYYY-MM-DD)",
				},
				deadlineDate: {
					type: "string",
					description: "Hard deadline date in ISO 8601 format (YYYY-MM-DD)",
				},
				mdText: {
					type: "string",
					description: "Optional markdown content for the task body",
				},
			},
			required: ["title"],
		},
		schema: createTaskSchema,
		handler: handleCreateTask as ToolHandler,
	},
	{
		name: "capacities_append_to_object",
		description:
			"Append content to the body of an existing Capacities object. Use capacities_search to find the object ID first.",
		inputSchema: {
			type: "object",
			properties: {
				objectId: {
					type: "string",
					description: "The UUID of the object to append content to",
				},
				spaceId: spaceIdProp,
				mdText: {
					type: "string",
					description: "The text content to append to the object",
				},
			},
			required: ["objectId", "mdText"],
		},
		schema: appendToObjectSchema,
		handler: handleAppendToObject as ToolHandler,
	},
	{
		name: "capacities_create_object",
		description:
			"Create an object of any type using markdown with optional YAML frontmatter for properties. Call capacities_get_object_type_shape first to get the structureId and see writable properties. Frontmatter keys are matched to writable properties; the rest becomes the body.",
		inputSchema: {
			type: "object",
			properties: {
				spaceId: spaceIdProp,
				structureId: {
					type: "string",
					description:
						"The ID of the object type/structure to create (from capacities_get_object_type_shape)",
				},
				mdText: {
					type: "string",
					description:
						"Markdown content with optional YAML frontmatter for properties. Example: '---\\ntitle: My Meeting\\ndate: 2025-01-01\\n---\\nNotes here.'",
				},
			},
			required: ["structureId", "mdText"],
		},
		schema: createObjectSchema,
		handler: handleCreateObject as ToolHandler,
	},
	{
		name: "capacities_update_object",
		description:
			"Update writable properties on an existing object using YAML frontmatter. Only keys listed in the frontmatter are changed; a 'title' key renames the object. Body content is not changed (use capacities_append_to_object). Use capacities_get_object_type_shape to see which properties are writable.",
		inputSchema: {
			type: "object",
			properties: {
				objectId: {
					type: "string",
					description: "The UUID of the object to update",
				},
				spaceId: spaceIdProp,
				mdText: {
					type: "string",
					description:
						"YAML frontmatter with properties to update. With delimiters: '---\\nstatus: Completed\\n---' or bare YAML: 'status: Completed'",
				},
			},
			required: ["objectId", "mdText"],
		},
		schema: updateObjectSchema,
		handler: handleUpdateObject as ToolHandler,
	},
	{
		name: "capacities_get_object_link",
		description:
			"Retrieve a specific object's data and generate a link to open it in Capacities.",
		inputSchema: {
			type: "object",
			properties: {
				objectId: {
					type: "string",
					description: "The UUID of the object to link to",
				},
				spaceId: spaceIdProp,
			},
			required: ["objectId"],
		},
		schema: getObjectLinkSchema,
		handler: handleGetObjectLink as ToolHandler,
	},
	{
		name: "capacities_search",
		description:
			"Search object titles across the space with optional structure filtering",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "The search query" },
				structureIds: {
					type: "array",
					items: { type: "string" },
					description:
						"Optional array of structure IDs to filter results (e.g. ['RootPage', 'RootTask'])",
				},
				limit: {
					type: "number",
					description:
						"Maximum number of results to return (default: 20, max: 50)",
				},
			},
			required: ["query"],
		},
		schema: searchSchema,
		handler: handleSearch as ToolHandler,
	},
	{
		name: "capacities_read_object_content",
		description:
			"Retrieve the full markdown content of a Capacities object by its ID.",
		inputSchema: {
			type: "object",
			properties: {
				objectId: {
					type: "string",
					description:
						"The UUID of the object to retrieve. Get this from 'Copy object reference' in Capacities, or from search results.",
				},
				spaceId: spaceIdProp,
			},
			required: ["objectId"],
		},
		schema: readObjectSchema,
		handler: handleReadObjectContent as ToolHandler,
	},
	{
		name: "capacities_append_to_daily_note",
		description:
			"Append markdown content to the daily note for a given day (defaults to today). Creates the day's daily note automatically if it doesn't exist yet. Processed asynchronously by Capacities, so the note may take a moment to appear.",
		inputSchema: {
			type: "object",
			properties: {
				mdText: {
					type: "string",
					description: "Markdown content to append to the daily note",
				},
				date: {
					type: "string",
					description:
						"Optional ISO 8601 date for the daily note day, UTC midnight (e.g. '2026-07-16T00:00:00.000Z' or '2026-07-16'). Defaults to today.",
				},
				noTimeStamp: {
					type: "boolean",
					description:
						"If true, omits the automatic timestamp heading block when appending",
				},
			},
			required: ["mdText"],
		},
		schema: appendDailySchema,
		handler: handleAppendToDailyNote as ToolHandler,
	},
	{
		name: "capacities_get_daily_note",
		description:
			"Find and read the daily note for a given day (defaults to today). Returns its object id plus full content — use this before capacities_append_to_object if you need the note's object id, or to check whether a note already exists for that day.",
		inputSchema: {
			type: "object",
			properties: {
				date: {
					type: "string",
					description:
						"Date to look up, as 'YYYY-MM-DD' or any ISO 8601 date. Defaults to today.",
				},
			},
			required: [],
		},
		schema: getDailySchema,
		handler: handleGetDailyNote as ToolHandler,
	},
	...NET_NEW_TOOLS,
];

export const TOOLS = TOOL_DEFINITIONS.map(
	({ name, description, inputSchema }) => ({ name, description, inputSchema }),
);

function formatZodError(error: z.ZodError): string {
	return error.issues
		.map((issue) => `${issue.path.join(".") || "(input)"}: ${issue.message}`)
		.join("; ");
}

/** Validate input with Zod and dispatch to the tool handler. */
export async function callTool(
	name: string,
	rawArgs: unknown,
): Promise<string> {
	const tool = TOOL_DEFINITIONS.find((t) => t.name === name);
	if (!tool) throw new Error(`Unknown tool: ${name}`);
	const parsed = tool.schema.safeParse(rawArgs ?? {});
	if (!parsed.success) {
		throw new Error(
			`Invalid arguments for ${name}: ${formatZodError(parsed.error)}`,
		);
	}
	return tool.handler(parsed.data as never);
}
