import type { ModificationOptions, ParseError } from "jsonc-parser"
import { applyEdits, modify, parse } from "jsonc-parser"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import {
    readFileRevision,
    sameFileRevision,
    type FileRevision,
    writeTextFileAtomic,
} from "./file-io.js"

export type ConfigData = {
    skillAllow: string[]
    skillDeny: string[]
    tools: Record<string, string>
    mcps: Array<{ name: string; type: string; enabled: boolean; command?: string[]; url?: string }>
}

export type ConfigLoadResult =
    | { status: "ok"; filePath: string; raw: string; data: ConfigData; revision: FileRevision }
    | { status: "missing"; filePath: string; raw: ""; data: ConfigData; revision: undefined }
    | { status: "invalid"; filePath: string; error: Error; revision?: FileRevision }
    | { status: "error"; filePath: string; error: unknown; revision?: FileRevision }

export type ConfigMutationResult =
    | { status: "ok"; revision: FileRevision }
    | { status: "conflict"; current?: FileRevision }
    | { status: "invalid"; error: Error }
    | { status: "error"; error: unknown }

function emptyConfigData(): ConfigData {
    return { skillAllow: [], skillDeny: [], tools: {}, mcps: [] }
}

export function findConfig(directory: string, worktree: string): string | null {
    let current = path.resolve(directory)
    const root = path.resolve(worktree)
    while (isWithin(root, current)) {
        for (const name of ["opencode.jsonc", "opencode.json"]) {
            const filePath = path.join(current, name)
            if (existsSync(filePath)) return filePath
        }
        if (current === root) break
        const next = path.dirname(current)
        if (next === current) break
        current = next
    }
    return null
}

function isWithin(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate)
    return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function detectIndent(text: string): ModificationOptions["formattingOptions"] {
    const m = text.match(/^( {2,4}|\t)/m)
    if (m) {
        const t = m[1]!
        return { tabSize: t === "\t" ? 1 : t.length, insertSpaces: t !== "\t" }
    }
    return { tabSize: 2, insertSpaces: true }
}

function parseConfig(filePath: string, raw: string, revision: FileRevision): ConfigLoadResult {
    const errors: ParseError[] = []
    const value = parse(raw, errors, { allowTrailingComma: true })
    if (errors.length > 0 || !value || typeof value !== "object" || Array.isArray(value)) {
        return {
            status: "invalid",
            filePath,
            revision,
            error: new Error("Invalid OpenCode JSONC configuration"),
        }
    }

    const data = emptyConfigData()
    const skill = value.permission?.skill
    if (skill === "allow") data.skillAllow.push("*")
    else if (skill === "deny") data.skillDeny.push("*")
    else if (skill && typeof skill === "object" && !Array.isArray(skill)) {
        for (const [name, action] of Object.entries(skill)) {
            if (action === "allow") data.skillAllow.push(name)
            else if (action === "deny") data.skillDeny.push(name)
        }
    }

    const permission = value.permission
    if (permission && typeof permission === "object" && !Array.isArray(permission)) {
        for (const [name, action] of Object.entries(permission)) {
            if (name !== "skill" && typeof action === "string") data.tools[name] = action
        }
    }

    const mcp = value.mcp
    if (mcp && typeof mcp === "object" && !Array.isArray(mcp)) {
        for (const [name, config] of Object.entries(mcp)) {
            const item = config && typeof config === "object" ? config as Record<string, any> : {}
            data.mcps.push({
                name,
                type: typeof item.type === "string" ? item.type : "local",
                enabled: item.enabled !== false,
                command: Array.isArray(item.command) ? item.command : undefined,
                url: typeof item.url === "string" ? item.url : undefined,
            })
        }
    }

    return { status: "ok", filePath, raw, data, revision }
}

export function loadConfig(filePath: string): ConfigLoadResult {
    if (!existsSync(filePath)) return { status: "missing", filePath, raw: "", data: emptyConfigData(), revision: undefined }

    const revision = readFileRevision(filePath)
    if (!revision) return { status: "error", filePath, error: new Error("Unable to stat configuration file") }

    try {
        const raw = readFileSync(filePath, "utf-8")
        const after = readFileRevision(filePath)
        if (!after || !sameFileRevision(revision, after)) {
            return { status: "error", filePath, error: new Error("Configuration changed while reading"), revision: after }
        }
        return parseConfig(filePath, raw, after)
    } catch (error) {
        return { status: "error", filePath, error, revision }
    }
}

export function readPermissions(filePath: string): { allow: string[]; deny: string[] } {
    const result = loadConfig(filePath)
    return result.status === "ok" || result.status === "missing"
        ? { allow: result.data.skillAllow, deny: result.data.skillDeny }
        : { allow: [], deny: [] }
}

export function readTools(filePath: string): Record<string, string> {
    const result = loadConfig(filePath)
    return result.status === "ok" || result.status === "missing" ? result.data.tools : {}
}

export function readMCPs(filePath: string): ConfigData["mcps"] {
    const result = loadConfig(filePath)
    return result.status === "ok" || result.status === "missing" ? result.data.mcps : []
}

const EMPTY_CONFIG = "{\n  \"$schema\": \"https://opencode.ai/config.json\"\n}\n"

function setConfigValue(
    filePath: string,
    jsonPath: Array<string | number>,
    value: unknown,
    expected?: FileRevision,
): ConfigMutationResult {
    const current = readFileRevision(filePath)
    const loaded = current ? loadConfig(filePath) : undefined
    if (loaded?.status === "invalid") return { status: "invalid", error: loaded.error }
    if (loaded?.status === "error") return { status: "error", error: loaded.error }

    try {
        const raw = loaded?.status === "ok" ? loaded.raw : EMPTY_CONFIG
        const edits = modify(raw, jsonPath, value, { formattingOptions: detectIndent(raw) })
        const text = applyEdits(raw, edits)
        const write = writeTextFileAtomic(filePath, text, expected ?? current)
        if (write.status === "ok") return write
        if (write.status === "conflict") return write
        return write
    } catch (error) {
        return { status: "error", error }
    }
}

export function setPermission(
    filePath: string,
    skillName: string,
    action: "allow" | "deny",
    expected?: FileRevision,
): ConfigMutationResult {
    return setConfigValue(filePath, ["permission", "skill", skillName], action, expected)
}

export function setToolPermission(
    filePath: string,
    tool: string,
    action: "allow" | "ask" | "deny",
    expected?: FileRevision,
): ConfigMutationResult {
    return setConfigValue(filePath, ["permission", tool], action, expected)
}

export function setMCPEnabled(
    filePath: string,
    name: string,
    enabled: boolean,
    expected?: FileRevision,
): ConfigMutationResult {
    return setConfigValue(filePath, ["mcp", name, "enabled"], enabled, expected)
}
