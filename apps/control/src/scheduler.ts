export interface LocalTask {
  task_id: string;
  run_at: number;
  attempt: number;
  max_attempts: number;
  backoff_ms: number;
  payload: unknown;
}

export type LocalTaskHandler = (task: LocalTask) => Promise<void> | void;

/** Deterministic Cloud Tasks-style queue for local retry and deadline tests. */
export class MemoryTaskScheduler {
  private readonly tasks = new Map<string, LocalTask>();

  schedule(task: Omit<LocalTask, 'attempt'>): boolean {
    if (this.tasks.has(task.task_id)) return false;
    this.tasks.set(task.task_id, { ...task, attempt: 0 });
    return true;
  }

  pending(): LocalTask[] { return [...this.tasks.values()].sort((left, right) => left.run_at - right.run_at || left.task_id.localeCompare(right.task_id)); }

  async runDue(now: number, handler: LocalTaskHandler): Promise<{ completed: number; retried: number; exhausted: number }> {
    const result = { completed: 0, retried: 0, exhausted: 0 };
    for (const task of this.pending()) {
      if (task.run_at > now) continue;
      task.attempt += 1;
      try {
        await handler({ ...task });
        this.tasks.delete(task.task_id);
        result.completed += 1;
      } catch {
        if (task.attempt >= task.max_attempts) { this.tasks.delete(task.task_id); result.exhausted += 1; }
        else { task.run_at = now + task.backoff_ms * (2 ** (task.attempt - 1)); result.retried += 1; }
      }
    }
    return result;
  }
}
