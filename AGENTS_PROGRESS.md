# Project Status

Last verified: 2026-07-16

## Current Implementation

- The package is a Bun-built OpenCode TUI plugin named `opencode-project-panel`.
- The active plugin entry is `src/index.tsx`; it registers the bottom-bar UI.
- The implemented UI areas are the project file manager/editor, Permissions tabs for Skills/Tools/MCPs, and the standalone MCP connection panel.
- Configuration editing is implemented through `src/config-helper.ts` with JSONC comment preservation.
- `src/nfm-full.tsx` remains as an older, currently unused file-manager implementation.

## Validation

- `bun run typecheck` — passed.
- `bun run build` — passed; generated `dist/index.js` (130.74 KB, ignored by Git).
- Automated test command — not configured in `package.json`.

## Repository State

- The repository has no commits yet; all project files are currently untracked except ignored build/dependency directories.
- `node_modules/` and `dist/` are ignored.
- No separate TODO, known-issues, or progress file existed before this status record.

## Follow-ups

- Add focused automated tests for file operations, permission/config mutation, MCP connection toggling, and viewer search/edit behavior.
- Decide whether `src/nfm-full.tsx` should be retained as reference code or removed after confirming it is no longer needed.
- Create the initial Git commit once the desired project baseline and test coverage are agreed.
