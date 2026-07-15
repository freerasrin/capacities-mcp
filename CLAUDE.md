# Capacities MCP Server

This is an MCP server for the Capacities API (https://docs.capacities.io/developer/api).

## Development

- Use `bun` as the package manager
- Use `bun run dev` to start the development server
- Use `bun run lint` to check code quality and types
- Use `bun run test` to run tests
- Use `bun run build` to build for production

## API Reference

The Capacities API documentation is available at:
- Docs: https://api.capacities.io/docs/
- OpenAPI Schema: https://api.capacities.io/openapi.json

## Authentication

Set the `CAPACITIES_API_KEY` environment variable with your Capacities API token.

For development, copy `.env.example` to `.env` and add your API key:
```bash
cp .env.example .env
# Edit .env and add your API key
```

## Available Tools

> **Legacy Beta API tools are disabled.** `capacities_list_spaces` (`GET /spaces`),
> `capacities_get_space_info` (`GET /space-info`), `capacities_save_weblink`
> (`POST /save-weblink`), and `capacities_save_to_daily_note` (`POST /save-to-daily-note`)
> are commented out in `src/server.ts` (tool definitions, handlers, and switch cases).
> They call the deprecated Capacities Beta API, which requires an old "legacy Public API
> token" — space-scoped v1 tokens (`cap-api-...`) get a `401 cap_not_authenticated` from
> these endpoints. The Beta API is being retired by Capacities on **2026-09-01**. Only
> re-enable them if you specifically configure a legacy token.

### Read tools
- `capacities_search` - Search content across all spaces → `POST /objects/search`
  - Parameters: `query` (required), `structureIds` (optional filter), `limit` (optional)
  - No `spaceIds` or `mode` — new API searches all spaces automatically
- `capacities_read_object_content` - Retrieve full markdown of an object → `GET /object/markdown?id=`
  - Just needs `objectId` and `spaceId`
- `capacities_get_object_link` - Fetch object data and construct app link → `GET /object?id=`
- `capacities_get_daily_note` - Find + read the daily note for a given day (defaults to today)
  - Convenience wrapper: searches `RootDailyNote` for the date, then reads it via `GET /object/markdown?id=`
  - Returns `{ found: false }` if no note exists yet for that day (nothing to read until something's appended)

### Write tools
- `capacities_append_to_daily_note` - Append markdown to a daily note → `POST /blocks/daily-note/append`
  - **Creates the day's daily note automatically if it doesn't exist yet** — this is the key advantage over `capacities_append_to_object`, which needs an existing object id
  - Parameters: `mdText` (required), `date` (optional, "YYYY-MM-DD" or full ISO; defaults to today), `noTimeStamp` (optional)
  - Processed asynchronously by Capacities — the note may take a moment to actually appear
  - This is the v1 replacement for the disabled `capacities_save_to_daily_note`
- `capacities_create_page` - Create a new Page → `POST /object/markdown` with `structureId: "RootPage"`
  - Markdown is constructed as `---\ntitle: ...\n---\n{body}`
- `capacities_create_task` - Create a Task → `POST /object/markdown` with `structureId: "RootTask"`
  - `status`: "todo" | "done"
  - `priority`: "low" | "medium" | "high"
  - `dueDate` / `deadlineDate`: ISO 8601 (YYYY-MM-DD)
- `capacities_create_object` - Create any custom object type → `POST /object/markdown`
  - Note: `RootDailyNote` cannot be created through this endpoint (`400 cap_invalid_input`) — use `capacities_append_to_daily_note` instead
  - Pass complete markdown with YAML frontmatter as `mdText`
- `capacities_append_to_object` - Append content to an object's body → `POST /blocks/append`
  - Uses Capacities blocks API (TextBlocks); text is preserved, rich formatting is flattened
  - Use `capacities_search` (or `capacities_get_daily_note` for daily notes) to find `objectId` first
  - Requires the object to already exist — for daily notes that may not exist yet, use `capacities_append_to_daily_note` instead
- `capacities_update_object` - Update writable properties → `PATCH /object/markdown`
  - Pass YAML frontmatter (with or without `---` delimiters) as `mdText`
  - Only listed keys are changed; `title` key renames the object
  - Body content is NOT updated via this endpoint; use `append_to_object` for content

There's currently no v1 replacement wired up for `capacities_save_weblink` — v1's
`POST /object/url` expects structured `properties`/`markdown` rather than a simple
`url`+`tags` shape, so it wasn't a drop-in swap. Left disabled for now.

## Available Prompts

- `capacities-daily-summary` - Create structured daily summaries
- `capacities-research-note` - Format research findings  
- `capacities-meeting-notes` - Structure meeting notes

## Rate Limits

- `/objects/search`: 120 requests per 60 seconds
- `/blocks/daily-note/append`: 30 requests per 60 seconds
- `/object/markdown` (POST/PATCH), `/blocks/append`: shared 5,000 object creation quota (resets +100/month)
- Legacy/disabled: `/spaces`, `/space-info` (5 req/60s), `/save-weblink` (10 req/60s), `/save-to-daily-note` (5 req/60s) — retired 2026-09-01