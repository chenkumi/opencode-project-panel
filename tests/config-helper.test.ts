import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import {
    findConfig,
    loadConfig,
    setPermission,
    setToolPermission,
} from "../src/config-helper"

function withTempDir(run: (directory: string) => void): void {
    const directory = mkdtempSync(path.join(os.tmpdir(), "opencode-project-panel-config-test-"))
    try { run(directory) } finally { rmSync(directory, { recursive: true, force: true }) }
}

test("loads comments and trailing commas as JSONC", () => {
    withTempDir((directory) => {
        const filePath = path.join(directory, "opencode.jsonc")
        writeFileSync(filePath, '{\n  // keep this comment\n  "permission": { "skill": { "demo": "allow", }, },\n}\n', "utf-8")
        const result = loadConfig(filePath)
        expect(result.status).toBe("ok")
        if (result.status === "ok") expect(result.data.skillAllow).toEqual(["demo"])
    })
})

test("rejects a sibling directory that only shares a path prefix", () => {
    withTempDir((directory) => {
        const root = path.join(directory, "project")
        const sibling = path.join(directory, "project-other")
        mkdirSync(root)
        mkdirSync(sibling)
        writeFileSync(path.join(sibling, "opencode.json"), "{}", "utf-8")
        expect(findConfig(sibling, root)).toBeNull()
    })
})

test("creates a missing config only when a mutation succeeds", () => {
    withTempDir((directory) => {
        const filePath = path.join(directory, "opencode.jsonc")
        const result = setPermission(filePath, "demo", "allow")
        expect(result.status).toBe("ok")
        expect(readFileSync(filePath, "utf-8")).toContain('"demo": "allow"')
    })
})

test("returns a conflict instead of overwriting an external update", () => {
    withTempDir((directory) => {
        const filePath = path.join(directory, "opencode.jsonc")
        writeFileSync(filePath, '{"permission": {"bash": "allow"}}', "utf-8")
        const loaded = loadConfig(filePath)
        if (loaded.status !== "ok") throw new Error("expected valid config")
        writeFileSync(filePath, '{"permission": {"bash": "deny"}}', "utf-8")
        const result = setToolPermission(filePath, "read", "deny", loaded.revision)
        expect(result.status).toBe("conflict")
        expect(readFileSync(filePath, "utf-8")).toContain('"bash": "deny"')
    })
})
