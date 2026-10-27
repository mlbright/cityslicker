import type { Charter } from './charter';
import type { TickResult } from './sim';

export type ToWorker = { type: 'start'; charter: Charter } | { type: 'advance'; count: number };

export type FromWorker =
  | { type: 'started'; name: string; targetPopulation: number }
  | { type: 'ticks'; results: TickResult[]; done: boolean };
