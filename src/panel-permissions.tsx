import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { SelectOption, TextRenderable } from "@opentui/core"
import { RGBA, SyntaxStyle } from "@opentui/core"
import { useBindings } from "@opentui/keymap/solid"
import { useTerminalDimensions } from "@opentui/solid"
import { setMCPEnabled, setPermission, setToolPermission, type ConfigMutationResult } from "./config-helper.js"
import type { FileRevision } from "./file-io.js"

interface SkillItem {
    name: string
    description?: string
    location: string
}

interface ToolItem {
    name: string
    action: "allow" | "ask" | "deny"
}

interface MCPItem {
    name: string
    type: string
    enabled: boolean
    command?: string[]
    url?: string
}

interface Props {
    api: TuiPluginApi
    configFile: string
    skills: SkillItem[]
    initialSkillAllow: string[]
    initialSkillDeny: string[]
    tools: ToolItem[]
    mcps: MCPItem[]
    configRevision?: FileRevision
}

const HINT_FG = RGBA.fromInts(180, 180, 180, 255)
const FG = RGBA.fromInts(255, 255, 255, 255)

export default function PermissionsPanel(props: Props) {
    const dimensions = useTerminalDimensions()
    const theme = () => props.api.theme.current
    let configRevision = props.configRevision

    let activeTab = 0
    let tabSkillsEl: TextRenderable
    let tabToolsEl: TextRenderable
    let tabMcpEl: TextRenderable

    let selectRef: any
    let skillsDetailBox: any
    let toolsDetailBox: any
    let mcpsDetailBox: any

    // --- Skills ---
    let skNameEl: TextRenderable
    let skPathEl: TextRenderable
    let skCopyEl: TextRenderable
    let skStatusEl: TextRenderable
    let skLastClick = 0
    let skLastIdx = -1

    const skAllowSet = new Set(props.initialSkillAllow)
    const skDenySet = new Set(props.initialSkillDeny)
    const skCatchAllDeny = skDenySet.has("*")

    function mutationSucceeded(result: ConfigMutationResult): boolean {
        if (result.status === "ok") {
            configRevision = result.revision
            return true
        }
        const message = result.status === "conflict"
            ? "The configuration changed externally. Reload Permissions before editing."
            : result.status === "invalid"
                ? "The OpenCode configuration is invalid."
                : "The configuration could not be saved."
        props.api.ui.toast({ variant: "error", title: "Permissions", message })
        return false
    }

    function skIsAllow(s: SkillItem): boolean {
        if (skAllowSet.has("*")) return true
        if (skDenySet.has(s.name)) return false
        if (skAllowSet.has(s.name)) return true
        return !skCatchAllDeny
    }

    const skToOptions = () =>
        props.skills.map((s) => ({
            name: (skIsAllow(s) ? "[allow] " : "[deny]  ") + s.name,
            description: s.description ?? "",
            value: s.name,
        }))

    function skUpdateDetail(s: SkillItem | null) {
        if (!s) { skNameEl.content = ""; skPathEl.content = ""; skCopyEl.content = ""; skStatusEl.content = ""; return }
        skNameEl.content = s.name
        skPathEl.content = s.location
        skCopyEl.content = "[Copy]"
        skStatusEl.content = skIsAllow(s) ? "allowed" : "denied"
    }

    function skToggle(name: string) {
        const s = props.skills.find((x) => x.name === name)
        if (!s) return
        const was = skIsAllow(s)
        const result = setPermission(props.configFile, name, was ? "deny" : "allow", configRevision)
        if (!mutationSucceeded(result)) return
        skAllowSet.delete(name)
        skDenySet.delete(name)
        if (was) skDenySet.add(name)
        else skAllowSet.add(name)
        selectRef.options = currentOptions()
        skUpdateDetail(s)
    }

    // --- Tools ---
    let tlNameEl: TextRenderable
    let tlActionEl: TextRenderable
    let tlLastClick = 0
    let tlLastIdx = -1

    const tlToOptions = () =>
        props.tools.map((t) => ({
            name: (t.action === "allow" ? "[allow] " : t.action === "ask" ? "[ask]   " : "[deny]  ") + t.name,
            description: t.action,
            value: t.name,
        }))

    function tlUpdateDetail(t: ToolItem | null) {
        if (!t) { tlNameEl.content = ""; tlActionEl.content = ""; return }
        tlNameEl.content = t.name
        tlActionEl.content = t.action === "allow" ? "allowed" : t.action === "ask" ? "ask" : "denied"
    }

    function tlToggle(name: string) {
        const t = props.tools.find((x) => x.name === name)
        if (!t) return
        const order = ["allow", "ask", "deny"] as const
        const idx = order.indexOf(t.action as typeof order[number])
        const next = order[(idx + 1) % order.length]!
        const result = setToolPermission(props.configFile, name, next, configRevision)
        if (!mutationSucceeded(result)) return
        t.action = next
        selectRef.options = currentOptions()
        tlUpdateDetail(t)
    }

    // --- MCP ---
    let mcpNameEl: TextRenderable
    let mcpTypeEl: TextRenderable
    let mcpDetailEl: TextRenderable
    let mcpStatusEl: TextRenderable
    let mcpLastClick = 0
    let mcpLastIdx = -1

    const mcpToOptions = () =>
        props.mcps.map((m) => ({
            name: (m.enabled ? "[enabled] " : "[disabled]") + m.name,
            description: m.type,
            value: m.name,
        }))

    function mcpUpdateDetail(m: MCPItem | null) {
        if (!m) { mcpNameEl.content = ""; mcpTypeEl.content = ""; mcpDetailEl.content = ""; mcpStatusEl.content = ""; return }
        mcpNameEl.content = m.name
        mcpTypeEl.content = m.type
        mcpStatusEl.content = m.enabled ? "enabled" : "disabled"
        mcpDetailEl.content = m.type === "local" ? (m.command?.join(" ") ?? "") : (m.url ?? "")
    }

    function mcpToggle(name: string) {
        const m = props.mcps.find((x) => x.name === name)
        if (!m) return
        const next = !m.enabled
        const result = setMCPEnabled(props.configFile, name, next, configRevision)
        if (!mutationSucceeded(result)) return
        m.enabled = next
        selectRef.options = currentOptions()
        mcpUpdateDetail(m)
    }

    // --- Shared select logic ---
    function currentOptions() {
        if (activeTab === 0) return skToOptions()
        if (activeTab === 1) return tlToOptions()
        return mcpToOptions()
    }

    const handleChange = (_i: number, opt: SelectOption | null) => {
        const name = opt?.value
        if (!name) return
        if (activeTab === 0) {
            skUpdateDetail(props.skills.find((s) => s.name === name) ?? null)
        } else if (activeTab === 1) {
            tlUpdateDetail(props.tools.find((t) => t.name === name) ?? null)
        } else {
            mcpUpdateDetail(props.mcps.find((m) => m.name === name) ?? null)
        }
    }

    const handleSelect = (_i: number, opt: SelectOption | null) => {
        const name = opt?.value
        if (!name) return
        if (activeTab === 0) skToggle(name)
        else if (activeTab === 1) tlToggle(name)
        else mcpToggle(name)
    }

    // --- Tab switching ---
    const defaultTabColor = () => theme().textMuted
    const activeTabColor = () => theme().text

    function switchTab(idx: number) {
        activeTab = idx
        tabSkillsEl.fg = idx === 0 ? activeTabColor() : defaultTabColor()
        tabToolsEl.fg = idx === 1 ? activeTabColor() : defaultTabColor()
        tabMcpEl.fg = idx === 2 ? activeTabColor() : defaultTabColor()
        skillsDetailBox.visible = idx === 0
        toolsDetailBox.visible = idx === 1
        mcpsDetailBox.visible = idx === 2
        selectRef.options = currentOptions()
    }

    function cycleTab() {
        switchTab((activeTab + 1) % 3)
    }

    useBindings(() => ({
        priority: 2,
        bindings: [
            { key: "1", cmd: () => switchTab(0) },
            { key: "2", cmd: () => switchTab(1) },
            { key: "3", cmd: () => switchTab(2) },
            { key: "tab", cmd: cycleTab },
        ],
    }))

    const syntaxStyle = () => SyntaxStyle.fromStyles({ default: { fg: theme().markdownText } })

    // --- Layout ---
    const panelWidth = () => Math.min(Math.max(dimensions().width - 2, 60), 116)
    const panelHeight = () => Math.max(Math.floor(dimensions().height * 0.78) - 2, 22)
    const halfWidth = () => Math.floor(panelWidth() / 2)

    const firstSkill = props.skills[0]
    const firstTool = props.tools[0]
    const firstMcp = props.mcps[0]

    return (
        <box width={panelWidth()} height={panelHeight()} flexDirection="column">
            <box paddingLeft={2} paddingRight={2} flexShrink={0} flexDirection="row">
                <text fg={theme().text}>Permissions</text>
                <box flexGrow={1} />
                <box flexDirection="row" onMouseUp={() => props.api.ui.dialog.clear()}>
                    <text fg={HINT_FG}>[ESC]</text>
                    <text fg={FG}> Close</text>
                </box>
            </box>
            <box paddingLeft={2} flexShrink={0}>
                <text fg={theme().textMuted}>Path: {props.configFile}</text>
            </box>

            {/* Tab bar in a single row with bottom border */}
            <box flexDirection="row" gap={2} paddingLeft={2} paddingTop={1} flexShrink={0} border={["bottom"]} borderColor={theme().textMuted}>
                <text ref={(el) => { tabSkillsEl = el }} fg={activeTabColor()} onMouseDown={() => switchTab(0)}>Skills</text>
                <text ref={(el) => { tabToolsEl = el }} fg={defaultTabColor()} onMouseDown={() => switchTab(1)}>Tools</text>
                <text ref={(el) => { tabMcpEl = el }} fg={defaultTabColor()} onMouseDown={() => switchTab(2)}>MCPs</text>
            </box>
            <box flexDirection="row" flexGrow={1} minHeight={5}>
                <select
                    ref={(el) => { selectRef = el }}
                    options={currentOptions()}
                    showDescription={false}
                    focused={true}
                    onChange={handleChange}
                    onSelect={handleSelect}
                    height="100%"
                    width={halfWidth()}
                    onMouseDown={(event: any) => {
                        const len = activeTab === 0 ? props.skills.length : activeTab === 1 ? props.tools.length : props.mcps.length
                        const idx = Math.floor(event.y - selectRef.screenY)
                        if (idx >= 0 && idx < len) {
                            const now = Date.now()
                            const lc = activeTab === 0 ? skLastClick : activeTab === 1 ? tlLastClick : mcpLastClick
                            const li = activeTab === 0 ? skLastIdx : activeTab === 1 ? tlLastIdx : mcpLastIdx
                            if (idx === li && now - lc < 500) {
                                handleSelect(idx, selectRef.options[idx])
                            } else {
                                selectRef.setSelectedIndex(idx)
                            }
                            if (activeTab === 0) { skLastClick = now; skLastIdx = idx }
                            else if (activeTab === 1) { tlLastClick = now; tlLastIdx = idx }
                            else { mcpLastClick = now; mcpLastIdx = idx }
                        }
                    }}
                />
                <scrollbox
                    width={halfWidth()}
                    height="100%"
                    backgroundColor={theme().backgroundPanel}
                    scrollbarOptions={{ visible: false }}
                >
                    <box ref={(el) => { skillsDetailBox = el }} padding={1} flexDirection="column" gap={1}>
                        <text ref={(el) => { skNameEl = el }} fg={theme().text}>{firstSkill?.name ?? ""}</text>
                        <text ref={(el) => { skStatusEl = el }} fg={theme().textMuted}>{firstSkill ? (skIsAllow(firstSkill) ? "allowed" : "denied") : ""}</text>
                        <box flexDirection="row" gap={1}>
                            <text ref={(el) => { skPathEl = el }} fg={theme().textMuted}>{firstSkill?.location ?? ""}</text>
                            <text ref={(el) => { skCopyEl = el }} fg={theme().primary}
                                onMouseDown={() => {
                                    if (!firstSkill) return
                                    props.api.renderer.copyToClipboardOSC52(firstSkill.location)
                                    skCopyEl.content = "Copied!"
                                }}
                            >[Copy]</text>
                        </box>
                        <markdown content={firstSkill?.description ?? ""} syntaxStyle={syntaxStyle()} fg={theme().markdownText} />
                    </box>
                    <box ref={(el) => { toolsDetailBox = el }} visible={false} padding={1} flexDirection="column" gap={1}>
                        <text ref={(el) => { tlNameEl = el }} fg={theme().text}>{firstTool?.name ?? ""}</text>
                        <text ref={(el) => { tlActionEl = el }} fg={theme().textMuted}>{firstTool ? (firstTool.action === "allow" ? "allowed" : firstTool.action === "ask" ? "ask" : "denied") : ""}</text>
                    </box>
                    <box ref={(el) => { mcpsDetailBox = el }} visible={false} padding={1} flexDirection="column" gap={1}>
                        <text ref={(el) => { mcpNameEl = el }} fg={theme().text}>{firstMcp?.name ?? ""}</text>
                        <text ref={(el) => { mcpTypeEl = el }} fg={theme().textMuted}>{firstMcp?.type ?? ""}</text>
                        <text ref={(el) => { mcpDetailEl = el }} fg={theme().text}>{firstMcp ? (firstMcp.type === "local" ? firstMcp.command?.join(" ") ?? "" : firstMcp.url ?? "") : ""}</text>
                        <text ref={(el) => { mcpStatusEl = el }} fg={theme().textMuted}>{firstMcp ? (firstMcp.enabled ? "enabled" : "disabled") : ""}</text>
                    </box>
                </scrollbox>
            </box>

            <box paddingLeft={2} paddingTop={1} paddingBottom={1} flexShrink={0} flexDirection="row" gap={3}>
                <box flexDirection="row" gap={0} onMouseDown={() => switchTab(0)}>
                    <text fg={HINT_FG}>[1]</text>
                    <text fg={FG}> Skills</text>
                </box>
                <box flexDirection="row" gap={0} onMouseDown={() => switchTab(1)}>
                    <text fg={HINT_FG}>[2]</text>
                    <text fg={FG}> Tools</text>
                </box>
                <box flexDirection="row" gap={0} onMouseDown={() => switchTab(2)}>
                    <text fg={HINT_FG}>[3]</text>
                    <text fg={FG}> MCPs</text>
                </box>
            </box>
        </box>
    )
}
