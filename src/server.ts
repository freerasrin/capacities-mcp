#!/usr/bin/env node
import { createRequire } from "node:module";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { TOOLS, callTool } from "./tools.js";

// Single source of truth for the version: package.json (resolves from both src/ and dist/).
const { version } = createRequire(import.meta.url)("../package.json") as {
	version: string;
};

// Legacy Capacities Beta API tools (/spaces, /space-info, /save-weblink,
// /save-to-daily-note) are intentionally not registered. See CLAUDE.md.

const server = new Server(
	{
		name: "capacities-mcp",
		version,
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
		const result = await callTool(name, args);
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
