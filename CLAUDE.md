# Capacities MCP Server

This is an MCP server for the Capacities v1 API (https://api.capacities.io/docs/).

Org policy blocks community/OAuth connectors, so this self-hosted server (static `cap-api-...` token) is kept. Do not switch to the official hosted MCP.

## Development

- Use `bun` as the package manager
- Use `bun run dev` to start the development server
- Use `bun run lint` to check code quality and types
- Use `bun run test` to run tests
- Use `bun run build` to build for production

## Layout

- `src/server.ts` — thin MCP wiring (list tools, dispatch `callTool`). Server version is read from `package.json`.
- `src/tools.ts` — tool definitions (JSON input schema + Zod schema + handler) and `callTool`, which validates input with Zod before dispatch. To add a tool: add a Zod schema, a handler, and an entry in `TOOL_DEFINITIONS`/`NET_NEW_TOOLS`.
- `src/api.ts` — `makeApiRequest` (auth, 401/403/404/429/5xx handling) and `buildQuery`. Errors never include raw response bodies (only a short safe `code`). Always build query strings with `buildQuery` (or `encodeURIComponent`) — never interpolate ids into URLs.

## API Reference

- Docs: https://api.capacities.io/docs/
- OpenAPI Schema: https://api.capacities.io/openapi.json

## Authentication

Set the `CAPACITIES_API_KEY` environment variable with your Capacities API token. Tokens are scoped to a single space, so `spaceId` is optional/advisory on every tool (it is only used to build app links; when omitted, `GET /space` is used).

For development, copy `.env.example` to `.env` and add your API key:
```bash
cp .env.example .env
# Edit .env and add your API key
```

## Available Tools

### Read tools
- `capacities_search` → `POST /objects/search` (`query`, optional `structureIds`, `limit` 1–50; matches titles)
- `capacities_read_object_content` → `GET /object/markdown?id=`
- `capacities_get_object_link` → `GET /object?id=` and constructs the app link
- `capacities_get_daily_note` — searches `RootDailyNote` for the date, then reads it (`{ found: false }` if none)
- `capacities_get_object_type_shape` → `GET /space/structures` (structure IDs, writable properties, collections; options `summary`, `structureIds`, `excludeMediaTypes`). Use before `create_object`/`update_object`.
- `capacities_get_space` → `GET /space`
- `capacities_list_objects_by_type` → `GET /objects/structure?id=`
- `capacities_list_objects_by_tag` → `GET /objects/tag?id=`
- `capacities_list_objects_by_collection` → `GET /objects/collection?id=`
  - List tools take `cursor` and `pageSize` (1–100) and return `nextCursor`/`hasMore`

### Write tools
- `capacities_append_to_daily_note` → `POST /blocks/daily-note/append` (auto-creates the day's note; async)
- `capacities_create_page` / `capacities_create_task` → `POST /object/markdown` (`RootPage` / `RootTask`)
  - The title is YAML-quoted, and the returned title is verified; if the API dropped it, a follow-up `PATCH /object/markdown` sets it. (Fixes the old "title silently dropped" bug — no manual `update_object` needed.)
  - `status` "todo"/"done" maps to RootTask label ids `not-started`/`done`; `dueDate`/`deadlineDate` map to the `date`/`deadline` properties. The API silently drops unknown keys and label ids, so always use real property keys (see `get_object_type_shape`). Daily notes cannot be deleted via the API (400); remove test content with `delete_block`.
- `capacities_create_object` → `POST /object/markdown` (any type; pass full markdown with YAML frontmatter as `mdText`; `RootDailyNote` cannot be created this way)
- `capacities_create_from_url` → `POST /object/url` (`url`, optional `title`, `description`, `mdText`)
- `capacities_append_to_object` → `POST /blocks/append` (TextBlocks; rich formatting is flattened)
- `capacities_update_object` → `PATCH /object/markdown` (frontmatter only; body unchanged; `title` renames)
- `capacities_update_block` → `PATCH /blocks/block` (`text` or raw `block`, exactly one)
- `capacities_delete_block` → `DELETE /block`
- `capacities_delete_object` → `DELETE /object` (trash by default; `hardDelete: true` is permanent — confirm first)

Media upload endpoints (`/object/media/upload*`) are intentionally not wrapped.

### Legacy Beta API tools (not registered)

`capacities_list_spaces`, `capacities_get_space_info`, `capacities_save_weblink` and `capacities_save_to_daily_note` called the deprecated Beta API (legacy token required; retired 2026-09-01) and are not registered. Replacements: `get_space`, `get_object_type_shape`, `create_from_url`, `append_to_daily_note`.

## Rate Limits

- `/objects/search`, `/object*`, `/objects/*`, `/blocks/*`, `/block`: 30 requests per 60 seconds
- `/object/url`: 10 per 60 seconds; `/space`, `/space/structures`: 10 per 60 seconds
- Object creation via `/object/markdown` (POST), `/blocks/append`: shared 5,000 object creation quota (resets +100/month)
