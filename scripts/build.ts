import solidPlugin from "@opentui/solid/bun-plugin"

const result = await Bun.build({
  entrypoints: ["src/index.tsx"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  plugins: [solidPlugin],
  external: [
    "solid-js",
    "@opentui/core",
    "@opentui/solid",
    "@opentui/keymap",
    "@opencode-ai/plugin",
  ],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

console.log(`Bundled ${result.outputs.length} module${result.outputs.length === 1 ? "" : "s"}`)
