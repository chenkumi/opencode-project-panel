import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import {
    MAX_EDIT_BYTES,
    MAX_PREVIEW_BYTES,
    readFileRevision,
    readTextFile,
    writeTextFileAtomic,
} from "../src/file-io"

function withTempDir(run: (directory: string) => void): void {
    const directory = mkdtempSync(path.join(os.tmpdir(), "opencode-project-panel-test-"))
    try { run(directory) } finally { rmSync(directory, { recursive: true, force: true }) }
}

test("reads complete and truncated UTF-8 content within bounds", () => {
    withTempDir((directory) => {
        const filePath = path.join(directory, "sample.txt")
        writeFileSync(filePath, "a".repeat(MAX_PREVIEW_BYTES + 10), "utf-8")
        const result = readTextFile(filePath, MAX_PREVIEW_BYTES, "preview")
        expect(result.status).toBe("truncated")
        if (result.status === "truncated") expect(result.content.length).toBe(MAX_PREVIEW_BYTES)
    })
})

test("rejects oversized edit content and binary content", () => {
    withTempDir((directory) => {
        const largePath = path.join(directory, "large.txt")
        writeFileSync(largePath, "x".repeat(MAX_EDIT_BYTES + 1), "utf-8")
        expect(readTextFile(largePath, MAX_EDIT_BYTES, "edit").status).toBe("too-large")

        const binaryPath = path.join(directory, "binary")
        writeFileSync(binaryPath, Buffer.from([65, 0, 66]))
        expect(readTextFile(binaryPath, MAX_PREVIEW_BYTES, "preview").status).toBe("binary")
    })
})

test("does not overwrite a file after its revision changes", () => {
    withTempDir((directory) => {
        const filePath = path.join(directory, "conflict.txt")
        writeFileSync(filePath, "original", "utf-8")
        const revision = readFileRevision(filePath)
        writeFileSync(filePath, "external", "utf-8")
        const result = writeTextFileAtomic(filePath, "plugin", revision)
        expect(result.status).toBe("conflict")
        expect(readFileSync(filePath, "utf-8")).toBe("external")
    })
})

test("atomically writes new content", () => {
    withTempDir((directory) => {
        const filePath = path.join(directory, "atomic.txt")
        const result = writeTextFileAtomic(filePath, "saved")
        expect(result.status).toBe("ok")
        expect(readFileSync(filePath, "utf-8")).toBe("saved")
    })
})
