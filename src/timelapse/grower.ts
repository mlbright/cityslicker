import type { Charter } from '../sim/charter';
import type { FromWorker, ToWorker } from '../sim/protocol';
import type { TickResult } from '../sim/sim';

/**
 * Talks to the simulation worker. Ticks computed ahead are held back in a buffer and only handed
 * over when the Playhead needs them, so the Present only advances while the Viewer is watching it.
 */
export class Grower {
  private readonly worker: Worker;
  private readonly buffer: TickResult[] = [];
  private inflight = false;
  private workerDone = false;
  name = '';
  targetPopulation = 0;
  onStarted: (() => void) | null = null;

  constructor(charter: Charter) {
    this.worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const msg = e.data;
      if (msg.type === 'started') {
        this.name = msg.name;
        this.targetPopulation = msg.targetPopulation;
        this.onStarted?.();
      } else {
        this.buffer.push(...msg.results);
        this.workerDone = msg.done;
        this.inflight = false;
      }
    };
    this.send({ type: 'start', charter });
  }

  private send(msg: ToWorker): void {
    this.worker.postMessage(msg);
  }

  /** Asks the worker to stay at least `min` ticks ahead. */
  keepAhead(min: number): void {
    if (this.inflight || this.workerDone || this.buffer.length >= min) return;
    this.inflight = true;
    this.send({ type: 'advance', count: Math.max(24, min * 2) });
  }

  /** Hands over up to `n` buffered ticks. */
  take(n: number): TickResult[] {
    return this.buffer.splice(0, Math.max(0, n));
  }

  get available(): number {
    return this.buffer.length;
  }

  /** True once the whole Run has been handed over. */
  get exhausted(): boolean {
    return this.workerDone && this.buffer.length === 0;
  }

  dispose(): void {
    this.worker.terminate();
  }
}
