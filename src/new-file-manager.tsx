import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { TextRenderable, SelectOption } from "@opentui/core"
import { RGBA, SyntaxStyle, parseColor } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { useBindings } from "@opentui/keymap/solid"
import { onCleanup } from "solid-js"
import { readdirSync, readFileSync, openSync, readSync, closeSync, mkdirSync, writeFileSync, renameSync, rmSync, statSync } from "node:fs"
import path from "node:path"
import FileViewer from "./file-viewer.js"

interface FileEntry {
  name: string
  fullPath: string
  isDir: boolean
}

interface Props {
  api: TuiPluginApi
  initialDir?: string
}

export type FileAction = "create" | "rename" | "delete" | "goto" | "focusFilter" | "focusSelect" | "hideOverlay"
export let currentFileActions: Record<FileAction, () => void> | null = null
export let focusedPane: "select" | "preview" | "filter" = "select"
export let isOverlayActive = false

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".mdx", ".markdown",
  ".ts", ".tsx", ".mts", ".cts",
  ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".jsonc", ".json5",
  ".yml", ".yaml",
  ".toml",
  ".xml", ".svg", ".xsl", ".xslt",
  ".css", ".scss", ".sass", ".less", ".styl",
  ".html", ".htm", ".xhtml",
  ".vue", ".svelte", ".astro",
  ".py", ".pyw",
  ".rb",
  ".go",
  ".rs",
  ".java", ".kt", ".kts", ".swift",
  ".c", ".cpp", ".cxx", ".cc", ".h", ".hpp", ".hxx", ".hh",
  ".cs", ".fs", ".fsx",
  ".ex", ".exs",
  ".erl", ".hrl",
  ".clj", ".cljs", ".cljc", ".edn",
  ".scala", ".sbt",
  ".zig",
  ".r", ".rda",
  ".m", ".mm",
  ".pl", ".pm", ".t",
  ".lua",
  ".sql",
  ".graphql", ".gql",
  ".proto",
  ".tf", ".tfvars",
  ".nix",
  ".sh", ".bash", ".zsh", ".fish",
  ".ps1", ".bat", ".cmd",
  ".env",
  ".ini", ".cfg", ".conf",
  ".log",
  ".gitignore", ".dockerignore", ".helmignore",
  ".dockerfile",
  ".makefile",
  ".npmrc", ".yarnrc", ".pnpmrc",
  ".editorconfig",
  ".prettierrc", ".eslintrc", ".babelrc",
  ".stylelintrc", ".commitlintrc",
  ".browserslistrc",
  ".nvmrc", ".node-version", ".python-version", ".ruby-version",
])

const HINT_FG = RGBA.fromInts(180, 180, 180, 255)
const FG = RGBA.fromInts(255, 255, 255, 255)

const KNOWN_TEXT_FILENAMES = new Set([
  "makefile", "dockerfile", "composefile", "rakefile", "gemfile",
  "podfile", "cartfile",
  "readme", "license", "changelog", "contributing",
  "build", "workspace",
  "cargo.toml", "package.swift",
  ".gitattributes", ".gitmodules",
  ".npmignore", ".dockerignore",
  "procfile", ".slugignore",
  "nginx.conf", "httpd.conf",
])

function hasNullByte(filePath: string): boolean {
  try {
    const fd = openSync(filePath, "r")
    const buf = Buffer.alloc(4096)
    const bytesRead = readSync(fd, buf, 0, 4096, 0)
    closeSync(fd)
    return bytesRead > 0 && buf.subarray(0, bytesRead).includes(0)
  } catch {
    return true
  }
}

function isTextFile(name: string, fullPath: string): boolean {
  const ext = path.extname(name).toLowerCase()
  if (TEXT_EXTENSIONS.has(ext)) return true
  if (KNOWN_TEXT_FILENAMES.has(name.toLowerCase())) return true
  if (/^[^.]+$/.test(name) && KNOWN_TEXT_FILENAMES.has(name.toLowerCase())) return true
  if (!ext && !KNOWN_TEXT_FILENAMES.has(name.toLowerCase())) {
    return !hasNullByte(fullPath)
  }
  return !hasNullByte(fullPath)
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

function readDir(dir: string): FileEntry[] {
  try {
    const items = readdirSync(dir, { withFileTypes: true })
    const dirs = items
      .filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, fullPath: path.join(dir, e.name), isDir: true }))
      .sort((a, b) => a.name.localeCompare(b.name))
    const files = items
      .filter((e) => e.isFile())
      .map((e) => ({ name: e.name, fullPath: path.join(dir, e.name), isDir: false }))
      .sort((a, b) => a.name.localeCompare(b.name))
    const isRoot = path.resolve(dir, "..") === dir
    const parent: FileEntry | undefined = isRoot
      ? undefined
      : { name: "..", fullPath: path.resolve(dir, ".."), isDir: true }
    return parent ? [parent, ...dirs, ...files] : [...dirs, ...files]
  } catch {
    return []
  }
}

function toOptions(entries: FileEntry[]) {
  return entries.map((e) => ({
    name: (e.isDir ? "📁 " : "📄 ") + e.name + (e.isDir ? "/" : ""),
    description: e.isDir ? "directory" : (path.extname(e.name) || "(file)"),
    value: e.fullPath,
  }))
}

function describeFile(name: string): string {
  const ext = path.extname(name).toLowerCase()
  if (ext) return ext
  const lower = name.toLowerCase()
  if (KNOWN_TEXT_FILENAMES.has(lower)) return lower
  return "(file)"
}

export default function NewFileManager(props: Props) {
  currentFileActions = {
    create: handleCreate, rename: handleRename, delete: handleDelete, goto: handleGoto,
    focusFilter: () => setFocusedPane("filter"),
    focusSelect: () => setFocusedPane("select"),
    hideOverlay,
  }
  onCleanup(() => { currentFileActions = null; focusedPane = "select"; isOverlayActive = false; if (rightScrollBox && rightScrollBoxOrigBg) rightScrollBox.backgroundColor = rightScrollBoxOrigBg })

  let selectRef: any
  let pathTextEl: TextRenderable
  let rightNameEl: TextRenderable
  let rightPathEl: TextRenderable
  let rightDescEl: TextRenderable
  let rightPreviewEl: TextRenderable
  let rightDirListEl: TextRenderable
  let rightMarkdownEl: any
  let rightCodeEl: any
  let lastClickTime = 0
  let lastClickIdx = 0
  const dimensions = useTerminalDimensions()
  const theme = () => props.api.theme.current

  let currentDir = props.initialDir || process.cwd()
  let entries = readDir(currentDir)

  let overlayMode: "" | "confirm" | "prompt" = ""
  let overlayConfirmAction: (() => void) | null = null
  let overlayPromptAction: ((val: string) => void) | null = null
  let promptInputValue = ""
  let currentEntry: FileEntry | null = entries[0] ?? null
  let filterText = ""
  let filteredEntries: FileEntry[] = entries

  let mainContentBox: any
  let confirmOverlayBox: any
  let promptOverlayBox: any
  let confirmTitleEl: TextRenderable
  let confirmMessageEl: TextRenderable
  let promptTitleEl: TextRenderable
  let promptMessageEl: TextRenderable
  let promptCancelBtn: any
  let promptOkBtn: any
  let promptInputEl: any
  let filterInputEl: any
  let rightScrollBox: any
  let rightScrollBoxOrigBg: any

  function applyFilter(text: string) {
    filterText = text
    filteredEntries = text ? entries.filter((e) => e.name.toLowerCase().includes(text.toLowerCase())) : entries
    selectRef.options = toOptions(filteredEntries)
    selectRef.setSelectedIndex(0)
    currentEntry = filteredEntries[0] ?? null
    if (currentEntry) setRightPanel(currentEntry)
    else setRightPanel(null)
  }

  function navigateTo(dir: string) {
    currentDir = dir
    entries = readDir(currentDir)
    if (filterInputEl) filterInputEl.setText("")
    filterText = ""
    filteredEntries = entries
    selectRef.options = toOptions(entries)
    pathTextEl.content = "Project Path: " + currentDir
    forceSelectFirst()
    currentEntry = entries[0] ?? null
    if (entries[0]) setRightPanel(entries[0])
    else setRightPanel(null)
  }

  function setRightPanel(entry: FileEntry | null) {
    rightPreviewEl.visible = false
    if (rightMarkdownEl) rightMarkdownEl.visible = false
    if (rightCodeEl) rightCodeEl.visible = false
    if (rightDirListEl) rightDirListEl.visible = false

    if (!entry) {
      rightNameEl.content = ""
      rightPathEl.content = ""
      rightDescEl.content = ""
      rightPreviewEl.content = "(empty directory)"
      rightPreviewEl.visible = true
      return
    }

    rightNameEl.content = entry.name
    rightPathEl.content = entry.fullPath

    if (entry.isDir) {
      rightDescEl.content = "directory"
      const items = readDir(entry.fullPath)
      if (items.length === 0) {
        rightDirListEl.content = "(empty directory)"
      } else {
        rightDirListEl.content = items
          .map((e) => (e.isDir ? "📁 " : "📄 ") + e.name + (e.isDir ? "/" : ""))
          .join("\n")
      }
      rightDirListEl.visible = true
      return
    }

    rightDescEl.content = describeFile(entry.name)

    if (!isTextFile(entry.name, entry.fullPath)) {
      rightPreviewEl.content = "(binary file)"
      rightPreviewEl.visible = true
      return
    }

    let content: string
    try {
      content = readFileSync(entry.fullPath, "utf-8")
    } catch {
      rightPreviewEl.content = "(preview unavailable)"
      rightPreviewEl.visible = true
      return
    }

    const ext = path.extname(entry.name).toLowerCase()
    if (ext === ".md" || ext === ".mdx" || ext === ".markdown") {
      rightMarkdownEl.content = content
      rightMarkdownEl.visible = true
    } else {
      rightCodeEl.content = content
      rightCodeEl.filetype = EXT_TO_FILETYPE[ext] ?? ""
      rightCodeEl.visible = true
    }
  }

  function openPreview(entry: FileEntry) {
    if (entry.isDir) {
      navigateTo(entry.fullPath)
      return
    }
    if (isTextFile(entry.name, entry.fullPath)) {
      props.api.ui.dialog.replace(() => (
        <FileViewer api={props.api} filePath={entry.fullPath} onBack={() => {
          props.api.ui.dialog.replace(() => <NewFileManager api={props.api} initialDir={currentDir} />)
          props.api.ui.dialog.setSize("xlarge")
        }} />
      ))
      props.api.ui.dialog.setSize("xlarge")
      return
    }
    const backDir = currentDir
    props.api.ui.dialog.replace(() => (
      <FilePreviewDialog api={props.api} path={entry.fullPath} content="[Binary file]" backDir={backDir} />
    ))
    props.api.ui.dialog.setSize("xlarge")
  }

  const handleSelect = (_index: number, option: SelectOption | null) => {
    const fullPath = option?.value
    if (!fullPath) return
    const entry = entries.find((e) => e.fullPath === fullPath)
    if (entry) openPreview(entry)
  }

  const handleChange = (_index: number, option: SelectOption | null) => {
    const fullPath = option?.value
    if (!fullPath) { currentEntry = null; setRightPanel(null); return }
    const entry = entries.find((e) => e.fullPath === fullPath) ?? null
    currentEntry = entry
    if (entry) setRightPanel(entry)
    else setRightPanel(null)
  }

  function showConfirm(message: string, onConfirm: () => void) {
    overlayMode = "confirm"
    isOverlayActive = true
    overlayConfirmAction = onConfirm
    confirmTitleEl.content = "Confirm"
    confirmMessageEl.content = message
    mainContentBox.visible = false
    confirmOverlayBox.visible = true
    promptOverlayBox.visible = false
  }

  function hideOverlay() {
    overlayMode = ""
    isOverlayActive = false
    overlayConfirmAction = null
    overlayPromptAction = null
    mainContentBox.visible = true
    confirmOverlayBox.visible = false
    promptOverlayBox.visible = false
    navigateTo(currentDir)
    if (selectRef) selectRef.focus()
  }

  function forceSelectFirst() {
    if (selectRef && entries.length > 0) {
      selectRef.setSelectedIndex(0)
    }
  }

  function handleDelete() {
    const entry = currentEntry
    if (!entry || entry.name === ".." || entry.name === ".") return
    const label = entry.name + (entry.isDir ? "/" : "")
    showConfirm(`Delete "${label}"?`, () => {
      try {
        rmSync(entry.fullPath, { recursive: entry.isDir, force: true })
      } catch { /* ignore */ }
      hideOverlay()
    })
  }

  function handleRename() {
    const entry = currentEntry
    if (!entry || entry.name === ".." || entry.name === ".") return
    overlayMode = "prompt"
    isOverlayActive = true
    overlayPromptAction = (newName: string) => {
      if (!newName || newName === entry.name) { hideOverlay(); return }
      const newPath = path.join(path.dirname(entry.fullPath), newName)
      try {
        renameSync(entry.fullPath, newPath)
      } catch { /* ignore */ }
      hideOverlay()
    }
    promptInputValue = entry.name
    promptTitleEl.content = "Rename"
    promptMessageEl.content = `Rename "${entry.name}" to:`
    if (promptInputEl) {
      promptInputEl.setText(entry.name)
    }
    mainContentBox.visible = false
    confirmOverlayBox.visible = false
    promptOverlayBox.visible = true
    if (promptInputEl) promptInputEl.focus()
  }

  function handleGoto() {
    overlayMode = "prompt"
    isOverlayActive = true
    overlayPromptAction = (pathStr: string) => {
      if (!pathStr) { hideOverlay(); return }
      const home = process.env.HOME || "/"
      const expanded = pathStr === "~" ? home
        : pathStr.startsWith("~/") ? path.join(home, pathStr.slice(2))
        : pathStr
      try {
        const resolved = path.resolve(currentDir, expanded)
        const s = statSync(resolved)
        hideOverlay()
        if (s.isDirectory()) {
          navigateTo(resolved)
        } else {
          props.api.ui.dialog.replace(() => (
            <FileViewer api={props.api} filePath={resolved} onBack={() => {
              props.api.ui.dialog.replace(() => <NewFileManager api={props.api} initialDir={currentDir} />)
              props.api.ui.dialog.setSize("xlarge")
            }} />
          ))
          props.api.ui.dialog.setSize("xlarge")
        }
      } catch {
        hideOverlay()
      }
    }
    promptInputValue = ""
    promptTitleEl.content = "Goto"
    promptMessageEl.content = "Enter path:"
    if (promptInputEl) {
      promptInputEl.setText("")
    }
    mainContentBox.visible = false
    confirmOverlayBox.visible = false
    promptOverlayBox.visible = true
    if (promptInputEl) promptInputEl.focus()
  }

  function handleCreate() {
    overlayMode = "prompt"
    isOverlayActive = true
    overlayPromptAction = (name: string) => {
      if (!name) { hideOverlay(); return }
      const isDir = name.endsWith("/")
      const cleanName = isDir ? name.slice(0, -1) : name
      const newPath = path.join(currentDir, cleanName)
      try {
        if (isDir) mkdirSync(newPath, { recursive: true })
        else {
          writeFileSync(newPath, "", "utf-8")
          props.api.ui.dialog.replace(() => (
            <FileViewer api={props.api} filePath={newPath} initialMode="edit" onBack={() => {
              props.api.ui.dialog.replace(() => <NewFileManager api={props.api} initialDir={currentDir} />)
              props.api.ui.dialog.setSize("xlarge")
            }} />
          ))
          props.api.ui.dialog.setSize("xlarge")
          return
        }
      } catch { /* ignore */ }
      hideOverlay()
    }
    promptInputValue = ""
    promptTitleEl.content = "Create"
    promptMessageEl.content = "Enter name (trailing / for directory):"
    if (promptInputEl) {
      promptInputEl.setText("")
    }
    mainContentBox.visible = false
    confirmOverlayBox.visible = false
    promptOverlayBox.visible = true
    if (promptInputEl) promptInputEl.focus()
  }

  const projectRoot = () => props.api.state.path.worktree || props.api.state.path.directory

  function returnToProjectRoot() {
    const root = projectRoot()
    if (root) navigateTo(root)
  }

  useBindings(() => ({
    priority: 2,
    bindings: [
      { key: "ctrl+r", cmd: returnToProjectRoot },
    ],
  }))

  function cycleFocus(dir: number) {
    const order = ["select", "preview", "filter"] as const
    const idx = order.indexOf(focusedPane)
    const next = order[(idx + dir + 3) % 3]!
    setFocusedPane(next)
  }

  function setFocusedPane(pane: "select" | "preview" | "filter") {
    focusedPane = pane
    if (rightScrollBox && rightScrollBoxOrigBg) {
      rightScrollBox.backgroundColor = pane === "preview" ? RGBA.fromInts(40, 40, 50, 255) : rightScrollBoxOrigBg
    }
    if (pane === "select") {
      selectRef?.focus()
    } else if (pane === "preview") {
      rightScrollBox?.focus()
    } else if (pane === "filter") {
      filterInputEl?.focus()
    }
  }

  useBindings(() => ({
    priority: 1,
    bindings: [
      { key: "tab", cmd: () => cycleFocus(1) },
      { key: "shift+tab", cmd: () => cycleFocus(-1) },
    ],
  }))

  useBindings(() => ({
    priority: 1,
    enabled: () => focusedPane === "preview",
    bindings: [
      { key: "up", cmd: () => rightScrollBox?.scrollBy(-1) },
      { key: "down", cmd: () => rightScrollBox?.scrollBy(1) },
      { key: "pageup", cmd: () => { if (rightScrollBox) { const h = rightScrollBox.height; if (h > 0) rightScrollBox.scrollTop -= h } } },
      { key: "pagedown", cmd: () => { if (rightScrollBox) { const h = rightScrollBox.height; if (h > 0) rightScrollBox.scrollTop += h } } },
      { key: "home", cmd: () => { if (rightScrollBox) rightScrollBox.scrollTop = 0 } },
      { key: "end", cmd: () => { if (rightScrollBox) rightScrollBox.scrollTop = rightScrollBox.scrollHeight - rightScrollBox.height } },
    ],
  }))

  useBindings(() => ({
    priority: 1,
    enabled: () => focusedPane === "select",
    bindings: [
      { key: "pageup", cmd: () => selectRef?.moveUp(10) },
      { key: "pagedown", cmd: () => selectRef?.moveDown(10) },
      { key: "home", cmd: () => { if (selectRef) selectRef.setSelectedIndex(0) } },
      { key: "end", cmd: () => { if (selectRef) selectRef.setSelectedIndex(filteredEntries.length - 1) } },
    ],
  }))

  const panelWidth = () => Math.min(Math.max(dimensions().width - 2, 60), 116)
  const panelHeight = () => Math.max(Math.floor(dimensions().height * 0.78) - 2, 22)
  const leftWidth = () => Math.floor(panelWidth() * 0.4)
  const rightWidth = () => panelWidth() - leftWidth()

  const first = filteredEntries[0]

  return (
    <box width={panelWidth()} height={panelHeight()} flexDirection="column">
      <box paddingLeft={2} paddingRight={2} flexShrink={0} border={["bottom"]} borderColor={theme().textMuted} flexDirection="row">
        <text ref={(el) => { pathTextEl = el }} fg={theme().text}>
          Project Path: {currentDir}
        </text>
        <box flexGrow={1} />
        <box flexDirection="row" gap={3}>
          <box flexDirection="row" gap={0} onMouseUp={() => returnToProjectRoot()}>
            <text fg={HINT_FG}>[Ctrl+R]</text>
            <text fg={FG}> Return</text>
          </box>
          <box flexDirection="row" gap={0} onMouseUp={() => props.api.ui.dialog.clear()}>
          <text fg={HINT_FG}>[ESC]</text>
          <text fg={FG}> Close</text>
        </box>
      </box>
      </box>

      <box flexDirection="row" flexGrow={1} minHeight={5}>
        <box ref={(el) => { mainContentBox = el }} flexDirection="row" flexGrow={1}>
          <select
            ref={(el) => { selectRef = el }}
            options={toOptions(filteredEntries)}
            showDescription={false}
            focused={true}
            onChange={handleChange}
            onSelect={handleSelect}
            height="100%"
            width={leftWidth()}
            onMouseDown={(event: any) => {
              selectRef?.focus()
              setFocusedPane("select")
              const idx = Math.floor(event.y - selectRef.screenY)
              if (idx >= 0 && idx < filteredEntries.length) {
                const now = Date.now()
                if (idx === lastClickIdx && now - lastClickTime < 500) {
                  handleSelect(idx, selectRef.options[idx])
                } else {
                  selectRef.setSelectedIndex(idx)
                }
                lastClickTime = now
                lastClickIdx = idx
              }
            }}
            onMouseScroll={(event: any) => {
              if (!event.scroll) return
              selectRef?.focus()
              setFocusedPane("select")
              const cur = selectRef.getSelectedIndex()
              if (event.scroll.direction === "down" && cur < filteredEntries.length - 1) {
                selectRef.setSelectedIndex(Math.min(filteredEntries.length - 1, cur + event.scroll.delta))
              } else if (event.scroll.direction === "up" && cur > 0) {
                selectRef.setSelectedIndex(Math.max(0, cur - event.scroll.delta))
              }
            }}
          />
          <scrollbox
            ref={(el) => { rightScrollBox = el; rightScrollBoxOrigBg = el.backgroundColor }}
            width={rightWidth()}
            height="100%"
            backgroundColor={theme().backgroundPanel}
            scrollbarOptions={{ visible: false }}
            onMouseDown={() => { setFocusedPane("preview") }}
          >
            <box padding={1} flexDirection="column" gap={1}>
              <text ref={(el) => { rightNameEl = el }} fg={theme().text}>
                {first ? first.name : ""}
              </text>
              <text ref={(el) => { rightPathEl = el }} fg={theme().textMuted}>
                {first ? first.fullPath : ""}
              </text>
              <text ref={(el) => { rightDescEl = el }} fg={theme().textMuted}>
                {first ? (first.isDir ? "directory" : describeFile(first.name)) : ""}
              </text>
              <text ref={(el) => { rightPreviewEl = el }} fg={theme().text} visible={false} />
              <text ref={(el) => { rightDirListEl = el }} fg={theme().text} visible={false} />
              <markdown
                ref={(el) => { rightMarkdownEl = el }}
                content=""
                syntaxStyle={SYNTAX_STYLE}
                conceal={true}
                fg={theme().text}
                width="100%"
                visible={false}
              />
              <code
                ref={(el) => { rightCodeEl = el }}
                content=""
                filetype=""
                syntaxStyle={SYNTAX_STYLE}
                width="100%"
                visible={false}
              />
            </box>
          </scrollbox>
        </box>

        <box ref={(el) => { confirmOverlayBox = el }} visible={false} flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center" backgroundColor={theme().backgroundPanel}>
          <box padding={2} flexDirection="column" gap={1} backgroundColor={theme().backgroundElement}>
            <text ref={(el) => { confirmTitleEl = el }} fg={theme().text} />
            <text ref={(el) => { confirmMessageEl = el }} fg={theme().textMuted} />
            <box flexDirection="row" justifyContent="flex-end" gap={1}>
              <box paddingLeft={2} paddingRight={2} flexDirection="row" onMouseUp={() => hideOverlay()}>
                <text fg={HINT_FG}>[ESC]</text>
                <text fg={FG}> Cancel</text>
              </box>
              <box paddingLeft={2} paddingRight={2} flexDirection="row" onMouseUp={() => overlayConfirmAction?.()}>
                <text fg={HINT_FG}>[Enter]</text>
                <text fg={FG}> Confirm</text>
              </box>
            </box>
          </box>
        </box>

        <box ref={(el) => { promptOverlayBox = el }} visible={false} flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center" backgroundColor={theme().backgroundPanel}>
          <box padding={2} flexDirection="column" gap={1} backgroundColor={theme().backgroundElement}>
            <text ref={(el) => { promptTitleEl = el }} fg={theme().text} />
            <text ref={(el) => { promptMessageEl = el }} fg={theme().textMuted} />
            <input
              ref={(el) => { promptInputEl = el }}
              placeholder="Name..."
              width={40}
              onInput={(val: string) => { promptInputValue = val }}
              onSubmit={() => overlayPromptAction?.(promptInputValue)}
            />
            <box flexDirection="row" justifyContent="flex-end" gap={1}>
              <box paddingLeft={2} paddingRight={2} flexDirection="row" onMouseUp={() => hideOverlay()}>
                <text fg={HINT_FG}>[ESC]</text>
                <text fg={FG}> Cancel</text>
              </box>
              <box paddingLeft={2} paddingRight={2} flexDirection="row" onMouseUp={() => overlayPromptAction?.(promptInputValue)}>
                <text fg={HINT_FG}>[Enter]</text>
                <text fg={FG}> Confirm</text>
              </box>
            </box>
          </box>
        </box>
      </box>

      <box paddingLeft={2} paddingTop={1} flexShrink={0} flexDirection="row" gap={3}>
        <box flexDirection="row" gap={0} onMouseUp={() => handleCreate()}>
          <text fg={theme().textMuted}>[F7]</text>
          <text fg={FG}> New</text>
        </box>
        <box flexDirection="row" gap={0} onMouseUp={() => handleRename()}>
          <text fg={theme().textMuted}>[F2]</text>
          <text fg={FG}> Rename</text>
        </box>
        <box flexDirection="row" gap={0} onMouseUp={() => handleDelete()}>
          <text fg={theme().textMuted}>[Del]</text>
          <text fg={FG}> Delete</text>
        </box>
        <box flexDirection="row" gap={0} onMouseUp={() => handleGoto()}>
          <text fg={theme().textMuted}>[Ctrl+G]</text>
          <text fg={FG}> Goto</text>
        </box>
        <box flexGrow={1} flexDirection="row" border={["bottom"]} borderColor={theme().textMuted} onMouseDown={() => { setFocusedPane("filter") }}>
          <text fg={HINT_FG}>[Ctrl+F]</text>
          <text fg={theme().textMuted}> </text>
          <input
            ref={(el) => {
              filterInputEl = el
            }}
            placeholder="Filter..."
            onInput={(val: string) => applyFilter(val)}
            flexGrow={1}
          />
        </box>
      </box>
    </box>
  )
}

function FilePreviewDialog(props: { api: TuiPluginApi; path: string; content: string; backDir: string }) {
  const theme = () => props.api.theme.current

  useBindings(() => ({
    bindings: [
      {
        key: "escape",
        cmd: () => {
          props.api.ui.dialog.replace(() => (
            <NewFileManager api={props.api} initialDir={props.backDir} />
          ))
          props.api.ui.dialog.setSize("xlarge")
        },
      },
    ],
  }))

  return (
    <scrollbox
      width="100%"
      height="100%"
      backgroundColor={theme().backgroundPanel}
      scrollbarOptions={{ visible: false }}
    >
      <box padding={1}>
        <text fg={theme().textMuted}>{props.path}</text>
        <text fg={theme().text}>{props.content}</text>
      </box>
    </scrollbox>
  )
}
