# opencode-project-panel

OpenCode TUI plugin that adds a bottom bar with:

- a project file manager with Markdown/code preview and editing;
- a Permissions panel for Skills, Tools, and MCP configuration.

## Install

Add the package to your OpenCode TUI configuration (`tui.json` or
`tui.jsonc`):

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-project-panel"]
}
```

OpenCode installs npm TUI plugins automatically at startup. Do not add this
package to the server plugin list in `opencode.json`; this package is a TUI
plugin and exposes the `./tui` entrypoint. The plugin uses the current project
configuration (`opencode.json` or `opencode.jsonc`) when editing permissions
and MCP settings.

## Shortcuts

- `F1`: open the file manager
- `F3`: open Permissions
- `F2`: rename the selected file
- `F7`: create a file or directory
- `Delete`: delete the selected file
- `Ctrl+G`: go to a path
- `Ctrl+R`: return to the project root

## Development

```sh
bun install
bun run typecheck
bun run build
```

The package entry point is the generated `dist/index.js` file. Runtime UI
dependencies remain external in the bundle and are declared in `dependencies`
so OpenCode's Bun-based plugin loader can resolve them.

## License

MIT
