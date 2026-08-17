import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { TextRenderable } from "@opentui/core"
import { RGBA, SyntaxStyle, parseColor } from "@opentui/core"
import { useBindings } from "@opentui/keymap/solid"
import { useTerminalDimensions } from "@opentui/solid"
import path from "node:path"
import { Show, createSignal, onMount } from "solid-js"
import {
    MAX_EDIT_BYTES,
    MAX_PREVIEW_BYTES,
    MAX_SEARCH_MATCHES,
    readTextFile,
    writeTextFileAtomic,
    type FileRevision,
    type TextReadResult,
} from "./file-io.js"

interface Props {
    api: TuiPluginApi
    filePath: string
    initialMode?: Mode
    onBack?: () => void
}

type Mode = "preview" | "edit"
type FocusTarget = "content" | "search"

interface SearchMatch {
    start: number
    end: number
}

const SYNTAX_STYLE = SyntaxStyle.fromStyles({
    default: { fg: parseColor("#E6EDF3") },
    keyword: { fg: parseColor("#FF7B72"), bold: true },
    string: { fg: parseColor("#A5D6FF") },
    comment: { fg: parseColor("#8B949E"), italic: true },
    number: { fg: parseColor("#79C0FF") },
    function: { fg: parseColor("#D2A8FF") },
    type: { fg: parseColor("#FFA657") },
    operator: { fg: parseColor("#FF7B72") },
    variable: { fg: parseColor("#E6EDF3") },
    property: { fg: parseColor("#79C0FF") },
    "punctuation.bracket": { fg: parseColor("#F0F6FC") },
    "punctuation.delimiter": { fg: parseColor("#C9D1D9") },
    "markup.heading": { fg: parseColor("#58A6FF"), bold: true },
    "markup.bold": { fg: parseColor("#F0F6FC"), bold: true },
    "markup.italic": { fg: parseColor("#F0F6FC"), italic: true },
    "markup.list": { fg: parseColor("#FF7B72") },
    "markup.quote": { fg: parseColor("#8B949E"), italic: true },
    "markup.raw": { fg: parseColor("#A5D6FF"), bg: parseColor("#161B22") },
    "markup.link": { fg: parseColor("#58A6FF"), underline: true },
    "markup.link.url": { fg: parseColor("#58A6FF"), underline: true },
    "diff.plus": { fg: parseColor("#3FB950") },
    "diff.minus": { fg: parseColor("#F85149") },
    conceal: { fg: parseColor("#6E7681") },
})

const SEARCH_HL_STYLE_ID = SYNTAX_STYLE.registerStyle("search-match", { bg: parseColor("#FF8C00"), fg: parseColor("#000000") })
const SEARCH_CURRENT_HL_STYLE_ID = SYNTAX_STYLE.registerStyle("search-current", { bg: parseColor("#FFFF00"), fg: parseColor("#000000"), bold: true })

const EXT_TO_FILETYPE: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescriptreact",
    ".mts": "typescript",
    ".cts": "typescript",
    ".js": "javascript",
    ".jsx": "javascriptreact",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".json": "json",
    ".md": "markdown",
    ".mdx": "markdown",
    ".css": "css",
    ".html": "html",
    ".xml": "xml",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".sh": "bash",
    ".bash": "bash",
    ".zsh": "bash",
    ".py": "python",
    ".rb": "ruby",
    ".go": "go",
    ".rs": "rust",
    ".zig": "zig",
    ".java": "java",
    ".kt": "kotlin",
    ".swift": "swift",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".hpp": "cpp",
    ".cs": "csharp",
    ".lua": "lua",
    ".sql": "sql",
    ".graphql": "graphql",
    ".proto": "protobuf",
    ".tf": "terraform",
    ".scala": "scala",
    ".r": "r",
    ".pl": "perl",
    ".ex": "elixir",
    ".exs": "elixir",
    ".erl": "erlang",
    ".clj": "clojure",
    ".nix": "nix",
}

const MD_EXT = new Set([".md", ".mdx", ".markdown"])

function isMarkdownPath(fp: string): boolean {
    return MD_EXT.has(path.extname(fp).toLowerCase())
}

const HINT_FG = RGBA.fromInts(180, 180, 180, 255)
const FG = RGBA.fromInts(255, 255, 255, 255)
// OpenTUI's native EditBuffer plainText accessor is capped at 1 MiB.
const MAX_EDITOR_BYTES = 1024 * 1024

export default function FileViewer(props: Props) {
    let codeRef: any
    let markdownRef: any
    let textareaRef: any
    let searchInputRef: any
    let previewScrollBox: any
    let dirtyEl!: TextRenderable
    let matchCountEl: TextRenderable
    let previewButtonsBox: any
    let editButtonsBox: any
    let searchBox: any
    let bottomBarBox: any
    let statusEl: TextRenderable
    const dimensions = useTerminalDimensions()
    const theme = () => props.api.theme.current

    const isMarkdown = isMarkdownPath(props.filePath)
    const filetype = EXT_TO_FILETYPE[path.extname(props.filePath).toLowerCase()] ?? ""

    const [mode, setMode] = createSignal<Mode>(props.initialMode ?? "preview")
    const [focusedId, setFocusedId] = createSignal<FocusTarget>("content")
    const [textareaTarget, setTextareaTarget] = createSignal<any>()
    const [searchInputTarget, setSearchInputTarget] = createSignal<any>()
    const [closeConfirm, setCloseConfirm] = createSignal(false)

    let dirty = false
    let originalContent = ""
    let previewContent = ""
    let originalRevision: FileRevision | undefined
    let statusMessage = ""
    let searchQuery = ""
    let matches: SearchMatch[] = []
    let currentMatch = -1
    let matchesTruncated = false

    function setStatus(message: string) {
        statusMessage = message
        if (statusEl) statusEl.content = message
    }

    function applyReadResult(result: TextReadResult, purpose: "preview" | "edit"): boolean {
        if (result.status === "error") {
            setStatus("Read failed")
            return false
        }
        if (result.status === "binary") {
            setStatus("Binary file")
            return false
        }
        if (result.status === "too-large") {
            setStatus(purpose === "edit" ? "Too large for editor (1 MiB limit)" : "Too large for preview")
            return false
        }

        if (purpose === "preview") {
            previewContent = result.content
            originalContent = result.content
        } else {
            originalContent = result.content
        }
        originalRevision = result.revision
        setStatus(result.status === "truncated" ? "Preview truncated at 1 MiB" : "")
        return true
    }

    function loadFromDisk(purpose: "preview" | "edit"): boolean {
        return applyReadResult(readTextFile(
            props.filePath,
            purpose === "preview" ? MAX_PREVIEW_BYTES : Math.min(MAX_EDIT_BYTES, MAX_EDITOR_BYTES),
            purpose,
        ), purpose)
    }

    loadFromDisk("preview")

    const panelWidth = () => Math.min(Math.max(dimensions().width - 2, 60), 116)
    const panelHeight = () => Math.max(Math.floor(dimensions().height * 0.78) - 2, 22)

    const refreshMatchCount = () => {
        if (matches.length === 0) {
            matchCountEl.content = searchQuery ? "0/0" : ""
        } else {
            matchCountEl.content = `${currentMatch + 1}/${matches.length}${matchesTruncated ? "+" : ""}`
        }
    }

    function refreshDirtyState() {
        const nextDirty = textareaRef.plainText !== originalContent
        dirty = nextDirty
        dirtyEl.content = nextDirty ? "*" : ""
    }

    function setFocusTarget(id: FocusTarget) {
        setFocusedId(id)
        if (id === "content") {
            searchInputRef?.blur()
            if (mode() === "edit") textareaRef?.focus()
        } else {
            if (mode() === "edit") textareaRef?.blur()
            searchInputRef?.focus()
        }
    }

    function setModeVisible(next: Mode) {
        setMode(next)
        const isPrev = next === "preview"
        if (previewScrollBox) previewScrollBox.visible = isPrev
        if (textareaRef) textareaRef.visible = !isPrev
        if (previewButtonsBox) previewButtonsBox.visible = isPrev
        if (editButtonsBox) editButtonsBox.visible = !isPrev
        if (searchBox) searchBox.visible = !isPrev
        if (bottomBarBox) bottomBarBox.paddingBottom = isPrev ? 1 : 0
        if (isPrev) {
            if (isMarkdown) markdownRef.content = previewContent
            else codeRef.content = previewContent
        } else {
            textareaRef.setText(originalContent)
        }
        setFocusTarget("content")
    }

    function switchMode(next: Mode) {
        if (next === "edit" && mode() !== "edit") {
            if (!loadFromDisk("edit")) return
            if (isMarkdown) markdownRef.content = originalContent
            else codeRef.content = originalContent
        }
        setModeVisible(next)
    }

    function reload() {
        if (!loadFromDisk(mode())) return
        if (isMarkdown) markdownRef.content = originalContent
        else codeRef.content = originalContent
        textareaRef.setText(originalContent)
        dirty = false
        dirtyEl.content = ""
        matches = []
        currentMatch = -1
        matchesTruncated = false
        refreshMatchCount()
    }

    function save() {
        const result = writeTextFileAtomic(props.filePath, textareaRef.plainText, originalRevision)
        if (result.status !== "ok") {
            const message = result.status === "conflict"
                ? "The file changed externally. Reload before saving."
                : "Unable to save file."
            props.api.ui.toast({ variant: "error", title: "File Viewer", message })
            return
        }
        originalContent = textareaRef.plainText
        originalRevision = result.revision
        loadFromDisk("preview")
        dirty = false
        dirtyEl.content = ""
        setModeVisible("preview")
    }

    function cancelEdit() {
        textareaRef.setText(originalContent)
        loadFromDisk("preview")
        dirty = false
        dirtyEl.content = ""
        setModeVisible("preview")
    }

    function pageUp() {
        if (!textareaRef) return
        const vp = textareaRef.editorView.getViewport()
        const cur = textareaRef.logicalCursor.row
        textareaRef.gotoLine(Math.max(0, cur - vp.height))
    }

    function pageDown() {
        if (!textareaRef) return
        const vp = textareaRef.editorView.getViewport()
        const cur = textareaRef.logicalCursor.row
        textareaRef.gotoLine(cur + vp.height)
    }

    function toggleMode() {
        if (mode() === "preview") switchMode("edit")
        else cancelEdit()
    }

    function requestBack() {
        if (dirty) setCloseConfirm(true)
        else props.onBack?.()
    }

    function computeMatches(query: string) {
        searchQuery = query
        if (!textareaRef) return
        textareaRef.clearAllHighlights()
        if (!query) {
            matches = []
            currentMatch = -1
            matchesTruncated = false
            refreshMatchCount()
            return
        }
        const found: SearchMatch[] = []
        const text = textareaRef.plainText
        let pos = 0
        while (pos <= text.length && found.length < MAX_SEARCH_MATCHES) {
            const idx = text.indexOf(query, pos)
            if (idx === -1) break
            found.push({ start: idx, end: idx + query.length })
            pos = idx + query.length
        }
        matches = found
        matchesTruncated = pos <= text.length && text.indexOf(query, pos) !== -1
        currentMatch = matches.length > 0 ? 0 : -1
        applyHighlights()
        refreshMatchCount()
        scrollToCurrentMatch()
    }

    function applyHighlights() {
        if (!textareaRef || !matches.length) return
        const text = textareaRef.plainText
        textareaRef.clearAllHighlights()
        let scan = 0
        let newlines = 0
        const displayOffset = (offset: number) => {
            while (scan < offset && scan < text.length) {
                if (text[scan] === "\n") newlines++
                scan++
            }
            return offset - newlines
        }
        matches.forEach((m, i) => {
            textareaRef.addHighlightByCharRange({
                start: displayOffset(m.start),
                end: displayOffset(m.end),
                styleId: i === currentMatch ? SEARCH_CURRENT_HL_STYLE_ID : SEARCH_HL_STYLE_ID,
                hlRef: i,
            })
        })
    }

    function scrollToCurrentMatch() {
        const match = matches[currentMatch]
        if (!textareaRef || !match) return
        textareaRef.cursorOffset = match.start
    }

    function nextMatch() {
        if (matches.length === 0) return
        currentMatch = (currentMatch + 1) % matches.length
        applyHighlights()
        refreshMatchCount()
        scrollToCurrentMatch()
    }

    function prevMatch() {
        if (matches.length === 0) return
        currentMatch = (currentMatch - 1 + matches.length) % matches.length
        applyHighlights()
        refreshMatchCount()
        scrollToCurrentMatch()
    }

    useBindings(() => ({
        priority: 2,
        enabled: () => focusedId() !== "search",
        bindings: [
            { key: "f5", cmd: reload },
            { key: "ctrl+e", cmd: toggleMode },
            { key: "ctrl+q", cmd: cancelEdit },
        ],
    }))

    useBindings(() => ({
        priority: 2,
        enabled: () => mode() === "edit",
        bindings: [
            { key: "ctrl+n", cmd: nextMatch },
            { key: "ctrl+p", cmd: prevMatch },
            { key: "f3", cmd: nextMatch },
            { key: "pageup", cmd: pageUp },
            { key: "pagedown", cmd: pageDown },
        ],
    }))

    useBindings(() => ({
        priority: 2,
        enabled: () => mode() === "preview",
        bindings: [
            { key: "home", cmd: () => { if (previewScrollBox) previewScrollBox.scrollTop = 0 } },
            { key: "end", cmd: () => { if (previewScrollBox) previewScrollBox.scrollTop = previewScrollBox.scrollHeight - previewScrollBox.height } },
            { key: "up", cmd: () => previewScrollBox?.scrollBy(-1) },
            { key: "down", cmd: () => previewScrollBox?.scrollBy(1) },
            { key: "pageup", cmd: () => { if (previewScrollBox) { const h = previewScrollBox.height; if (h > 0) previewScrollBox.scrollTop -= h } } },
            { key: "pagedown", cmd: () => { if (previewScrollBox) { const h = previewScrollBox.height; if (h > 0) previewScrollBox.scrollTop += h } } },
        ],
    }))

    useBindings(() => ({
        target: textareaTarget,
        enabled: textareaTarget() !== undefined,
        priority: 1,
        bindings: [
            {
                key: "return",
                cmd: () => textareaRef?.newLine(),
            },
            {
                key: "home",
                cmd: () => textareaRef?.gotoLineHome(),
            },
            {
                key: "end",
                cmd: () => textareaRef?.gotoLineEnd(),
            },
            {
                key: "ctrl+s",
                cmd: () => {
                    if (mode() === "edit") save()
                },
            },
            { key: "ctrl+f", cmd: () => setFocusTarget("search") },
        ],
    }))

    useBindings(() => ({
        target: searchInputTarget,
        enabled: searchInputTarget() !== undefined,
        priority: 1,
        bindings: [
            {
                key: "escape",
                cmd: () => setFocusTarget("content"),
            },
        ],
    }))

    useBindings(() => ({
        priority: 2,
        enabled: () => focusedId() !== "search",
        bindings: [
            {
                key: "escape",
                cmd: () => {
                    requestBack()
                    return true
                },
            },
        ],
    }))

    useBindings(() => ({
        priority: 3,
        enabled: () => closeConfirm(),
        bindings: [
            { key: "escape", cmd: () => { setCloseConfirm(false); return true } },
            { key: "return", cmd: () => { props.onBack?.(); return true } },
        ],
    }))

    onMount(() => {
        if (props.initialMode === "edit") {
            switchMode("edit")
        }
    })

    return (
        <box width={panelWidth()} height={panelHeight()} flexDirection="column">

            <box paddingLeft={2} paddingRight={2} flexShrink={0} border={["bottom"]} borderColor={theme().textMuted} flexDirection="column">
                <box height={1} flexShrink={0} flexDirection="row" width="100%">
                    <text flexGrow={1} fg={theme().text}>File Path: {props.filePath}</text>
                    <text ref={(el) => { dirtyEl = el }} fg={theme().textMuted} />
                </box>
                <box height={1} flexShrink={0} flexDirection="row" width="100%" gap={3}>
                    <Show when={mode() === "preview"}>
                        <box flexDirection="row" gap={0} onMouseDown={reload}>
                            <text fg={HINT_FG}>[F5]</text>
                            <text fg={theme().text}> Reload</text>
                        </box>
                    </Show>

                    <Show when={mode() === "preview"}>
                        <box flexDirection="row" gap={0} onMouseDown={() => switchMode("edit")}>
                            <text fg={HINT_FG}>[Ctrl+E]</text>
                            <text fg={theme().text}> Edit</text>
                        </box>
                    </Show>

                    <Show when={mode() === "edit"}>
                        <box flexDirection="row" gap={0} onMouseDown={save}>
                            <text fg={HINT_FG}>[Ctrl+S]</text>
                            <text fg={theme().text}> Save</text>
                        </box>
                    </Show>

                    <Show when={mode() === "edit"}>
                        <box flexDirection="row" gap={0} onMouseDown={cancelEdit}>
                            <text fg={HINT_FG}>[Ctrl+Q]</text>
                            <text fg={theme().text}> Cancel</text>
                        </box>
                    </Show>

                    <text ref={(el) => { statusEl = el }} fg={theme().textMuted}>{statusMessage}</text>

                    <box flexGrow={1} />

                    <box flexDirection="row" onMouseUp={requestBack}>
                        <text fg={HINT_FG}>[ESC]</text>
                        <text fg={FG}> Close</text>
                    </box>
                </box>
            </box>

            <scrollbox
                ref={(el) => { previewScrollBox = el }}
                width="100%"
                flexGrow={1}
                scrollX={false}
                scrollY={true}
                verticalScrollbarOptions={{ visible: true }}
            >
                <box width={panelWidth() - 1} padding={1}>
                    <code
                        ref={(el) => {
                            codeRef = el
                            el.content = originalContent
                            el.filetype = filetype
                        }}
                        visible={!isMarkdown}
                        syntaxStyle={SYNTAX_STYLE}
                        selectable={true}
                        width="100%"
                        onMouseDown={() => setFocusTarget("content")}
                        flexShrink={1}
                    />

                    <markdown
                        ref={(el) => {
                            markdownRef = el
                            el.content = originalContent
                        }}
                        visible={isMarkdown}
                        syntaxStyle={SYNTAX_STYLE}
                        conceal={true}
                        fg={theme().text}
                        width="100%"
                        flexShrink={1}
                    />
                </box>
            </scrollbox>

            <textarea
                ref={(el) => {
                    textareaRef = el
                    setTextareaTarget(el)
                    el.setText(originalContent)
                }}
                visible={false}
                syntaxStyle={SYNTAX_STYLE}
                flexGrow={1}
                selectable={true}
                onMouseDown={() => setFocusTarget("content")}
                onContentChange={() => {
                    refreshDirtyState()
                    if (searchQuery && mode() === "edit") computeMatches(searchQuery)
                }}
            />

            <box
                ref={(el) => { bottomBarBox = el }}
                flexShrink={0}
                flexDirection="row"
                paddingLeft={2}
                paddingTop={0}
                paddingBottom={1}
                gap={2}
                border={["top"]}
                borderColor={theme().textMuted}
            >
                <box flexDirection="row" gap={3} flexGrow={1}>
                    <box visible={mode() === "preview"} flexDirection="row" gap={3}>
                        <box flexDirection="row" gap={0} onMouseDown={reload}>
                            <text fg={HINT_FG}>[F5]</text>
                            <text fg={theme().text}> Reload</text>
                        </box>
                        <box flexDirection="row" gap={0} onMouseDown={() => switchMode("edit")}>
                            <text fg={HINT_FG}>[Ctrl+E]</text>
                            <text fg={theme().text}> Edit</text>
                        </box>
                    </box>
                    <box visible={mode() === "edit"} flexDirection="row" gap={3}>
                        <box flexDirection="row" gap={0} onMouseDown={save}>
                            <text fg={HINT_FG}>[Ctrl+S]</text>
                            <text fg={theme().text}> Save</text>
                        </box>
                        <box flexDirection="row" gap={0} onMouseDown={cancelEdit}>
                            <text fg={HINT_FG}>[Ctrl+Q]</text>
                            <text fg={theme().text}> Cancel</text>
                        </box>
                    </box>
                    <box ref={(el) => { searchBox = el }} visible={false} flexDirection="row" flexGrow={1} border={["bottom"]} borderColor={theme().textMuted}>
                        <text fg={HINT_FG} flexShrink={0}>[Ctrl+F]</text>
                        <text fg={theme().textMuted}> </text>
                        <input
                            ref={(el) => {
                                searchInputRef = el
                                setSearchInputTarget(el)
                            }}
                            placeholder="Search..."
                            flexGrow={1}
                            onMouseDown={() => setFocusTarget("search")}
                            onInput={(value: string) => computeMatches(value)}
                            onSubmit={() => nextMatch()}
                        />
                        <text fg={theme().textMuted}> </text>
                        <text fg={theme().textMuted} onMouseDown={prevMatch}>◀</text>
                        <text fg={theme().textMuted} onMouseDown={nextMatch}>▶</text>
                        <text fg={theme().textMuted}> </text>
                        <text ref={(el) => { matchCountEl = el }} fg={theme().textMuted} />
                    </box>
                </box>
            </box>

            <Show when={closeConfirm()}>
                <box
                    position="absolute"
                    top={0}
                    left={0}
                    width="100%"
                    height="100%"
                    zIndex={100}
                    backgroundColor={theme().backgroundPanel}
                    alignItems="center"
                    justifyContent="center"
                >
                    <box width={Math.min(panelWidth() - 8, 72)} border={true} borderColor={theme().textMuted} padding={2} flexDirection="column" gap={1}>
                        <text fg={theme().text}>Discard unsaved changes?</text>
                        <box flexDirection="row" gap={3}>
                            <box onMouseDown={() => { setCloseConfirm(false); props.onBack?.() }}>
                                <text fg={HINT_FG}>[Enter]</text>
                                <text fg={theme().text}> Discard</text>
                            </box>
                            <box onMouseDown={() => setCloseConfirm(false)}>
                                <text fg={HINT_FG}>[Esc]</text>
                                <text fg={theme().text}> Keep editing</text>
                            </box>
                        </box>
                    </box>
                </box>
            </Show>
        </box>
    )
}
