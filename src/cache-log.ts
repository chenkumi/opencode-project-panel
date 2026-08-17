import { appendFile, stat } from "node:fs/promises"

const MAX_LOG_BYTES = 2 * 1024 * 1024
const logPath = process.env.OPENCODE_PROJECT_PANEL_CACHE_LOG
const encoder = new TextEncoder()
let writes = Promise.resolve()
let disabled = false

export function summarizeCacheTokens(tokens: any) {
    if (tokens === undefined) return undefined
    if (tokens === null || typeof tokens !== "object" || Array.isArray(tokens)) return { valueType: typeof tokens }

    return {
        keys: Object.keys(tokens).sort(),
        input: tokens.input,
        output: tokens.output,
        reasoning: tokens.reasoning,
        cache: tokens.cache === undefined
            ? undefined
            : tokens.cache === null || typeof tokens.cache !== "object" || Array.isArray(tokens.cache)
                ? { valueType: typeof tokens.cache }
                : {
                    keys: Object.keys(tokens.cache).sort(),
                    read: tokens.cache.read,
                    write: tokens.cache.write,
                },
    }
}

export function logCacheEvent(event: Record<string, unknown>) {
    if (!logPath || disabled) return

    let line: string
    try {
        line = `${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`
    } catch {
        return
    }

    writes = writes.then(async () => {
        if (disabled) return
        const bytes = encoder.encode(line).byteLength
        if (bytes > MAX_LOG_BYTES) {
            disabled = true
            return
        }

        try {
            const currentSize = await stat(logPath).then((value) => value.size).catch(() => 0)
            if (currentSize + bytes > MAX_LOG_BYTES) {
                disabled = true
                return
            }
            await appendFile(logPath, line, "utf8")
        } catch {
            disabled = true
        }
    })
}
