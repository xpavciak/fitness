import { describe, expect, it } from 'vitest';
import { SerialQueue } from './serial-queue';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

describe('SerialQueue', () => {
  it('runs overlapping tasks one at a time, in order', async () => {
    const queue = new SerialQueue();
    const events: string[] = [];
    const task = (name: string) => async () => {
      events.push(`start ${name}`);
      await tick();
      events.push(`end ${name}`);
      return name;
    };
    const results = await Promise.all([queue.run(task('a')), queue.run(task('b'))]);
    expect(results).toEqual(['a', 'b']);
    expect(events).toEqual(['start a', 'end a', 'start b', 'end b']);
    expect(queue.busy).toBe(false);
  });

  it('reports a failure to its caller and keeps going', async () => {
    const queue = new SerialQueue();
    const failed = queue.run(() => Promise.reject(new Error('boom')));
    const next = queue.run(() => Promise.resolve('ok'));
    expect(queue.busy).toBe(true);
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });
});
