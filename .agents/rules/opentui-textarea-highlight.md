# Highlighting Ranges in `<textarea>` via `addHighlightByCharRange`

`<textarea>` (and `<input>`) extend `EditBufferRenderable`, which exposes a public highlight API. `<code>` does **not** — its `textBuffer` is protected and untouched by the renderable. Use `<textarea>` whenever you need range-based highlighting (e.g. search match marks).

## Why `<textarea>` over `<code>`

- `CodeRenderable` only exposes `getLineHighlights(lineIdx)` (read-only). The tree-sitter pipeline writes styles via `textBuffer.setStyledText`, which is internal. Custom highlights cannot be added externally.
- `EditBufferRenderable` publicly exposes `addHighlight`, `addHighlightByCharRange`, `removeHighlightsByRef`, `clearLineHighlights`, `clearAllHighlights` (`opentui/packages/core/src/renderables/EditBufferRenderable.ts:1058-1085`).
- **Tradeoff**: `<textarea>` does not run tree-sitter; it has no automatic syntax coloring. The `syntaxStyle` prop on a textarea is **only** a style registry for user-added highlights.

## Setup pattern

### 1. Create a dedicated `SyntaxStyle` and register named styles

```ts
import { SyntaxStyle, parseColor } from "@opentui/core"

const SEARCH_STYLE = SyntaxStyle.fromStyles({})
// Returns a numeric styleId; store at module level (one-id-per-name registration).
const SEARCH_HL_STYLE_ID = SEARCH_STYLE.registerStyle("search-match",
  { bg: parseColor("#444444"), fg: parseColor("#FFFFFF") })
const SEARCH_CURRENT_HL_STYLE_ID = SEARCH_STYLE.registerStyle("search-current",
  { bg: parseColor("#FFFF00"), fg: parseColor("#000000"), bold: true })
```

`registerStyle` accepts `{ fg, bg, bold, italic, underline, dim }` (`syntax-style.ts:120-138`). It returns a numeric `styleId` you reuse as the `Highlight.styleId`.

### 2. Attach the `SyntaxStyle` to the textarea

```tsx
<textarea
  ref={(el) => { textareaRef = el; el.setText(content) }}
  focused={true}
  syntaxStyle={SEARCH_STYLE}
  flexGrow={1}
/>
```

Without this prop, the registered styleIds have no style registry they can resolve against, and highlights render with default styling (no color).

### 3. `Highlight` shape (per match)

```ts
interface Highlight {
  start: number      // absolute char offset in the buffer (for addHighlightByCharRange)
  end: number
  styleId: number    // obtained from registerStyle
  priority?: number
  hlRef?: number     // your own integer id; use with removeHighlightsByRef(hlRef)
}
```

### 4. Compute matches with `indexOf` over `plainText`

```ts
const found: SearchMatch[] = []
const text = textareaRef.plainText
let pos = 0
while (pos <= text.length) {
  const idx = text.indexOf(query, pos)
  if (idx === -1) break
  found.push({ start: idx, end: idx + query.length })
  pos = idx + query.length
}
```

**Length units**: char offsets into `plainText`. UTF-16 code unit offsets (JS string `.indexOf`). Do not confuse with byte offsets or grapheme cluster counts.

### 5. Apply highlights

```ts
function applyHighlights() {
  textareaRef.clearAllHighlights()
  matches.forEach((m, i) => {
    textareaRef.addHighlightByCharRange({
      start: m.start,
      end: m.end,
      styleId: i === currentMatch ? SEARCH_CURRENT_HL_STYLE_ID : SEARCH_HL_STYLE_ID,
      hlRef: i,
    })
  })
}
```

- `clearAllHighlights()` first, then re-add. This is simplest; for surgical updates use `removeHighlightsByRef(hlRef)` and `clearLineHighlights(lineIdx)`.
- Each call to `addHighlight*` calls `requestRender()` internally, so batched updates still trigger one redraw per call (acceptable for typical match counts).

## Lifecycle caveats

- `textarea.setText(...)` clears **chunk** highlights but **preserves** user-added `addHighlight*` entries (test refs: `opentui/packages/core/src/text-buffer.test.ts:262-312`). Re-apply highlights after `setText` to avoid stale ranges.
- After editing content, re-run `computeMatches(query)` so offsets stay valid. In `onContentChange`, gate on `searchQuery !== ""` to avoid recomputing when no search is active.
- The highlight mutation is on the native (Zig) side; `addHighlight*`/`clearAllHighlights` only push data into native state and call `requestRender()`. No JS highlight array exists on the renderable.

## Focus interaction

- Focus is exclusive (`renderer.ts:867` singleton). Two `<input>`/`<textarea>` cannot be simultaneously focused. Use a single Solid signal `focusedId()` and bind `focused={focusedId() === "which"}` on each focusable renderable. Clicking either (when `autoFocus=true`, the default) auto-focuses it; setting `focusedId()` programmatically also triggers `.focus()`/`.blur()` via the reconciler (`reconciler.ts:254-261`).

## Reference implementation

- `opencode-project-panel/src/file-viewer.tsx` — full search-bar + match highlighting example using `addHighlightByCharRange` + `registerStyle`.

## Key sources

- `opentui/packages/core/src/renderables/EditBufferRenderable.ts:1058-1085` — public highlight API
- `opentui/packages/core/src/syntax-style.ts:120-138` — `registerStyle` signature
- `opentui/packages/core/src/types.ts:154-160` — `Highlight` type
- `opentui/packages/core/src/renderables/Textarea.ts:145+` — Textarea extends EditBufferRenderable