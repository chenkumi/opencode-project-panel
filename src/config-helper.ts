import { readFileSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"
import { modify, applyEdits, stripComments } from "jsonc-parser"
import type { ModificationOptions } from "jsonc-parser"

export function findConfig(directory: string, worktree: string): string | null {
  let current = path.resolve(directory)
  const root = path.resolve(worktree)
  while (current.startsWith(root)) {
    for (const name of ["opencode.jsonc", "opencode.json"]) {
      const fp = path.join(current, name)
      if (existsSync(fp)) return fp
    }
    if (current === root) break
    const next = path.dirname(current)
    if (next === current) break
    current = next
  }
  return null
}

function detectIndent(text: string): ModificationOptions["formattingOptions"] {
  const m = text.match(/^( {2,4}|\t)/m)
  if (m) {
    const t = m[1]!
    return { tabSize: t === "\t" ? 1 : t.length, insertSpaces: t !== "\t" }
  }
  return { tabSize: 2, insertSpaces: true }
}

export function readPermissions(filePath: string): { allow: string[]; deny: string[] } {
  const result: { allow: string[]; deny: string[] } = { allow: [], deny: [] }
  try {
    const raw = readFileSync(filePath, "utf-8")
    const text = stripComments(raw)
    const data = JSON.parse(text)
    const skill = data?.permission?.skill
    if (!skill) return result
    if (typeof skill === "string") {
      if (skill === "allow") result.allow.push("*")
      else if (skill === "deny") result.deny.push("*")
      return result
    }
    if (typeof skill === "object" && !Array.isArray(skill)) {
      for (const [k, v] of Object.entries(skill)) {
        if (v === "allow") result.allow.push(k)
        else if (v === "deny") result.deny.push(k)
      }
    }
  } catch {}
  return result
}

export function setPermission(filePath: string, skillName: string, action: "allow" | "deny"): void {
  try {
    let text = readFileSync(filePath, "utf-8")
    const opts: ModificationOptions = { formattingOptions: detectIndent(text) }
    const edits = modify(text, ["permission", "skill", skillName], action, opts)
    text = applyEdits(text, edits)
    writeFileSync(filePath, text, "utf-8")
  } catch {}
}

export function readTools(filePath: string): Record<string, string> {
  try {
    const raw = readFileSync(filePath, "utf-8")
    const text = stripComments(raw)
    const data = JSON.parse(text)
    const permission = data?.permission
    if (!permission || typeof permission !== "object") return {}
    const result: Record<string, string> = {}
    for (const [k, v] of Object.entries(permission)) {
      if (k === "skill") continue
      if (typeof v === "string") result[k] = v
    }
    return result
  } catch {
    return {}
  }
}

export function setToolPermission(filePath: string, tool: string, action: "allow" | "ask" | "deny"): void {
  try {
    let text = readFileSync(filePath, "utf-8")
    const opts: ModificationOptions = { formattingOptions: detectIndent(text) }
    const edits = modify(text, ["permission", tool], action, opts)
    text = applyEdits(text, edits)
    writeFileSync(filePath, text, "utf-8")
  } catch {}
}

export function readMCPs(filePath: string): Array<{ name: string; type: string; enabled: boolean; command?: string[]; url?: string }> {
  try {
    const raw = readFileSync(filePath, "utf-8")
    const text = stripComments(raw)
    const data = JSON.parse(text)
    const mcp = data?.mcp
    if (!mcp || typeof mcp !== "object") return []
    return Object.entries(mcp).map(([name, cfg]: [string, any]) => ({
      name,
      type: cfg?.type ?? "local",
      enabled: cfg?.enabled !== false,
      command: cfg?.command,
      url: cfg?.url,
    }))
  } catch {
    return []
  }
}

export function setMCPEnabled(filePath: string, name: string, enabled: boolean): void {
  try {
    let text = readFileSync(filePath, "utf-8")
    const opts: ModificationOptions = { formattingOptions: detectIndent(text) }
    const edits = modify(text, ["mcp", name, "enabled"], enabled, opts)
    text = applyEdits(text, edits)
    writeFileSync(filePath, text, "utf-8")
  } catch {}
}
