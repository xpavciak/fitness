/**
 * A promise-chain mutex: tasks run one at a time, in call order. A failing task rejects its own
 * promise (the caller handles it) and does not block the tasks queued after it.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;

  run<T>(task: () => Promise<T>): Promise<T> {
    this.pending += 1;
    const result = this.tail.then(task).finally(() => {
      this.pending -= 1;
    });
    // The chain only orders tasks; each task's error is delivered through `result`.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** True while a task is running or queued. */
  get busy(): boolean {
    return this.pending > 0;
  }
}
