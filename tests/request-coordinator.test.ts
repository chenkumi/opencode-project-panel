import { expect, test } from "bun:test"
import { createRequestCoordinator } from "../src/request-coordinator"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test("keeps one request active and runs the latest pending task", async () => {
    const coordinator = createRequestCoordinator({ timeoutMs: 1000 })
    let active = 0
    let maximumActive = 0
    let runs = 0
    let releaseFirst: (() => void) | undefined

    const first = coordinator.run(async () => {
        active++
        runs++
        maximumActive = Math.max(maximumActive, active)
        await new Promise<void>((resolve) => { releaseFirst = resolve })
        active--
        return 1
    })
    coordinator.run(async () => {
        runs++
        return 2
    })
    releaseFirst?.()
    await first
    await wait(0)

    expect(maximumActive).toBe(1)
    expect(runs).toBe(2)
    coordinator.dispose()
})

test("aborts active work on dispose", async () => {
    const coordinator = createRequestCoordinator({ timeoutMs: 1000 })
    let aborted = false
    const request = coordinator.run((signal) => new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
            aborted = true
            reject(signal.reason)
        }, { once: true })
    }))
    coordinator.dispose()

    await expect(request).rejects.toBeDefined()
    expect(aborted).toBe(true)
})
