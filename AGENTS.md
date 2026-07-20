# opencode-project-panel

opencode TUI plugin providing a bottom bar with File Manager and Permissions (Skills/Tools/MCPs) panels.

## Build

```sh
bun run build
```

Type check: `bun run typecheck`

**Any modification must pass `bun run build` before reporting completion.**

## Architecture

- `src/index.tsx` — Plugin entry; registers `app_bottom` slot.
- `src/bottom-bar.tsx` — Bottom bar (`Files | Permissions`), palette commands, and dialog launchers. Re-exports `currentFileActions`, `focusedPane`, `isOverlayActive` from `new-file-manager`.
- `src/new-file-manager.tsx` — File browser with `<markdown>`/`<code>` preview, focus cycling (Tab/Shift+Tab between select/preview/filter), F7/F2/Del file ops, Ctrl+G goto, Ctrl+R return to project root, and overlay confirm/prompt dialogs.
- `src/file-viewer.tsx` — Unified file viewer/editor with Preview/Edit modes and SearchBar (Ctrl+F for search, Ctrl+E to toggle mode, Ctrl+S to save in Edit). Uses `<textarea>` + `addHighlightByCharRange` for search highlighting.
- `src/panel-permissions.tsx` — Three-tab dialog (Skills/Tools/MCPs) using `<select>` + property mutation to toggle allow/deny/ask.
- `src/new-panel-mcp.tsx` — Standalone MCP connection panel with `<select>` list and right-side detail/status panel. Toggle connect/disconnect via double-click or Enter.
- `src/config-helper.ts` — Read/write `opencode.jsonc` via `jsonc-parser` (preserves comments). `findConfig` walks up from directory to worktree root.

## Conventions

- Dynamic UI updates use property mutation (e.g. `el.fg = ...`, `el.content = ...`), not `dialog.replace()`.
- `<select>` needs `focused={true}` to receive keyboard input.
- Textarea content must be set via `.setText()`, not `.value =`.
- `panelHeight` must account for the Dialog wrapper's `paddingTop={terminalHeight/4}` offset.
- **Keyboard shortcut hints** (`[F1]`, `[F3]`, etc.) use `HINT_FG` (`RGBA.fromInts(180, 180, 180, 255)`).
- **Keybinding priority:** opencode core's global bindings (e.g. dialog Escape) use default priority (0). To override them from a plugin, set `priority` higher than 0 in `useBindings()`. Use `enabled` to avoid interfering with scoped bindings (e.g. search input's Escape).

## Reference

- `.agents/rules/opentui-half-row-padding.md` — Read when implementing sub-row visual spacing or half-row padding in OpenTUI (half-block glyphs, absolute overlay, zIndex).
- `.agents/rules/opentui-textarea-highlight.md` — Read when implementing range highlighting inside a `<textarea>` via `syntaxStyle.registerStyle` + `addHighlightByCharRange` (search match highlight, current match style).

## Current Status

- [AGENTS_PROGRESS.md](AGENTS_PROGRESS.md) — Read for the current implementation snapshot, validation results, and remaining project-level follow-ups.
