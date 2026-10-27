/** A Charter is everything that determines a City: its Seed plus the Viewer's settings. */
export type Water = 'lakes' | 'river' | 'coastal' | 'islands';
export type Hills = 'flat' | 'rolling' | 'mountainous';
export type Ambition = 'town' | 'city' | 'metro';

export interface Charter {
  seed: number;
  water: Water;
  hills: Hills;
  ambition: Ambition;
  /** RCI lean, from -1 (residential commuter town) to +1 (industrial port city). */
  lean: number;
}

export const WATER_OPTIONS: readonly Water[] = ['lakes', 'river', 'coastal', 'islands'];
export const HILLS_OPTIONS: readonly Hills[] = ['flat', 'rolling', 'mountainous'];
export const AMBITION_OPTIONS: readonly Ambition[] = ['town', 'city', 'metro'];

export const AMBITION_POPULATION: Record<Ambition, number> = {
  town: 5_000,
  city: 20_000,
  metro: 50_000,
};

export const AMBITION_LABEL: Record<Ambition, string> = {
  town: 'Sleepy town',
  city: 'Bustling city',
  metro: 'Metropolis',
};

export const DEFAULT_CHARTER: Omit<Charter, 'seed'> = {
  water: 'river',
  hills: 'rolling',
  ambition: 'city',
  lean: 0,
};

export function randomSeed(): number {
  return 1 + Math.floor(Math.random() * 999_999);
}

function oneOf<T extends string>(value: string | null, options: readonly T[], fallback: T): T {
  return value !== null && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function parseCharter(search: string): Charter | null {
  const params = new URLSearchParams(search);
  const seedText = params.get('seed');
  if (seedText === null) return null;
  const seed = Number.parseInt(seedText, 10);
  if (!Number.isFinite(seed) || seed <= 0) return null;
  const lean = Number.parseFloat(params.get('lean') ?? '0');
  return {
    seed: Math.min(seed, 2_000_000_000),
    water: oneOf(params.get('water'), WATER_OPTIONS, DEFAULT_CHARTER.water),
    hills: oneOf(params.get('hills'), HILLS_OPTIONS, DEFAULT_CHARTER.hills),
    ambition: oneOf(params.get('ambition'), AMBITION_OPTIONS, DEFAULT_CHARTER.ambition),
    lean: Number.isFinite(lean) ? Math.max(-1, Math.min(1, Math.round(lean * 10) / 10)) : 0,
  };
}

export function charterToSearch(c: Charter): string {
  const params = new URLSearchParams();
  params.set('seed', String(c.seed));
  params.set('water', c.water);
  params.set('hills', c.hills);
  params.set('ambition', c.ambition);
  params.set('lean', String(c.lean));
  return `?${params.toString()}`;
}

export function sameCharter(a: Charter, b: Charter): boolean {
  return (
    a.seed === b.seed &&
    a.water === b.water &&
    a.hills === b.hills &&
    a.ambition === b.ambition &&
    a.lean === b.lean
  );
}
