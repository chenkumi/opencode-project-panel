# install-test-plugin

Install `opencode-project-panel` into a test directory as a local TUI plugin — no npm or cache modification needed.

## How it works

`tui.json`'s `plugin` array supports direct file paths, not just npm package names:

| Format | Example |
|--------|---------|
| Relative path | `../../dist/index.js` (resolved from `tui.json`'s directory) |
| Absolute path | `/home/user/opencode-project-panel/dist/index.js` |
| `file://` URL | `file:///home/user/plugin/index.ts` |

Path-like specs bypass npm entirely — `isPathPluginSpec()` in opencode's `packages/opencode/src/plugin/shared.ts` detects them and loads via `import()` without touching the central cache.

## Setup

```sh
# 1. Build the plugin
bun run build

# 2. Create test directory
mkdir -p test-dir/.opencode
```

**`test-dir/opencode.jsonc`** (optional, for permissions/MCP config)
```json
{
  "$schema": "https://opencode.ai/config.json"
}
```

**`test-dir/.opencode/tui.json`**
```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/abs/path/to/opencode-project-panel/dist/index.js"]
}
```

## Launch

```sh
opencode test-dir
```

## Verify

- Bottom bar shows `[F1] Files | [F3] Permissions`
- `F1` opens the file manager (browses test-dir)
- `F3` opens the permissions panel

## Project's own test directory

This project already has a `test/` directory set up for quick testing:

```
test/
├── opencode.jsonc
└── .opencode/
    └── tui.json            # plugin: ["../../dist/index.js"]
```

```sh
opencode test/
```
