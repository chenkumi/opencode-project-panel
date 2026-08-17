export type RequestTask<T> = (signal: AbortSignal) => Promise<T>

export type RequestCoordinator = {
    run<T>(task: RequestTask<T>): Promise<T | undefined>
    dispose(): void
}

type ActiveRequest = {
    controller: AbortController
    promise: Promise<unknown>
}

export function createRequestCoordinator(options: {
    timeoutMs?: number
    parentSignal?: AbortSignal
} = {}): RequestCoordinator {
    const timeoutMs = options.timeoutMs ?? 10_000
    let active: ActiveRequest | undefined
    let pending: RequestTask<unknown> | undefined
    let disposed = false

    const start = <T>(task: RequestTask<T>): Promise<T | undefined> => {
        const controller = new AbortController()
        const parent = options.parentSignal
        const onParentAbort = () => controller.abort(parent?.reason)
        if (parent) {
            if (parent.aborted) controller.abort(parent.reason)
            else parent.addEventListener("abort", onParentAbort, { once: true })
        }

        const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs)
        const promise = task(controller.signal)
            .finally(() => {
                clearTimeout(timer)
                parent?.removeEventListener("abort", onParentAbort)
                if (active?.promise !== promise) return
                active = undefined
                const next = pending
                pending = undefined
                if (next && !disposed) queueMicrotask(() => { void start(next).catch(() => undefined) })
            })

        active = { controller, promise }
        return promise
    }

    return {
        run<T>(task: RequestTask<T>) {
            if (disposed) return Promise.resolve(undefined)
            if (active) {
                pending = task as RequestTask<unknown>
                return active.promise as Promise<T | undefined>
            }
            return start(task)
        },
        dispose() {
            disposed = true
            pending = undefined
            active?.controller.abort(new DOMException("Request coordinator disposed", "AbortError"))
        },
    }
}
