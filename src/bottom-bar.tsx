import type { JSX } from "solid-js"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { RGBA } from "@opentui/core"
import { useBindings } from "@opentui/keymap/solid"
import { writeFileSync, existsSync } from "node:fs"
import path from "node:path"
import NewFileManager, { currentFileActions, focusedPane, isOverlayActive } from "./new-file-manager.js"
import PermissionsPanel from "./panel-permissions.js"
import { findConfig, readPermissions, readTools, readMCPs } from "./config-helper.js"

interface Props {
  api: TuiPluginApi
}

function showPanel(api: TuiPluginApi, panel: () => JSX.Element) {
  api.ui.dialog.replace(panel)
  api.ui.dialog.setSize("xlarge")
}

async function showPermissions(api: TuiPluginApi) {
  const directory = api.state.path.directory
  const worktree = api.state.path.worktree
  let filePath = findConfig(directory, worktree)
  if (!filePath) {
    filePath = path.join(directory, "opencode.jsonc")
    if (!existsSync(filePath)) {
      writeFileSync(filePath, "{\n  \"$schema\": \"https://opencode.ai/config.json\"\n}\n", "utf-8")
    }
  }

  const [skillsResult] = await Promise.all([
    api.client.app.skills({}, { throwOnError: true }).then((r: any) => r.data ?? []).catch(() => []),
  ])

  const skills = skillsResult.map((s: any) => ({
    name: s.name,
    description: s.description,
    location: s.location,
  }))

  const { allow: skAllow, deny: skDeny } = filePath ? readPermissions(filePath) : { allow: [], deny: [] }

  const rawTools = filePath ? readTools(filePath) : {}
  const toolNames = [...new Set([...Object.keys(rawTools), ...["bash", "edit", "write", "read", "grep", "glob", "lsp", "patch", "skill", "todowrite", "webfetch", "websearch", "question"]])].sort()
  const tools: Array<{ name: string; action: "allow" | "ask" | "deny" }> = toolNames.map((name) => {
    const action = rawTools[name]
    return {
      name,
      action: action === "ask" || action === "deny" ? action : "allow",
    }
  })

  const mcps = filePath ? readMCPs(filePath) : []

  showPanel(api, () => (
    <PermissionsPanel
      api={api}
      configFile={filePath}
      skills={skills}
      initialSkillAllow={skAllow}
      initialSkillDeny={skDeny}
      tools={tools}
      mcps={mcps}
    />
  ))
}

const BG = RGBA.fromInts(30, 30, 30, 255)
const FG = RGBA.fromInts(255, 255, 255, 255)
const HINT_FG = RGBA.fromInts(180, 180, 180, 255)

const EmptyBorder = {
  topLeft: "", bottomLeft: "", vertical: "", topRight: "", bottomRight: "",
  horizontal: " ", bottomT: "", topT: "", cross: "", leftT: "", rightT: "",
}

export default function BottomBar(props: Props) {
  const api = props.api

  useBindings(() => ({
    priority: 1,
    commands: [
      {
        name: "home.files.open",
        title: "Files",
        category: "Tools",
        namespace: "palette",
        slashName: "files",
        slashAliases: ["file"],
        run() {
          showPanel(api, () => <NewFileManager api={api} />)
        },
      },
      {
        name: "home.permissions.open",
        title: "Permissions",
        category: "Tools",
        namespace: "palette",
        slashName: "permissions",
        run() {
          showPermissions(api)
        },
      },
    ],
    bindings: [
      { key: "f1", cmd: "home.files.open", desc: "Open file browser" },
      { key: "f3", cmd: "home.permissions.open", desc: "Open permissions" },
      { key: "f7", cmd: () => currentFileActions?.create?.() },
      { key: "f2", cmd: () => currentFileActions?.rename?.() },
      { key: "ctrl+r", cmd: () => currentFileActions?.rename?.() },
      { key: "delete", cmd: () => currentFileActions?.delete?.() },
      { key: "ctrl+g", cmd: () => currentFileActions?.goto?.() },
      { key: "ctrl+f", cmd: () => currentFileActions?.focusFilter?.() },
      { key: "escape", cmd: () => {
        if (isOverlayActive) currentFileActions?.hideOverlay?.()
        else if (focusedPane === "filter" || focusedPane === "preview") currentFileActions?.focusSelect?.()
        else api.ui.dialog.clear()
        return true
      }},
    ],
  }))

  return (
    <box width="100%" flexDirection="column" flexShrink={0} zIndex={100}>
      <box
        position="absolute"
        top={-1}
        left={0}
        width="100%"
        height={1}
        border={["bottom"]}
        borderColor={BG}
        customBorderChars={{ ...EmptyBorder, horizontal: "▄" }}
      />
      <box
        height={1}
        paddingLeft={2}
        paddingRight={2}
        flexDirection="row"
        flexShrink={0}
        gap={3}
        backgroundColor={BG}
      >
        <box flexDirection="row" gap={0} onMouseUp={() => showPanel(api, () => <NewFileManager api={api} />)}>
          <text fg={HINT_FG}>[F1]</text>
          <text fg={FG}> Files</text>
        </box>
        <box flexDirection="row" gap={0} onMouseUp={() => showPermissions(api)}>
          <text fg={HINT_FG}>[F3]</text>
          <text fg={FG}> Permissions</text>
        </box>
      </box>
      <box
        height={1}
        flexShrink={0}
        border={["bottom"]}
        borderColor={BG}
        customBorderChars={{ ...EmptyBorder, horizontal: "▀" }}
      />
    </box>
  )
}
