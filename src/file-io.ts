import {
    closeSync,
    fsyncSync,
    mkdtempSync,
    openSync,
    readSync,
    renameSync,
    rmSync,
    statSync,
    writeSync,
} from "node:fs"
import type { Stats } from "node:fs"
import path from "node:path"

export const MAX_PREVIEW_BYTES = 1024 * 1024
export const MAX_EDIT_BYTES = 5 * 1024 * 1024
export const MAX_DIRECTORY_ENTRIES = 5000
export const MAX_SEARCH_MATCHES = 2000

export type FileRevision = {
    path: string
    device: number | bigint
    inode: number | bigint
    size: number
    mtimeMs: number
    mode: number
}

export type TextReadResult =
    | { status: "ok"; content: string; revision: FileRevision }
    | { status: "truncated"; content: string; revision: FileRevision; size: number }
    | { status: "too-large"; revision: FileRevision; size: number }
    | { status: "binary"; revision: FileRevision }
    | { status: "error"; error: unknown }

export type TextWriteResult =
    | { status: "ok"; revision: FileRevision }
    | { status: "conflict"; current?: FileRevision }
    | { status: "error"; error: unknown }

function toRevision(filePath: string, info: Stats): FileRevision {
    return {
        path: path.resolve(filePath),
        device: info.dev,
        inode: info.ino,
        size: info.size,
        mtimeMs: info.mtimeMs,
        mode: info.mode,
    }
}

export function readFileRevision(filePath: string): FileRevision | undefined {
    try {
        return toRevision(filePath, statSync(filePath) as Stats)
    } catch {
        return undefined
    }
}

export function sameFileRevision(left: FileRevision | undefined, right: FileRevision | undefined): boolean {
    if (!left || !right) return left === right
    return left.path === right.path
        && left.device === right.device
        && left.inode === right.inode
        && left.size === right.size
        && left.mtimeMs === right.mtimeMs
        && left.mode === right.mode
}

function readPrefix(filePath: string, size: number): Buffer {
    const fd = openSync(filePath, "r")
    const buffer = Buffer.alloc(size)
    let offset = 0
    try {
        while (offset < size) {
            const bytesRead = readSync(fd, buffer, offset, size - offset, offset)
            if (bytesRead === 0) break
            offset += bytesRead
        }
        return offset === size ? buffer : buffer.subarray(0, offset)
    } finally {
        closeSync(fd)
    }
}

function containsNullByte(buffer: Buffer): boolean {
    return buffer.includes(0)
}

function decodeUtf8(buffer: Buffer, fatal: boolean): string {
    return new TextDecoder("utf-8", { fatal }).decode(buffer)
}

export function readTextFile(filePath: string, maxBytes: number, mode: "preview" | "edit"): TextReadResult {
    const before = readFileRevision(filePath)
    if (!before) return { status: "error", error: new Error("File is not readable") }
    if (mode === "edit" && before.size > maxBytes) return { status: "too-large", revision: before, size: before.size }

    try {
        const bytesToRead = Math.min(before.size, maxBytes)
        const buffer = readPrefix(filePath, bytesToRead)
        const after = readFileRevision(filePath)
        if (!after || !sameFileRevision(before, after)) return { status: "error", error: new Error("File changed while reading") }
        if (containsNullByte(buffer)) return { status: "binary", revision: after }

        const content = decodeUtf8(buffer, mode === "edit")
        if (before.size > maxBytes) return { status: "truncated", content, revision: after, size: before.size }
        return { status: "ok", content, revision: after }
    } catch (error) {
        return { status: "error", error }
    }
}

function writeAll(fd: number, data: Buffer): void {
    let offset = 0
    while (offset < data.length) offset += writeSync(fd, data, offset, data.length - offset)
}

export function writeTextFileAtomic(
    filePath: string,
    content: string,
    expected?: FileRevision,
): TextWriteResult {
    const current = readFileRevision(filePath)
    if (!sameFileRevision(expected, current)) return { status: "conflict", current }

    const directory = path.dirname(filePath)
    const temporaryDirectory = mkdtempSync(path.join(directory, ".opencode-project-panel-"))
    const temporaryPath = path.join(temporaryDirectory, "content")
    let fd: number | undefined

    try {
        const mode = current ? current.mode & 0o777 : 0o666
        fd = openSync(temporaryPath, "wx", mode)
        writeAll(fd, Buffer.from(content, "utf-8"))
        fsyncSync(fd)
        closeSync(fd)
        fd = undefined

        const beforeRename = readFileRevision(filePath)
        if (!sameFileRevision(expected, beforeRename)) return { status: "conflict", current: beforeRename }

        renameSync(temporaryPath, filePath)
        const revision = readFileRevision(filePath)
        if (!revision) return { status: "error", error: new Error("Unable to stat saved file") }
        return { status: "ok", revision }
    } catch (error) {
        return { status: "error", error }
    } finally {
        if (fd !== undefined) {
            try { closeSync(fd) } catch { /* preserve the original result */ }
        }
        try { rmSync(temporaryDirectory, { recursive: true, force: true }) } catch { /* best effort cleanup */ }
    }
}
