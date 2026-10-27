/// <reference lib="webworker" />
import type { FromWorker, ToWorker } from './protocol';
import { Simulation } from './sim';

/** Runs the Simulation off the main thread. It only ever moves forward, when asked. */
let sim: Simulation | null = null;

const post = (msg: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === 'start') {
    sim = new Simulation(msg.charter);
    post({ type: 'started', name: sim.name, targetPopulation: sim.targetPopulation });
    return;
  }
  if (msg.type === 'advance' && sim) {
    const results = [];
    const transfer: Transferable[] = [];
    for (let k = 0; k < msg.count; k++) {
      const r = sim.step();
      if (!r) break;
      if (r.fields) transfer.push(r.fields.landValue.buffer as ArrayBuffer, r.fields.traffic.buffer as ArrayBuffer);
      results.push(r);
    }
    post({ type: 'ticks', results, done: sim.done }, transfer);
  }
};
