export type ProcessingTaskFilter = {
  all?: boolean
  kind?: string
  requestId?: string
  tabId?: string
}

export type ProcessingTaskRegistration = {
  id: string
  kind: string
  requestId?: string
  tabId?: string
  release: () => void
}

type ProcessingTaskRecord = Omit<ProcessingTaskRegistration, 'release'> & {
  cancel: () => void
  settled: Promise<void>
}

function matchesTask(task: ProcessingTaskRecord, filter: ProcessingTaskFilter) {
  if (filter.all) return true
  if (filter.kind && task.kind !== filter.kind) return false
  if (filter.requestId && task.requestId !== filter.requestId) return false
  if (filter.tabId && task.tabId !== filter.tabId) return false
  return Boolean(filter.kind || filter.requestId || filter.tabId)
}

export class ProcessingTaskRegistry {
  private disposed = false

  private nextTaskId = 1

  private readonly tasks = new Map<string, ProcessingTaskRecord>()

  register(input: {
    cancel: () => void
    kind: string
    requestId?: string
    settled: Promise<void>
    tabId?: string
  }): ProcessingTaskRegistration {
    if (this.disposed) {
      throw new Error('processing task registry 已释放')
    }
    const kind = String(input.kind || '').trim()
    if (!kind) {
      throw new Error('processing task kind 不能为空')
    }
    const id = `processing-task-${this.nextTaskId++}`
    const record: ProcessingTaskRecord = {
      cancel: input.cancel,
      id,
      kind,
      requestId: input.requestId,
      settled: input.settled,
      tabId: input.tabId,
    }
    this.tasks.set(id, record)
    return {
      id,
      kind,
      requestId: input.requestId,
      release: () => {
        if (this.tasks.get(id) === record) {
          this.tasks.delete(id)
        }
      },
      tabId: input.tabId,
    }
  }

  get size() {
    return this.tasks.size
  }

  getSnapshot() {
    return [...this.tasks.values()].map(task => ({
      id: task.id,
      kind: task.kind,
      requestId: task.requestId,
      tabId: task.tabId,
    }))
  }

  async cancel(filter: ProcessingTaskFilter = { all: true }) {
    const tasks = [...this.tasks.values()].filter(task => matchesTask(task, filter))
    tasks.forEach(task => {
      try {
        task.cancel()
      } catch {
        // A cancellation hook must not prevent the remaining tasks from settling.
      }
    })
    await Promise.allSettled(tasks.map(task => task.settled))
    return tasks.length
  }

  async dispose() {
    if (this.disposed) return
    this.disposed = true
    await this.cancel({ all: true })
  }
}

export const defaultProcessingTaskRegistry = new ProcessingTaskRegistry()
