#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { makeApiRequest } from "./api.js";

// Tool definitions
const TOOLS = [
	{
		name: "capacities_create_page",
		description:
			"Create a new Page object in a Capacities space with a title and optional markdown content.",
		inputSchema: {
			type: "object" as const,
			properties: {
				spaceId: {
					type: "string",
					description: "The UUID of the space to create the page in",
				},
				title: {
					type: "string",
					description: "The title of the page",
				},
				mdText: {
					type: "string",
					description: "Optional markdown content for the page body",
				},
			},
			required: ["spaceId", "title"],
		},
	},
	{
		name: "capacities_create_task",
		description:
			"Create a Task object in Capacities with a title, optional status, priority, dates, and body content.",
		inputSchema: {
			type: "object" as const,
			properties: {
				spaceId: {
					type: "string",
					description: "The UUID of the space to create the task in",
				},
				title: {
					type: "string",
					description: "The title of the task",
				},
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
			required: ["spaceId", "title"],
		},
	},
	{
		name: "capacities_append_to_object",
		description:
			"Append content to the body of an existing Capacities object. Use capacities_search to find the object ID first.",
		inputSchema: {
			type: "object" as const,
			properties: {
				objectId: {
					type: "string",
					description: "The UUID of the object to append content to",
				},
				spaceId: {
					type: "string",
					description: "The UUID of the space containing the object",
				},
				mdText: {
					type: "string",
					description: "The text content to append to the object",
				},
			},
			required: ["objectId", "spaceId", "mdText"],
		},
	},
	{
		name: "capacities_create_object",
		description:
			"Create an object of any custom type in Capacities using markdown with optional YAML frontmatter for properties. Call capacities_get_space_info first to get the structureId and see available properties. Frontmatter keys are matched to writable properties; the rest becomes the body.",
		inputSchema: {
			type: "object" as const,
			properties: {
				spaceId: {
					type: "string",
					description: "The UUID of the space to create the object in",
				},
				structureId: {
					type: "string",
					description:
						"The ID of the object type/structure to create (from capacities_get_space_info)",
				},
				mdText: {
					type: "string",
					description:
						"Markdown content with optional YAML frontmatter for properties. Example: '---\\ntitle: My Meeting\\ndate: 2025-01-01\\n---\\nNotes here.'",
				},
			},
			required: ["spaceId", "structureId", "mdText"],
		},
	},
	{
		name: "capacities_update_object",
		description:
			"Update writable properties on an existing Capacities object using YAML frontmatter. Only keys listed in the frontmatter are changed; other properties are left as-is. A 'title' key renames the object. Use capacities_get_space_info to see which properties are writable for the object type.",
		inputSchema: {
			type: "object" as const,
			properties: {
				objectId: {
					type: "string",
					description: "The UUID of the object to update",
				},
				spaceId: {
					type: "string",
					description: "The UUID of the space containing the object",
				},
				mdText: {
					type: "string",
					description:
						"YAML frontmatter with properties to update. With delimiters: '---\\nstatus: Completed\\n---' or bare YAML: 'status: Completed'",
				},
			},
			required: ["objectId", "spaceId", "mdText"],
		},
	},
	{
		name: "capacities_get_object_link",
		description:
			"Retrieve a specific object's data and generate a link to open it in Capacities.",
		inputSchema: {
			type: "object" as const,
			properties: {
				objectId: {
					type: "string",
					description: "The UUID of the object to link to",
				},
				spaceId: {
					type: "string",
					description: "The UUID of the space containing the object",
				},
			},
			required: ["objectId", "spaceId"],
		},
	},
	// --- LEGACY (Capacities Beta API) — disabled ---
	// These call the deprecated Beta endpoints (/spaces, /space-info), which require
	// an old "legacy Public API token" that space-scoped v1 tokens don't have.
	// The Beta API is being retired by Capacities on 2026-09-01. Left in place
	// (commented out) for reference / in case a legacy token is ever configured.
	/*
	{
		name: "capacities_list_spaces",
		description: "Get a list of all personal spaces in Capacities",
		inputSchema: {
			type: "object" as const,
			properties: {},
			required: [],
		},
	},
	{
		name: "capacities_get_space_info",
		description:
			"Get information about a Capacities space's structures and collections. By default returns the full schema including all property definitions. Use 'summary' mode to get a lightweight listing of just structure names/IDs (saves context window). Use 'filterStructureIds' to fetch schema for only specific structures. Use 'excludeMediaTypes' to skip built-in media structures (Image, File, PDF, Weblink).",
		inputSchema: {
			type: "object" as const,
			properties: {
				spaceId: {
					type: "string",
					description: "The UUID of the space to get information for",
				},
				summary: {
					type: "boolean",
					description:
						"If true, returns only structure names, IDs, and collection info — no property definitions. Much smaller payload, ideal for discovery/lookup. Default: false",
				},
				filterStructureIds: {
					type: "array",
					items: { type: "string" },
					description:
						"Only return structures matching these IDs. Use this when you only need the schema for specific structures (e.g. just 'Project' and 'Note').",
				},
				excludeMediaTypes: {
					type: "boolean",
					description:
						"If true, excludes built-in media structures (Image, File, PDF, Weblink) whose schemas rarely change. Default: false",
				},
			},
			required: ["spaceId"],
		},
	},
	*/
	{
		name: "capacities_search",
		description:
			"Search for content across all Capacities spaces with optional structure filtering",
		inputSchema: {
			type: "object" as const,
			properties: {
				query: {
					type: "string",
					description: "The search query",
				},
				structureIds: {
					type: "array",
					items: { type: "string" },
					description:
						"Optional array of structure IDs to filter results (e.g. ['RootPage', 'RootTask'])",
				},
				limit: {
					type: "number",
					description: "Maximum number of results to return (default: 20)",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "capacities_read_object_content",
		description:
			"Retrieve the full markdown content of a Capacities object by its ID.",
		inputSchema: {
			type: "object" as const,
			properties: {
				objectId: {
					type: "string",
					description:
						"The UUID of the object to retrieve. Get this from 'Copy object reference' in Capacities, or from search results.",
				},
				spaceId: {
					type: "string",
					description: "The UUID of the space containing the object",
				},
			},
			required: ["objectId", "spaceId"],
		},
	},
	// --- LEGACY (Capacities Beta API) — disabled ---
	// /save-weblink and /save-to-daily-note are deprecated Beta endpoints that require
	// the old "legacy Public API token". Both 401 ("cap_not_authenticated: This endpoint
	// requires a legacy Public API token.") against space-scoped v1 tokens. The Beta API
	// is being retired by Capacities on 2026-09-01. Superseded below by
	// capacities_append_to_daily_note (v1 /blocks/daily-note/append). There is no v1
	// replacement for save-weblink yet (v1's /object/url expects structured properties,
	// not a simple url+tags shape) — left disabled until that's worth wrapping.
	/*
	{
		name: "capacities_save_weblink",
		description:
			"Save a web link to a Capacities space with optional title and tags",
		inputSchema: {
			type: "object" as const,
			properties: {
				spaceId: {
					type: "string",
					description: "The UUID of the space to save the weblink to",
				},
				url: {
					type: "string",
					description: "The URL to save",
				},
				titleOverwrite: {
					type: "string",
					description: "Optional custom title for the weblink",
				},
				descriptionOverwrite: {
					type: "string",
					description: "Optional description for the weblink",
				},
				tags: {
					type: "array",
					items: { type: "string" },
					description:
						"Optional Tags to add to the weblink. Tags need to exactly match your tag names in Capacities, otherwise they will be created.",
				},
				mdText: {
					type: "string",
					description:
						"Text formatted as markdown that will be added to the notes section",
				},
			},
			required: ["spaceId", "url"],
		},
	},
	{
		name: "capacities_save_to_daily_note",
		description:
			"Add markdown text to today's daily note in a Capacities space",
		inputSchema: {
			type: "object" as const,
			properties: {
				spaceId: {
					type: "string",
					description: "The UUID of the space to save to the daily note",
				},
				mdText: {
					type: "string",
					description: "The markdown text to add to today's daily note",
				},
				origin: {
					type: "string",
					enum: ["commandPalette"],
					description:
						"Optional origin label for the content (only 'commandPalette' is supported)",
				},
				noTimestamp: {
					type: "boolean",
					description: "If true, no time stamp will be added to the note",
				},
			},
			required: ["spaceId", "mdText"],
		},
	},
	*/
	// --- Daily note management (v1 API) ---
	{
		name: "capacities_append_to_daily_note",
		description:
			"Append markdown content to the daily note for a given day (defaults to today). Uses the current v1 endpoint (/blocks/daily-note/append), which creates the day's daily note automatically if it doesn't exist yet — unlike capacities_append_to_object, this does not require the note to already exist. Processed asynchronously by Capacities, so the note may take a moment to appear.",
		inputSchema: {
			type: "object" as const,
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
	},
	{
		name: "capacities_get_daily_note",
		description:
			"Find and read the daily note for a given day (defaults to today). Convenience wrapper that searches for the day's RootDailyNote object and returns its id plus full content — use this before capacities_append_to_object if you need the note's object id, or just to check whether a note already exists for that day.",
		inputSchema: {
			type: "object" as const,
			properties: {
				date: {
					type: "string",
					description:
						"Date to look up, as 'YYYY-MM-DD' or any ISO 8601 date. Defaults to today.",
				},
			},
			required: [],
		},
	},
];

// Helpers

async function parseResponse(
	response: Response,
	successMessage: string,
): Promise<string> {
	const responseText = await response.text();
	if (!responseText.trim()) return `Success: ${successMessage} (no response data)`;
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

/** Convert plain text / simple markdown to Capacities TextBlocks for the blocks API */
function markdownToBlocks(markdown: string): Array<Record<string, unknown>> {
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

// Tool handlers

// --- LEGACY (Capacities Beta API) — disabled ---
// See the matching comment above the TOOLS array. Kept for reference only.
/*
async function handleListSpaces(): Promise<string> {
	const response = await makeApiRequest("/spaces");
	const data = await response.json();
	return JSON.stringify(data, null, 2);
}

const MEDIA_STRUCTURE_TITLES = new Set(["image", "file", "pdf", "weblink"]);

async function handleGetSpaceInfo(args: {
	spaceId: string;
	summary?: boolean;
	filterStructureIds?: string[];
	excludeMediaTypes?: boolean;
}): Promise<string> {
	const response = await makeApiRequest(`/space-info?spaceid=${args.spaceId}`);
	const data = (await response.json()) as {
		structures?: Array<{
			id: string;
			title: string;
			pluralName: string;
			labelColor: string;
			propertyDefinitions: Array<{
				id: string;
				type: string;
				dataType: string;
				name: string;
			}>;
			collections: Array<{ id: string; title: string }>;
		}>;
	};

	if (!data.structures) {
		return JSON.stringify(data, null, 2);
	}

	let structures = data.structures;

	if (args.filterStructureIds && args.filterStructureIds.length > 0) {
		const filterSet = new Set(args.filterStructureIds);
		structures = structures.filter((s) => filterSet.has(s.id));
	}

	if (args.excludeMediaTypes) {
		structures = structures.filter(
			(s) => !MEDIA_STRUCTURE_TITLES.has(s.title.toLowerCase()),
		);
	}

	if (args.summary) {
		const summary = structures.map((s) => ({
			id: s.id,
			title: s.title,
			pluralName: s.pluralName,
			labelColor: s.labelColor,
			propertyCount: s.propertyDefinitions?.length ?? 0,
			collections: s.collections,
		}));
		return JSON.stringify({ structures: summary }, null, 2);
	}

	return JSON.stringify({ structures }, null, 2);
}
*/

async function handleSearch(args: {
	query: string;
	structureIds?: string[];
	limit?: number;
}): Promise<string> {
	const requestBody: Record<string, unknown> = { query: args.query };
	if (args.structureIds && args.structureIds.length > 0) {
		requestBody.structureIds = args.structureIds;
	}
	if (args.limit) requestBody.limit = args.limit;
	return postAndReturn("/objects/search", requestBody, "Search completed");
}

async function handleReadObjectContent(args: {
	objectId: string;
	spaceId: string;
}): Promise<string> {
	const response = await makeApiRequest(`/object/markdown?id=${args.objectId}`);
	const responseText = await response.text();
	if (!responseText.trim()) return "Object content is empty";
	// The endpoint may return raw markdown or JSON — handle both
	try {
		const data = JSON.parse(responseText);
		return JSON.stringify(data, null, 2);
	} catch {
		return responseText;
	}
}

// --- LEGACY (Capacities Beta API) — disabled ---
// See the matching comment above the TOOLS array. Kept for reference only.
/*
async function handleSaveWeblink(args: {
	spaceId: string;
	url: string;
	titleOverwrite?: string;
	descriptionOverwrite?: string;
	tags?: string[];
	mdText?: string;
}): Promise<string> {
	const requestBody = {
		spaceId: args.spaceId,
		url: args.url,
		...(args.titleOverwrite && { titleOverwrite: args.titleOverwrite }),
		...(args.descriptionOverwrite && {
			descriptionOverwrite: args.descriptionOverwrite,
		}),
		...(args.tags && { tags: args.tags }),
		...(args.mdText && { mdText: args.mdText }),
	};
	return postAndReturn("/save-weblink", requestBody, "Weblink saved");
}

async function handleSaveToDailyNote(args: {
	spaceId: string;
	mdText: string;
	origin?: string;
	noTimestamp?: boolean;
}): Promise<string> {
	const requestBody = {
		spaceId: args.spaceId,
		mdText: args.mdText,
		...(args.origin && { origin: args.origin }),
		...(args.noTimestamp !== undefined && { noTimestamp: args.noTimestamp }),
	};
	return postAndReturn(
		"/save-to-daily-note",
		requestBody,
		"Content saved to daily note",
	);
}
*/

// --- Daily note management (v1 API) ---

/**
 * Normalizes a user-supplied date (plain "YYYY-MM-DD" or full ISO) to the
 * UTC-midnight ISO 8601 format the v1 API expects for daily notes.
 */
function normalizeDailyNoteDate(date?: string): string | undefined {
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

async function handleAppendToDailyNote(args: {
	mdText: string;
	date?: string;
	noTimeStamp?: boolean;
}): Promise<string> {
	const requestBody: Record<string, unknown> = { markdown: args.mdText };
	const normalizedDate = normalizeDailyNoteDate(args.date);
	if (normalizedDate) requestBody.date = normalizedDate;
	if (args.noTimeStamp !== undefined)
		requestBody.noTimeStamp = args.noTimeStamp;
	return postAndReturn(
		"/blocks/daily-note/append",
		requestBody,
		"Content appended to daily note (processed asynchronously — may take a moment to appear)",
	);
}

async function handleGetDailyNote(args: { date?: string }): Promise<string> {
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

	const contentResponse = await makeApiRequest(
		`/object/markdown?id=${match.id}`,
	);
	const contentText = await contentResponse.text();
	let content: unknown = contentText;
	try {
		content = JSON.parse(contentText);
	} catch {
		// plain markdown/text response — keep as-is
	}

	return JSON.stringify(
		{ date: searchDate, found: true, id: match.id, content },
		null,
		2,
	);
}

async function handleCreatePage(args: {
	spaceId: string;
	title: string;
	mdText?: string;
}): Promise<string> {
	const markdown = `---\ntitle: ${args.title}\n---\n${args.mdText ?? ""}`;
	return postAndReturn(
		"/object/markdown",
		{ structureId: "RootPage", markdown },
		"Page created",
	);
}

async function handleCreateTask(args: {
	spaceId: string;
	title: string;
	status?: string;
	priority?: string;
	dueDate?: string;
	deadlineDate?: string;
	mdText?: string;
}): Promise<string> {
	const frontmatterLines = [`title: ${args.title}`];
	if (args.status) frontmatterLines.push(`status: ${args.status}`);
	if (args.priority) frontmatterLines.push(`priority: ${args.priority}`);
	if (args.dueDate) frontmatterLines.push(`dueDate: ${args.dueDate}`);
	if (args.deadlineDate)
		frontmatterLines.push(`deadlineDate: ${args.deadlineDate}`);
	const markdown = `---\n${frontmatterLines.join("\n")}\n---\n${args.mdText ?? ""}`;
	return postAndReturn(
		"/object/markdown",
		{ structureId: "RootTask", markdown },
		"Task created",
	);
}

async function handleCreateObject(args: {
	spaceId: string;
	structureId: string;
	mdText: string;
}): Promise<string> {
	return postAndReturn(
		"/object/markdown",
		{ structureId: args.structureId, markdown: args.mdText },
		"Object created",
	);
}

async function handleAppendToObject(args: {
	objectId: string;
	spaceId: string;
	mdText: string;
}): Promise<string> {
	const blocks = markdownToBlocks(args.mdText);
	return postAndReturn(
		"/blocks/append",
		{ id: args.objectId, position: { type: "end" }, blocks },
		"Content appended to object",
	);
}

async function handleUpdateObject(args: {
	objectId: string;
	spaceId: string;
	mdText: string;
}): Promise<string> {
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

async function handleGetObjectLink(args: {
	objectId: string;
	spaceId: string;
}): Promise<string> {
	const response = await makeApiRequest(`/object?id=${args.objectId}`);
	const responseText = await response.text();
	let objectData: unknown = null;
	try {
		objectData = JSON.parse(responseText);
	} catch {
		objectData = responseText;
	}
	return JSON.stringify(
		{
			objectId: args.objectId,
			spaceId: args.spaceId,
			appLink: `https://app.capacities.io/${args.spaceId}/${args.objectId}`,
			objectData,
		},
		null,
		2,
	);
}

// Main server setup
const server = new Server(
	{
		name: "capacities-mcp",
		version: "1.4.0",
	},
	{
		capabilities: {
			tools: {},
		},
	},
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
	return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const { name, arguments: args } = request.params;

	try {
		let result: string;

		switch (name) {
			// --- LEGACY (Capacities Beta API) — disabled, see comments above ---
			// case "capacities_list_spaces":
			// 	result = await handleListSpaces();
			// 	break;
			// case "capacities_get_space_info":
			// 	result = await handleGetSpaceInfo(
			// 		args as {
			// 			spaceId: string;
			// 			summary?: boolean;
			// 			filterStructureIds?: string[];
			// 			excludeMediaTypes?: boolean;
			// 		},
			// 	);
			// 	break;
			case "capacities_search":
				result = await handleSearch(
					args as {
						query: string;
						structureIds?: string[];
						limit?: number;
					},
				);
				break;
			case "capacities_read_object_content":
				result = await handleReadObjectContent(
					args as { objectId: string; spaceId: string },
				);
				break;
			// case "capacities_save_weblink":
			// 	result = await handleSaveWeblink(
			// 		args as {
			// 			spaceId: string;
			// 			url: string;
			// 			titleOverwrite?: string;
			// 			descriptionOverwrite?: string;
			// 			tags?: string[];
			// 			mdText?: string;
			// 		},
			// 	);
			// 	break;
			// case "capacities_save_to_daily_note":
			// 	result = await handleSaveToDailyNote(
			// 		args as {
			// 			spaceId: string;
			// 			mdText: string;
			// 			origin?: string;
			// 			noTimestamp?: boolean;
			// 		},
			// 	);
			// 	break;
			case "capacities_append_to_daily_note":
				result = await handleAppendToDailyNote(
					args as { mdText: string; date?: string; noTimeStamp?: boolean },
				);
				break;
			case "capacities_get_daily_note":
				result = await handleGetDailyNote(args as { date?: string });
				break;
			case "capacities_create_page":
				result = await handleCreatePage(
					args as { spaceId: string; title: string; mdText?: string },
				);
				break;
			case "capacities_create_task":
				result = await handleCreateTask(
					args as {
						spaceId: string;
						title: string;
						status?: string;
						priority?: string;
						dueDate?: string;
						deadlineDate?: string;
						mdText?: string;
					},
				);
				break;
			case "capacities_append_to_object":
				result = await handleAppendToObject(
					args as { objectId: string; spaceId: string; mdText: string },
				);
				break;
			case "capacities_create_object":
				result = await handleCreateObject(
					args as { spaceId: string; structureId: string; mdText: string },
				);
				break;
			case "capacities_update_object":
				result = await handleUpdateObject(
					args as { objectId: string; spaceId: string; mdText: string },
				);
				break;
			case "capacities_get_object_link":
				result = await handleGetObjectLink(
					args as { objectId: string; spaceId: string },
				);
				break;
			default:
				throw new Error(`Unknown tool: ${name}`);
		}

		return {
			content: [{ type: "text", text: result }],
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text", text: `Error: ${errorMessage}` }],
			isError: true,
		};
	}
});

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("Capacities MCP server running on stdio");
}

main().catch((error) => {
	console.error("Server error:", error);
	process.exit(1);
});
