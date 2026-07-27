// src/testing/deterministic/virtual-clock.ts

import { monotonicTimestamp, type MonotonicTimestamp } from '../../backend-contract/primitives'

export interface ScheduledTaskHandle {
  readonly id: number
  cancel(): void
  isPending(): boolean
}

interface ScheduledTask {
  readonly id: number
  readonly dueAt: number
  readonly insertionOrdinal: number
  readonly action: () => void
  cancelled: boolean
}

/** A monotonic, explicitly advanced scheduler for deterministic backend tests. */
export class DeterministicVirtualClock {
  private currentTime = 0
  private nextTaskId = 1
  private nextInsertionOrdinal = 1
  private readonly tasks = new Map<number, ScheduledTask>()

  now(): MonotonicTimestamp {
    return monotonicTimestamp(this.currentTime)
  }

  scheduleAfter(delayMs: number, action: () => void): ScheduledTaskHandle {
    if (!Number.isSafeInteger(delayMs) || delayMs < 0) {
      throw new Error('deterministic scheduler delay must be a non-negative safe integer')
    }
    return this.scheduleAt(monotonicTimestamp(this.currentTime + delayMs), action)
  }

  scheduleAt(when: MonotonicTimestamp, action: () => void): ScheduledTaskHandle {
    const dueAt = Number(when)
    if (!Number.isSafeInteger(dueAt) || dueAt < this.currentTime) {
      throw new Error('deterministic scheduler cannot schedule a task in the past')
    }
    const task: ScheduledTask = {
      id: this.nextTaskId,
      dueAt,
      insertionOrdinal: this.nextInsertionOrdinal,
      action,
      cancelled: false
    }
    this.nextTaskId += 1
    this.nextInsertionOrdinal += 1
    this.tasks.set(task.id, task)
    return {
      id: task.id,
      cancel: () => {
        task.cancelled = true
        this.tasks.delete(task.id)
      },
      isPending: () => !task.cancelled && this.tasks.has(task.id)
    }
  }

  advanceBy(durationMs: number): void {
    if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
      throw new Error('deterministic clock duration must be a non-negative safe integer')
    }
    this.advanceTo(monotonicTimestamp(this.currentTime + durationMs))
  }

  advanceTo(target: MonotonicTimestamp): void {
    const targetTime = Number(target)
    if (!Number.isSafeInteger(targetTime) || targetTime < this.currentTime) {
      throw new Error('deterministic clock cannot move backwards')
    }
    while (true) {
      const next = this.nextRunnableAtOrBefore(targetTime)
      if (next === null) {
        this.currentTime = targetTime
        return
      }
      this.currentTime = next.dueAt
      this.tasks.delete(next.id)
      next.cancelled = true
      next.action()
    }
  }

  runUntilIdle(): void {
    while (true) {
      const next = this.nextRunnableAtOrBefore(Number.MAX_SAFE_INTEGER)
      if (next === null) {
        return
      }
      this.advanceTo(monotonicTimestamp(next.dueAt))
    }
  }

  pendingTaskCount(): number {
    return this.tasks.size
  }

  private nextRunnableAtOrBefore(targetTime: number): ScheduledTask | null {
    let candidate: ScheduledTask | null = null
    for (const task of this.tasks.values()) {
      if (task.cancelled || task.dueAt > targetTime) {
        continue
      }
      if (
        candidate === null ||
        task.dueAt < candidate.dueAt ||
        (task.dueAt === candidate.dueAt && task.insertionOrdinal < candidate.insertionOrdinal)
      ) {
        candidate = task
      }
    }
    return candidate
  }
}
