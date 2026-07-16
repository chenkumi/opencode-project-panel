# Half-Row Padding Technique in OpenTUI

Terminal cells are the smallest addressable unit; `padding`/`margin` only accept integers. To achieve a visual half-row gap, use Unicode half-block characters as border glyphs with `position="absolute"` overlay.

## Glyphs

| Glyph | Codepoint | Name | Fills |
|-------|-----------|------|-------|
| `▀` | U+2580 | UPPER HALF BLOCK | Top half of cell |
| `▄` | U+2584 | LOWER HALF BLOCK | Bottom half of cell |
| `╹` | U+2579 | BOX DRAWINGS UP LIGHT | Short vertical stub (lower half) |

## EmptyBorder helper

Spread this into `customBorderChars` so only the overridden glyph renders; every other border cell stays blank.

```ts
const EmptyBorder = {
  topLeft: "", bottomLeft: "", vertical: "", topRight: "", bottomRight: "",
  horizontal: " ", bottomT: "", topT: "", cross: "", leftT: "", rightT: "",
}
```

## Pattern: half-row above an element (without consuming a full row)

When the row above belongs to a parent you cannot edit (e.g. opencode's `home_footer` with `paddingBottom={1}`), use `position="absolute"` + `top={-1}` + `zIndex` to overlay the half-block on that padding row instead of adding layout height.

```tsx
<box width="100%" flexDirection="column" flexShrink={0} zIndex={100}>
  {/* Top half-row fill — overlays the row above */}
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
  {/* Main content row */}
  <box height={1} paddingLeft={2} paddingRight={2} flexDirection="row" backgroundColor={BG}>
    <text>Content</text>
  </box>
  {/* Bottom half-row fill — occupies its own row */}
  <box
    height={1}
    flexShrink={0}
    border={["bottom"]}
    borderColor={BG}
    customBorderChars={{ ...EmptyBorder, horizontal: "▀" }}
  />
</box>
```

## Pattern: half-row as standalone padding

When you own both sides of the gap, place the half-block box in normal flow (no `position="absolute"`):

```tsx
{/* Fills bottom half of this row */}
<box height={1} border={["bottom"]} borderColor={BG}
  customBorderChars={{ ...EmptyBorder, horizontal: "▄" }} />
{/* Content */}
<box height={1} backgroundColor={BG}>Content</box>
{/* Fills top half of this row */}
<box height={1} border={["bottom"]} borderColor={BG}
  customBorderChars={{ ...EmptyBorder, horizontal: "▀" }} />
```

## Transparent background fallback

When the background color has alpha 0, replace the glyph with a space so no half-block renders:

```tsx
customBorderChars={
  BG.a !== 0
    ? { ...EmptyBorder, horizontal: "▀" }
    : { ...EmptyBorder, horizontal: " " }
}
```

## Key points

- `borderColor` controls the color of the half-block fill; set it to the element's background color.
- `zIndex` is needed when overlaying content owned by a different layout slot.
- `position="absolute"` with a negative `top` avoids consuming a layout row.
- Reference implementation: `opencode/packages/tui/src/component/prompt/index.tsx:1484-1509`.
