# MCP Servers & Dev Tooling Setup

> Research: 2026-05-01

---

## Playwright MCP — Browser Automation

### Status: Working

**Package:** `@playwright/mcp` (via `npx @playwright/mcp@latest`)

### Problem Encountered

Playwright couldn't find Chrome at its expected location `/opt/google/chrome/chrome`. On this Ubuntu/WSL2 system, Chrome is not installed — only Chromium (via Playwright's own download).

**Chromium binary location:**
```
~/.cache/ms-playwright/chromium-1222/chrome-linux64/chrome
```

### Fix

```bash
sudo mkdir -p /opt/google/chrome
sudo ln -sf ~/.cache/ms-playwright/chromium-1222/chrome-linux64/chrome /opt/google/chrome/chrome
```

### What It Can Do

Playwright MCP tools pre-approved in `.claude/settings.json`:
- `browser_navigate`, `browser_take_screenshot`, `browser_snapshot`
- `browser_click`, `browser_fill`, `browser_type`, `browser_hover`
- `browser_press_key`, `browser_wait_for`, `browser_evaluate`
- `browser_console_messages`, `browser_network_requests`
- `browser_resize`, `browser_tabs`, `browser_select_option`
- `browser_drag`, `browser_drop`, `browser_navigate_back`, `browser_close`

**Use case:** Visual QA of the site — screenshot, inspect elements, test UI flows.

---

## PostgreSQL MCP

### Status: Registered, awaiting session restart

**First attempt (deprecated):**
`@modelcontextprotocol/server-postgres` — registered and showed `✓ Connected` but tools were not accessible. The package crashes with a URL parse error when run directly. It is deprecated.

**Second attempt (current config):**
`mcp-postgres` — reads standard env vars (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`).

**Current config in `~/.claude.json`:**
```
postgres: npx mcp-postgres
  DB_HOST=localhost
  DB_PORT=5433
  DB_USER=eanhl
  DB_PASSWORD=eanhl_dev_2026
  DB_NAME=eanhl
```

**Note:** DB port is 5433, not 5432 — conflict with another local project on the machine.

After session restart, tools like `mcp__postgres__query` should be available for direct DB inspection.

---

## Chrome DevTools MCP

### Status: Working

**Package:** `npx chrome-devtools-mcp@latest`

Tools pre-approved: navigate, screenshot, snapshot, click, fill, hover, evaluate_script, console messages, network requests, list pages, select page.

---

## Settings.json Consolidation (2026-05-01)

The `.claude/settings.json` allow-list was consolidated from ~165 specific patterns down to ~68 broad patterns for maintainability:

**Before:** Explicit paths for every single bash command variant
**After:** Broad glob patterns:
```json
"Bash(pnpm *)",
"Bash(git *)",
"Bash(docker *)",
"Bash(curl *)",
"Bash(find *)",
"Bash(grep *)",
"Bash(psql *)",
"Bash(PGPASSWORD=* psql *)",
"Bash(DATABASE_URL=* pnpm *)"
```

All 20 Playwright MCP tools and 10 Chrome DevTools MCP tools were pre-approved to avoid permission prompts during visual QA.

---

## MCP Ecosystem — Installed Servers

| Server | Purpose | Status |
|---|---|---|
| `@playwright/mcp` | Browser automation, screenshots, visual QA | ✓ Working |
| `chrome-devtools-mcp` | Chrome DevTools protocol access | ✓ Working |
| `@upstash/context7-mcp` | Library documentation lookup | ✓ Working |
| `mcp-postgres` | Direct DB queries | ✓ Connected (needs session restart for tools) |
| `serena` | Code intelligence, LSP, symbol navigation | ✓ Working |
| GitHub MCP | PR/issue/code search via GitHub API | ✓ Working |
| Google Drive MCP | File access from Drive | ✓ Working |
| Supabase MCP | Supabase project management | ✓ Working (not used for this project) |
| Context7 (claude.ai) | Documentation | ✓ Working |

---

## Recommended Workflow

- **Visual QA**: Use Playwright or Chrome DevTools MCP to screenshot the site and verify UI changes before reporting complete
- **DB inspection**: Use `docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "..."` until postgres MCP is working in-session
- **Library docs**: Use Context7 before implementing any Next.js/Drizzle/React queries
