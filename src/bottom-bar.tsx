import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { RGBA } from "@opentui/core"
import { useBindings } from "@opentui/keymap/solid"
import { existsSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { findConfig, readMCPs, readPermissions, readTools } from "./config-helper.js"
import NewFileManager, { currentFileActions, focusedPane, isOverlayActive } from "./file-manager.js"
import PermissionsPanel from "./panel-permissions.js"

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
    const [latestSession, setLatestSession] = createSignal<{ id: string; title: string } | undefined>()
    const [currentSessionID, setCurrentSessionID] = createSignal<string | undefined>()

    async function fetchLatestSession() {
        try {
            const res = await api.client.session.list({ limit: 1 }, { throwOnError: true }) as any
            const data: Array<{ id: string; title: string }> | undefined = res.data
            if (data && data.length > 0) {
                setLatestSession(data[0])
            }
            if (api.route.current.name !== "session") {
                setCurrentSessionID(undefined)
            }
        } catch {
            // ignore
        }
    }

    function openLatestSession() {
        const s = latestSession()
        if (s) {
            setCurrentSessionID(s.id)
            api.client.tui.selectSession({ sessionID: s.id })
        }
    }

    onMount(() => {
        if (api.route.current.name === "session") {
            setCurrentSessionID((api.route.current as any).params?.sessionID)
        }
        fetchLatestSession()
        const unsubs: Array<() => void> = []
        for (const evt of ["session.created", "session.updated", "session.deleted"]) {
            unsubs.push(api.event.on(evt, fetchLatestSession))
        }
        unsubs.push(api.event.on("tui.session.select", (e: any) => {
            setCurrentSessionID(e.properties?.sessionID)
        }))
        onCleanup(() => unsubs.forEach((fn) => fn()))
    })

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
            {
                name: "home.session.open",
                title: "Open latest session",
                category: "Tools",
                namespace: "palette",
                slashName: "session",
                run() {
                    openLatestSession()
                },
            },
        ],
        bindings: [
            { key: "f1", cmd: "home.files.open", desc: "Open file browser" },
            { key: "f3", cmd: "home.permissions.open", desc: "Open permissions" },
            { key: "f6", cmd: "home.session.open", desc: "Open latest session" },
            { key: "f7", cmd: () => currentFileActions?.create?.() },
            { key: "f2", cmd: () => currentFileActions?.rename?.() },
            { key: "f5", cmd: () => currentFileActions?.reload?.() },
            { key: "ctrl+r", cmd: () => currentFileActions?.returnToProjectRoot?.() },
            { key: "delete", cmd: () => currentFileActions?.delete?.() },
            { key: "ctrl+g", cmd: () => currentFileActions?.goto?.() },
            { key: "ctrl+f", cmd: () => currentFileActions?.focusFilter?.() },
            {
                key: "escape", cmd: () => {
                    if (isOverlayActive) currentFileActions?.hideOverlay?.()
                    else if (focusedPane === "filter" || focusedPane === "preview") currentFileActions?.focusSelect?.()
                    else api.ui.dialog.clear()
                    return true
                }
            },
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
                <box flexGrow={1} flexDirection="row" gap={0}
                    onMouseUp={openLatestSession}>
                    {(() => {
                        if (currentSessionID()) return <text />
                        const s = latestSession()
                        if (!s) return <text />
                        return (
                            <>
                                <text fg={HINT_FG} marginRight={1}>[F6]</text>
                                <text fg={FG} marginRight={1}>Last Session:</text>
                                <text fg={FG} truncate wrapMode="none">{s.title}</text>
                            </>
                        )
                    })()}
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
