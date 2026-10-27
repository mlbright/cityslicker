import { Rng } from './rng';

const FIRST = [
  'Puddle', 'Bramble', 'Honey', 'Thistle', 'Clover', 'Maple', 'Pebble', 'Willow', 'Muffin', 'Bumble',
  'Hazel', 'Tumble', 'Button', 'Marigold', 'Fern', 'Biscuit', 'Juniper', 'Cobble', 'Sunny', 'Acorn',
  'Pickle', 'Moss', 'Plum', 'Tansy', 'Wren', 'Teacup', 'Primrose', 'Nettle', 'Saffron', 'Dimple',
];
const LAST = [
  'ford', 'ton', 'by', 'wick', 'dale', 'bury', 'field', 'stead', 'combe', 'ley', 'worth', 'holm',
  'brook', 'cott', 'ham', 'well',
];
const COASTAL_LAST = ['mouth', 'haven', 'port', 'sands', 'cove'];
const SUFFIX_PLACES = ['Quay', 'Green', 'Heights', 'Junction', 'Market', 'Crossing', 'Park', 'Vale', 'End'];

export function cityName(seed: number, coastal: boolean): string {
  const rng = new Rng(seed, 'city-name');
  const last = coastal && rng.chance(0.5) ? rng.pick(COASTAL_LAST) : rng.pick(LAST);
  const base = rng.pick(FIRST) + last;
  return rng.chance(0.2) ? `Little ${base}` : base;
}

/** Name for a Centre founded after the first, given its compass direction from the first Centre. */
export function centreName(
  seed: number,
  index: number,
  city: string,
  direction: string,
  nearWater: boolean,
  taken: ReadonlySet<string>,
): string {
  const rng = new Rng(seed, `centre-name:${index}`);
  const plain = city.replace(/^Little /, '');
  const options: string[] = [];
  if (nearWater) options.push(`${plain} Quay`);
  options.push(`${direction} ${plain}`, `${plain} ${rng.pick(SUFFIX_PLACES)}`, rng.pick(FIRST) + rng.pick(LAST));
  options.push(`${rng.pick(FIRST)}${rng.pick(LAST)} ${rng.pick(SUFFIX_PLACES)}`);
  for (let tries = 0; tries < 12; tries++) {
    const name = tries < options.length ? options[rng.int(options.length)] : rng.pick(FIRST) + rng.pick(LAST);
    if (!taken.has(name)) return name;
  }
  return `${plain} ${index + 1}`;
}

export function compassDirection(dx: number, dy: number): string {
  if (Math.abs(dx) > Math.abs(dy) * 1.6) return dx > 0 ? 'East' : 'West';
  if (Math.abs(dy) > Math.abs(dx) * 1.6) return dy > 0 ? 'South' : 'North';
  return `${dy > 0 ? 'South' : 'North'} ${dx > 0 ? 'East' : 'West'}`.replace('South East', 'Southeast').replace('South West', 'Southwest').replace('North East', 'Northeast').replace('North West', 'Northwest');
}
