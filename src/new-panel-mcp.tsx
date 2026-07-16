import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { TextRenderable, SelectOption } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"

interface PanelItem {
  id: string
  label: string
  checked: boolean
  detail?: string
}

const LEFT_WIDTH = 40

interface Props {
  api: TuiPluginApi
  items: PanelItem[]
}

export default function NewPanelMcp(props: Props) {
  let selectRef: any
  let rightEmptyEl: TextRenderable
  let rightNameEl: TextRenderable
  let rightStatusEl: TextRenderable
  let lastClickTime = 0
  let lastClickIdx = -1
  const dimensions = useTerminalDimensions()
  const theme = () => props.api.theme.current

  let currentItems = props.items

  const toOptions = (items: PanelItem[]) =>
    items.map((item) => ({
      name: (item.checked ? "✓ " : "  ") + item.label,
      description: item.checked ? "connected" : "disconnected",
      value: item.id,
    }))

  const first = currentItems[0]

  async function toggle(id: string) {
    const mcp = currentItems.find((m) => m.id === id)
    if (!mcp) return
    const wasConnected = mcp.checked
    try {
      if (wasConnected) {
        await props.api.client.mcp.disconnect({ name: id })
      } else {
        await props.api.client.mcp.connect({ name: id })
      }
    } catch {}
    currentItems = currentItems.map((m) =>
      m.id === id ? { ...m, checked: !m.checked } : m,
    )
    selectRef.options = toOptions(currentItems)
    updateRightPanel(currentItems.find((m) => m.id === id) ?? null)
  }

  function updateRightPanel(item: PanelItem | null) {
    if (!item) {
      rightEmptyEl.content = "(select an item)"
      rightNameEl.content = ""
      rightStatusEl.content = ""
      return
    }
    rightEmptyEl.content = ""
    rightNameEl.content = item.label
    rightStatusEl.content = item.checked ? "connected" : "disconnected"
  }

  const handleChange = (_index: number, option: SelectOption | null) => {
    const id = option?.value
    const found = id ? currentItems.find((i) => i.id === id) : null
    updateRightPanel(found ?? null)
  }

  const handleSelect = async (_index: number, option: SelectOption | null) => {
    const id = option?.value
    if (!id) return
    await toggle(id)
  }

  const panelWidth = () => Math.min(Math.max(dimensions().width - 2, 60), 116)
  const panelHeight = () => Math.max(dimensions().height - 4, 24)
  const rightWidth = () => panelWidth() - LEFT_WIDTH - 1

  return (
    <box
      width={panelWidth()}
      height={panelHeight()}
      flexDirection="row"
      backgroundColor={theme().background}
    >
      <box
        width={LEFT_WIDTH}
        height={panelHeight()}
        flexDirection="column"
        flexShrink={0}
        backgroundColor={theme().background}
      >
        <box paddingLeft={2} paddingTop={1} paddingBottom={1}>
          <text fg={theme().text}>MCPs</text>
        </box>
        <select
          ref={(el) => { selectRef = el }}
          options={toOptions(currentItems)}
          showDescription={false}
          focused={true}
          onChange={handleChange}
          onSelect={handleSelect}
          flexGrow={1}
          onMouseDown={(event: any) => {
            const idx = Math.floor(event.y - selectRef.screenY)
            if (idx >= 0 && idx < currentItems.length) {
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
        />
        <box paddingLeft={2} paddingTop={1} paddingBottom={1}>
          <text fg={theme().textMuted}>esc to close</text>
        </box>
      </box>
      <scrollbox
        width={rightWidth()}
        height={panelHeight()}
        backgroundColor={theme().backgroundPanel}
        scrollbarOptions={{ visible: false }}
      >
        <box padding={1} flexDirection="column" gap={1}>
          <text ref={(el) => { rightEmptyEl = el }} fg={theme().textMuted}>
            {first ? "" : "(no servers)"}
          </text>
          <text ref={(el) => { rightNameEl = el }} fg={theme().text}>
            {first?.label ?? ""}
          </text>
          <text ref={(el) => { rightStatusEl = el }} fg={theme().textMuted}>
            {first ? (first.checked ? "connected" : "disconnected") : ""}
          </text>
        </box>
      </scrollbox>
    </box>
  )
}
