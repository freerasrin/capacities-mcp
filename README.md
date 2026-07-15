# Capacities MCP Plus

<a href="https://glama.ai/mcp/servers/@Im-Hal-9K/Capacities-MCP-Plus">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@Im-Hal-9K/Capacities-MCP-Plus/badge" alt="Capacities MCP Plus on Glama" />
</a>

An enhanced MCP (Model Context Protocol) server for [Capacities](https://capacities.io), giving AI assistants full read and write access to your knowledge management system — search, read, create, update, and manage daily notes, all through natural language.

> **Note:** This is a fork of [jemgold/capacities-mcp](https://github.com/jemgold/capacities-mcp) with additional features, fixes, and a migration to Capacities' current [v1 API](https://developers.capacities.io).

## ⚠️ API migration (read this first)

Capacities is retiring its old **Beta API** on **September 1, 2026** in favor of a new, space-scoped **v1 API**. This server has been migrated accordingly:

- Every tool now calls the current v1 endpoints under `https://api.capacities.io`.
- The four tools that only exist in the deprecated Beta API (`capacities_list_spaces`, `capacities_get_space_info`, `capacities_save_weblink`, `capacities_save_to_daily_note`) are **disabled** — commented out in `src/server.ts`, not removed — because they require an old *legacy Public API token* that v1 tokens can't satisfy. Space-scoped v1 tokens get a `401 cap_not_authenticated` from them.
- Daily notes got a proper upgrade: `capacities_append_to_daily_note` wraps the v1 `/blocks/daily-note/append` endpoint, which **creates the day's note automatically if it doesn't exist yet** — no more juggling search-then-append just to find out a note isn't there.

See [Legacy tools (disabled)](#legacy-tools-disabled) below for the full rundown, and [Migration Notes](#migration-notes) if you're upgrading from an older version of this server.

## Features

- **Search Content** — Search across all your spaces, optionally filtered by object type
- **Read Object Content** — Retrieve full markdown content of any object by ID
- **Daily Notes** — Append to (and auto-create) a given day's daily note, or look one up
- **Create Pages** — Create new Page objects with markdown content
- **Create Tasks** — Create tasks with status, priority, and due/deadline dates
- **Create Any Object** — Create any custom object type (Meeting, Project, Book, etc.) via markdown + YAML frontmatter
- **Append to Objects** — Append markdown to the body of any existing object
- **Update Objects** — Update writable properties on existing objects via YAML frontmatter
- **Object Links** — Generate shareable Capacities URLs for any object

## What's Different from the Original

| Feature | Original | Plus |
|---------|----------|------|
| **v1 API support** | ✗ (Beta API only) | ✓ Migrated to Capacities' current space-scoped v1 API |
| **Daily notes that self-create** | ✗ | ✓ `capacities_append_to_daily_note` creates the day's note if it's missing |
| **Read Object Content** | ✗ | ✓ Retrieve full note content by object ID |
| **Create Pages** | ✗ | ✓ Create new Page objects with markdown content |
| **Create Tasks** | ✗ | ✓ Create tasks with priority, dates, and body |
| **Create Any Object Type** | ✗ | ✓ Create Meeting, Project, Book, or any custom type |
| **Append to Objects** | ✗ | ✓ Append markdown to any existing object |
| **Update Object Properties** | ✗ | ✓ Update properties via YAML frontmatter |
| **Object Links** | ✗ | ✓ Generate shareable links to any object |
| **npm Package** | `capacities-mcp` | `capacities-mcp-plus` |

## Installation

### For Claude Desktop (macOS)

Add to your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "capacities": {
      "command": "npx",
      "args": ["-y", "capacities-mcp-plus"],
      "env": {
        "CAPACITIES_API_KEY": "your_capacities_api_key_here"
      }
    }
  }
}
```

### For Claude Desktop (Windows)

Windows requires a cmd wrapper. Add to `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "capacities": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "capacities-mcp-plus"],
      "env": {
        "CAPACITIES_API_KEY": "your_capacities_api_key_here"
      }
    }
  }
}
```

Generate a **v1 personal API token** from **Settings → Capacities API** in the Capacities desktop app — pick the space you want this server to access and grant it the scopes it needs (`api:read` for search/read tools, `api:write` for everything else). Each token is bound to a single space; create one token per space if you want to connect more than one.

> Restart Claude Desktop (or reconnect the MCP server) after any config or code change — a running server won't pick up updates until it's restarted.

## Development

### Local Setup

1. Clone this repository:
```bash
git clone https://github.com/Im-Hal-9K/capacities-mcp.git
cd capacities-mcp
```

2. Install dependencies:
```bash
bun install
```

3. Copy the example environment file and add your API key:
```bash
cp .env.example .env
# Edit .env and add your CAPACITIES_API_KEY (a v1 personal token, see Installation above)
```

4. Start the development server:
```bash
bun run dev
```

### Other Commands

```bash
bun run build    # Compile TypeScript
bun run test     # Run tests
bun run lint     # Check types and code quality
bun run format   # Auto-format code
```

## Available Tools

### Read tools

#### `capacities_search`
Search for content across all your spaces.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | ✓ | Text to search for |
| `structureIds` | string[] | | Filter results to specific object types, e.g. `["RootPage", "RootTask"]` |
| `limit` | number | | Max results to return (default: 20) |

No `spaceId` needed — v1 tokens are bound to a single space, so search covers that space automatically.

---

#### `capacities_read_object_content`
Retrieve the full markdown content of a Capacities object by its ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `objectId` | string | ✓ | UUID of the object (from "Copy object reference" in Capacities, or from search results) |
| `spaceId` | string | ✓ | UUID of the space containing the object |

---

#### `capacities_get_daily_note`
Find and read the daily note for a given day (defaults to today). A convenience wrapper — searches for the day's `RootDailyNote` object, then reads its content.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `date` | string | | `"YYYY-MM-DD"` or full ISO 8601. Defaults to today. |

Returns `{ found: false }` if no note exists yet for that day — nothing to read until something's been appended. Use `capacities_append_to_daily_note` to create it.

---

#### `capacities_get_object_link`
Retrieve a specific object's data and generate a shareable link to open it in Capacities.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `objectId` | string | ✓ | UUID of the object |
| `spaceId` | string | ✓ | UUID of the space containing the object |

**Example prompt:** *"Give me a link to my Cheesecake recipe in Capacities."*

### Write tools

#### `capacities_append_to_daily_note`
Append markdown content to the daily note for a given day (defaults to today) — **creates the note automatically if it doesn't exist yet.** This is the recommended way to work with daily notes; it's the v1 replacement for the disabled `capacities_save_to_daily_note`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mdText` | string | ✓ | Markdown content to append |
| `date` | string | | `"YYYY-MM-DD"` or full ISO 8601, UTC midnight. Defaults to today. |
| `noTimeStamp` | boolean | | Skip the automatic timestamp heading if true |

Processed asynchronously by Capacities, so the note may take a moment to actually appear.

**Example prompt:** *"Add a summary of today's work to my daily note."*

---

#### `capacities_create_page`
Create a new Page object with a title and optional markdown content.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `spaceId` | string | ✓ | UUID of the target space |
| `title` | string | ✓ | Page title |
| `mdText` | string | | Markdown content for the page body |

**Example prompt:** *"Create a Capacities page titled 'Weekly Review Template' with a checklist in markdown."*

---

#### `capacities_create_task`
Create a Task object with optional status, priority, and dates.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `spaceId` | string | ✓ | UUID of the target space |
| `title` | string | ✓ | Task title |
| `status` | string | | `"todo"` or `"done"` |
| `priority` | string | | `"low"`, `"medium"`, or `"high"` |
| `dueDate` | string | | Due date in `YYYY-MM-DD` format |
| `deadlineDate` | string | | Hard deadline in `YYYY-MM-DD` format |
| `mdText` | string | | Markdown content for the task body |

**Example prompt:** *"Add a high-priority task to finish the MCP docs by Friday."*

---

#### `capacities_create_object`
Create an object of any custom type (Meeting, Project, Book, etc.) using markdown with YAML frontmatter for properties.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `spaceId` | string | ✓ | UUID of the target space |
| `structureId` | string | ✓ | ID of the object type to create |
| `mdText` | string | ✓ | Markdown with optional YAML frontmatter for properties |

**Frontmatter example:**
```markdown
---
title: Q3 Planning Meeting
date: 2025-07-10
---
Discussed roadmap priorities and resource allocation.
```

> **Note:** `RootDailyNote` cannot be created through this endpoint (`400 cap_invalid_input` — "this object type cannot be created via this endpoint"). Use `capacities_append_to_daily_note` for daily notes instead.

**Example prompt:** *"Create a new Meeting object for today's Q3 planning session with attendees and notes."*

---

#### `capacities_append_to_object`
Append markdown content to the body of any existing object.

Use `capacities_search` (or `capacities_get_daily_note` for daily notes) to find the object ID first — this tool requires the object to already exist.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `objectId` | string | ✓ | UUID of the object to append to |
| `spaceId` | string | ✓ | UUID of the space containing the object |
| `mdText` | string | ✓ | Markdown content to append |

**Example prompt:** *"Append a summary of this conversation to my project note in Capacities."*

---

#### `capacities_update_object`
Update writable properties on an existing object using YAML frontmatter. Only listed keys are changed; all other properties remain untouched. A `title` key renames the object.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `objectId` | string | ✓ | UUID of the object to update |
| `spaceId` | string | ✓ | UUID of the space containing the object |
| `mdText` | string | ✓ | YAML frontmatter with properties to update |

**Examples:**
```yaml
# With delimiters
---
status: Completed
---

# Bare YAML also accepted
status: Completed
```

**Example prompt:** *"Set the status on my 'Context Engine' project in Capacities to Completed."*

## Legacy tools (disabled)

The four tools below only work against Capacities' deprecated **Beta API**, which requires a *legacy Public API token* — a different credential from the v1 personal tokens this server otherwise uses. They're **commented out** in `src/server.ts` (tool definitions, handlers, and dispatch cases) rather than deleted, so they're easy to re-enable if you specifically configure a legacy token. Capacities is retiring the Beta API entirely on **2026-09-01**.

| Tool | Beta endpoint | Status |
|------|----------------|--------|
| `capacities_list_spaces` | `GET /spaces` | Disabled — no v1 equivalent needed; v1 tokens are already space-scoped |
| `capacities_get_space_info` | `GET /space-info` | Disabled — no v1 equivalent wired up yet |
| `capacities_save_weblink` | `POST /save-weblink` | Disabled — v1's `POST /object/url` uses a different (structured `properties`/`markdown`) shape, not a drop-in swap |
| `capacities_save_to_daily_note` | `POST /save-to-daily-note` | **Replaced** by `capacities_append_to_daily_note` (v1 `/blocks/daily-note/append`) |

If you were relying on `capacities_save_to_daily_note`, switch to `capacities_append_to_daily_note` — it's a strict upgrade (auto-creates missing notes, no legacy token needed).

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `/objects/search` | 120 req / 60 s |
| `/blocks/daily-note/append` | 30 req / 60 s |
| `/object/markdown` (POST/PATCH), `/blocks/append` | Shared 5,000 object creation quota (resets +100/month) |
| *Legacy (disabled):* `/spaces`, `/space-info` | 5 req / 60 s |
| *Legacy (disabled):* `/save-weblink` | 10 req / 60 s |
| *Legacy (disabled):* `/save-to-daily-note` | 5 req / 60 s |

## Example Prompts

### Exploring your knowledge base
```
"Search for all meeting notes about AstraZeneca"
"Read the content of my Japan Trip note"
"Give me a shareable link to my Cheesecake recipe"
```

### Creating content
```
"Create a page titled 'Weekly Review Template' in my Personal space"
"Add a high-priority task: finish the Q3 report by Friday"
"Create a Meeting object for today's standup with the agenda as the body"
```

### Reading and updating
```
"Find my 'Context Engine' project note and append today's progress"
"Set the status on my 'Context Engine' project to Completed"
```

### Daily notes
```
"Add a summary of today's work to my daily note"
"Append these meeting notes to today's daily note, no timestamp"
"Check whether I already have a daily note for last Tuesday"
```

## Migration Notes

Upgrading from an older version of this server? Here's what changed:

- **Tokens:** generate a new **v1 personal API token** (`Settings → Capacities API`) — the old account-wide Beta token won't work with the active tools anymore. See [Installation](#installation).
- **Daily notes:** replace any `capacities_save_to_daily_note` usage with `capacities_append_to_daily_note`. Same idea (append markdown to a day's note), but it no longer needs the note to already exist, and it doesn't need the legacy token.
- **Spaces & schema discovery:** `capacities_list_spaces` and `capacities_get_space_info` are disabled for now. If your workflow depended on discovering a `structureId` before calling `capacities_create_object`, you'll need to find it another way in the meantime (e.g. via **Settings → Capacities API → Developer settings → Show developer information** in the Capacities app, which surfaces `structureId`s in the UI).
- **Weblinks:** `capacities_save_weblink` is disabled with no replacement yet. There's no scheduled timeline for adding v1 weblink support — contributions welcome.

## API Reference

- [Capacities API Docs (v1)](https://developers.capacities.io)
- [Capacities API Beta (Deprecated)](https://docs.capacities.io/developer/api)
- [Migration Guide: Beta → v1](https://developers.capacities.io/api/overview/migration)
- [Capacities MCP Documentation](https://docs.capacities.io/developer/model-context-protocol)

## Credits

- Original project by [Jem Gold](https://github.com/jemgold/capacities-mcp)
- Enhanced by [Im-Hal-9K](https://github.com/Im-Hal-9K/capacities-mcp)

## License

MIT — see [LICENSE](LICENSE) file for details.
