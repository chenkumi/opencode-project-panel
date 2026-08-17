import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { RGBA } from "@opentui/core"
import { useBindings } from "@opentui/keymap/solid"
import path from "node:path"
import { createEffect, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { findConfig, loadConfig } from "./config-helper.js"
import { logCacheEvent, summarizeCacheTokens } from "./cache-log.js"
import NewFileManager, { currentFileActions, focusedPane, isOverlayActive } from "./file-manager.js"
import PermissionsPanel from "./panel-permissions.js"
import { createRequestCoordinator } from "./request-coordinator.js"

interface Props {
    api: TuiPluginApi
}

type CacheStats = {
    latest?: number
    average?: number
}

function showPanel(api: TuiPluginApi, panel: () => JSX.Element) {
    api.ui.dialog.replace(panel)
    api.ui.dialog.setSize("xlarge")
}

async function showPermissions(api: TuiPluginApi, signal: AbortSignal, isCurrent: () => boolean) {
    const directory = api.state.path.directory
    const worktree = api.state.path.worktree
    const filePath = findConfig(directory, worktree) ?? path.join(directory, "opencode.jsonc")
    const config = loadConfig(filePath)
    if (config.status === "invalid") {
        api.ui.toast({ variant: "error", title: "Permissions", message: "The OpenCode configuration is invalid." })
        return
    }
    if (config.status === "error") {
        api.ui.toast({ variant: "error", title: "Permissions", message: "The OpenCode configuration could not be read." })
        return
    }

    const response = await api.client.app.skills({}, { throwOnError: true, signal }) as any
    if (signal.aborted || !isCurrent()) return
    const skillsResult = response.data ?? []

    const skills = skillsResult.map((s: any) => ({
        name: s.name,
        description: s.description,
        location: s.location,
    }))

    const toolNames = [...new Set([...Object.keys(config.data.tools), ...["bash", "edit", "write", "read", "grep", "glob", "lsp", "patch", "skill", "todowrite", "webfetch", "websearch", "question"]])].sort()
    const tools: Array<{ name: string; action: "allow" | "ask" | "deny" }> = toolNames.map((name) => {
        const action = config.data.tools[name]
        return {
            name,
            action: action === "ask" || action === "deny" ? action : "allow",
        }
    })

    const mcps = config.data.mcps

    showPanel(api, () => (
        <PermissionsPanel
            api={api}
            configFile={filePath}
            skills={skills}
            initialSkillAllow={config.data.skillAllow}
            initialSkillDeny={config.data.skillDeny}
            tools={tools}
            mcps={mcps}
            configRevision={config.status === "ok" ? config.revision : undefined}
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
    let permissionsAbort: AbortController | undefined
    let permissionsGeneration = 0
    const [latestSession, setLatestSession] = createSignal<{ id: string; title: string } | undefined>()
    const [currentSessionID, setCurrentSessionID] = createSignal<string | undefined>()
    const [cacheStats, setCacheStats] = createSignal<CacheStats>({})
    let cacheRequestVersion = 0
    const latestSessionRequests = createRequestCoordinator({ parentSignal: api.lifecycle.signal })
    const cacheRequests = createRequestCoordinator({ parentSignal: api.lifecycle.signal })

    function getCacheSessionID() {
        return currentSessionID()
    }

    function openPermissions() {
        permissionsAbort?.abort()
        const controller = new AbortController()
        const generation = ++permissionsGeneration
        permissionsAbort = controller
        const onLifecycleAbort = () => controller.abort(api.lifecycle.signal.reason)
        if (api.lifecycle.signal.aborted) controller.abort(api.lifecycle.signal.reason)
        else api.lifecycle.signal.addEventListener("abort", onLifecycleAbort, { once: true })

        void showPermissions(api, controller.signal, () => generation === permissionsGeneration)
            .catch(() => {
                if (!controller.signal.aborted && generation === permissionsGeneration) {
                    api.ui.toast({ variant: "error", title: "Permissions", message: "Unable to open the Permissions panel." })
                }
            })
            .finally(() => {
                api.lifecycle.signal.removeEventListener("abort", onLifecycleAbort)
                if (permissionsAbort === controller) permissionsAbort = undefined
            })
    }

    function hasNonZeroToken(tokens: any) {
        return [
            tokens?.input,
            tokens?.output,
            tokens?.reasoning,
            tokens?.cache?.read,
            tokens?.cache?.write,
        ].some((value) => typeof value === "number" && Number.isFinite(value) && value !== 0)
    }

    function getCacheUsage(tokens: any) {
        if (!hasNonZeroToken(tokens)) return undefined
        const input = Math.max(0, tokens.input ?? 0)
        const cacheRead = Math.max(0, tokens.cache?.read ?? 0)
        const cacheWrite = Math.max(0, tokens.cache?.write ?? 0)
        const cached = cacheRead + cacheWrite
        const total = input + cached
        return total > 0 ? { cached, total } : undefined
    }

    function calculateCachePercent(tokens: any) {
        const usage = getCacheUsage(tokens)
        return usage ? Math.round((usage.cached / usage.total) * 100) : undefined
    }

    function fetchCacheStats(sessionID: string) {
        const requestVersion = ++cacheRequestVersion
        logCacheEvent({ kind: "history-request", sessionID, requestVersion })
        void cacheRequests.run(async (signal) => {
            try {
                const res = await api.client.session.messages({ sessionID, limit: 100 }, { throwOnError: true, signal }) as any
                const messages = (Array.isArray(res.data) ? res.data : [])
                    .map((message: any) => message.info ?? message)
                    .toSorted((a: any, b: any) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
                const lastUserIndex = messages.findLastIndex((message: any) => message.role === "user")
                const currentTurn = messages.slice(lastUserIndex + 1)
                const latestMessages = lastUserIndex >= 0 ? currentTurn : messages
                const latest = latestMessages
                    .toReversed()
                    .filter((message: any) => message.role === "assistant")
                    .map((message: any) => getCacheUsage(message.tokens))
                    .find((usage: { cached: number; total: number } | undefined): usage is { cached: number; total: number } => usage !== undefined)
                const aggregate = currentTurn.reduce(
                    (sum: { cached: number; total: number }, message: any) => {
                        if (message.role !== "assistant") return sum
                        const usage = getCacheUsage(message.tokens)
                        if (!usage) return sum
                        return { cached: sum.cached + usage.cached, total: sum.total + usage.total }
                    },
                    { cached: 0, total: 0 },
                )
                const latestPercent = latest ? Math.round((latest.cached / latest.total) * 100) : undefined
                const aggregatePercent = aggregate.total > 0 ? Math.round((aggregate.cached / aggregate.total) * 100) : undefined
                const assistantMessages = messages
                    .filter((message: any) => message.role === "assistant")
                    .map((message: any) => ({
                        id: message.id,
                        created: message.time?.created,
                        tokens: summarizeCacheTokens(message.tokens),
                    }))
                if (signal.aborted || requestVersion !== cacheRequestVersion || getCacheSessionID() !== sessionID) {
                    logCacheEvent({
                        kind: "history-discarded",
                        sessionID,
                        requestVersion,
                        currentRequestVersion: cacheRequestVersion,
                        currentSessionID: getCacheSessionID(),
                        assistantMessages,
                        latestPercent,
                        aggregatePercent,
                    })
                    return
                }
                if (!latest && aggregate.total === 0) {
                    logCacheEvent({ kind: "history-empty", sessionID, requestVersion, assistantMessages })
                    return
                }

                setCacheStats((current) => ({
                    latest: latestPercent ?? current.latest,
                    average: aggregatePercent,
                }))
                logCacheEvent({
                    kind: "history-applied",
                    sessionID,
                    requestVersion,
                    assistantMessages,
                    latestPercent,
                    aggregatePercent,
                })
            } catch {
                logCacheEvent({ kind: "history-error", sessionID, requestVersion })
                // Preserve the last known cache values when history is temporarily unavailable.
            }
        })
    }

    function setActiveSession(sessionID: string | undefined) {
        if (currentSessionID() === sessionID) return
        setCurrentSessionID(sessionID)
        cacheRequestVersion++
        setCacheStats({})
        if (sessionID) fetchCacheStats(sessionID)
    }

    function fetchLatestSession() {
        void latestSessionRequests.run(async (signal) => {
            try {
                const previousCacheSessionID = getCacheSessionID()
                const res = await api.client.session.list({ limit: 1 }, { throwOnError: true, signal }) as any
                const data: Array<{ id: string; title: string }> | undefined = res.data
                const session = data?.[0]
                if (session) {
                    setLatestSession(session)
                    if (!currentSessionID() && previousCacheSessionID !== getCacheSessionID()) {
                        cacheRequestVersion++
                        setCacheStats({})
                    }
                } else {
                    setLatestSession(undefined)
                    cacheRequestVersion++
                    setCacheStats({})
                }
            } catch {
                // Preserve the last known session when history is temporarily unavailable.
            }
        })
    }

    function openLatestSession() {
        const s = latestSession()
        if (s) {
            setActiveSession(s.id)
            api.client.tui.selectSession({ sessionID: s.id })
        }
    }

    let routeInitialized = false
    createEffect(() => {
        const route = api.route.current
        const sessionID = route.name === "session" ? (route.params?.sessionID as string | undefined) : undefined
        if (!routeInitialized) {
            routeInitialized = true
            setCurrentSessionID(sessionID)
            return
        }
        setActiveSession(sessionID)
    })

    onMount(() => {
        const initialSessionID = currentSessionID()
        if (initialSessionID) fetchCacheStats(initialSessionID)
        fetchLatestSession()
        const unsubs: Array<() => void> = []
        for (const evt of ["session.created", "session.updated", "session.deleted"] as const) {
            unsubs.push(api.event.on(evt, fetchLatestSession))
        }
        unsubs.push(api.event.on("message.updated", (event) => {
            if (event.properties.sessionID !== getCacheSessionID()) return
            const info = event.properties.info
            const tokens = info.role === "assistant" ? info.tokens : undefined
            logCacheEvent({
                kind: "message-updated",
                sessionID: event.properties.sessionID,
                messageID: info?.id,
                role: info?.role,
                tokens: summarizeCacheTokens(tokens),
            })
            if (info.role !== "assistant") {
                fetchCacheStats(event.properties.sessionID)
                return
            }
            const percent = calculateCachePercent(info.tokens)
            logCacheEvent({
                kind: "message-cache-calculated",
                sessionID: event.properties.sessionID,
                messageID: info?.id,
                tokens: summarizeCacheTokens(tokens),
                percent,
            })
            if (percent === undefined) {
                fetchCacheStats(event.properties.sessionID)
                return
            }
            cacheRequestVersion++
            setCacheStats((current) => ({ ...current, latest: percent }))
            fetchCacheStats(event.properties.sessionID)
        }))
        unsubs.push(api.event.on("tui.session.select", (event) => {
            setActiveSession(event.properties.sessionID)
        }))
        onCleanup(() => {
            permissionsGeneration++
            permissionsAbort?.abort()
            latestSessionRequests.dispose()
            cacheRequests.dispose()
            unsubs.forEach((fn) => fn())
        })
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
                    openPermissions()
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
                <box flexDirection="row" gap={0} onMouseUp={openPermissions}>
                    <text fg={HINT_FG}>[F3]</text>
                    <text fg={FG}> Permissions</text>
                </box>
                <box flexGrow={1} flexDirection="row" gap={0}
                    onMouseUp={openLatestSession}>
                    {(() => {
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
                {(cacheStats().average !== undefined || cacheStats().latest !== undefined) && (
                    <text fg={HINT_FG} marginLeft={1}>
                        Cached {cacheStats().latest ?? "--"}%/{cacheStats().average ?? "--"}%
                    </text>
                )}
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
