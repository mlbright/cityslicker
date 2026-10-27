/** Tiny DOM helper: h('div.card', {onclick}, child, 'text'). */
export function h<T extends HTMLElement = HTMLElement>(
  tag: string,
  props: Partial<Record<string, unknown>> = {},
  ...children: (Node | string | null | undefined | false)[]
): T {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name) as T;
  if (classes.length) el.className = classes.join(' ');
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'html') {
      el.innerHTML = String(value);
    } else if (key in el && key !== 'list') {
      (el as unknown as Record<string, unknown>)[key] = value;
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) el.append(child);
  return el;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Date of the Playhead, e.g. "Mar · Year 37". `applied` is the number of ticks applied. */
export function formatDate(applied: number): string {
  const month = applied % 12;
  const year = Math.floor(applied / 12);
  return `${MONTHS[month]} · Year ${year}`;
}

export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export const ICONS = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6.5" y="5" width="4" height="14" rx="1.5" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.5" fill="currentColor"/></svg>',
  reverse: '<svg viewBox="0 0 24 24"><path d="M11.5 6.2v11.6a.8.8 0 0 1-1.25.66L2.6 13.1a1.3 1.3 0 0 1 0-2.2l7.65-5.36a.8.8 0 0 1 1.25.66zm10 0v11.6a.8.8 0 0 1-1.25.66L12.6 13.1a1.3 1.3 0 0 1 0-2.2l7.65-5.36a.8.8 0 0 1 1.25.66z" fill="currentColor"/></svg>',
  present: '<svg viewBox="0 0 24 24"><path d="M5 6.2v11.6a.8.8 0 0 0 1.25.66l7.65-5.36a1.3 1.3 0 0 0 0-2.2L6.25 5.54A.8.8 0 0 0 5 6.2z" fill="currentColor"/><rect x="16" y="5" width="3.2" height="14" rx="1.4" fill="currentColor"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M9 4.5h6l1.4 2H19a2.5 2.5 0 0 1 2.5 2.5v8.5A2.5 2.5 0 0 1 19 20H5a2.5 2.5 0 0 1-2.5-2.5V9A2.5 2.5 0 0 1 5 6.5h2.6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><g stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5"/></g></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20 14.6A8.2 8.2 0 0 1 9.4 4a8.2 8.2 0 1 0 10.6 10.6z" fill="currentColor"/></svg>',
  cycle: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18V3z" fill="currentColor"/><circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  orbit: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="9.5" ry="4.2" fill="none" stroke="currentColor" stroke-width="1.7" transform="rotate(-18 12 12)"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/><circle cx="20" cy="9.3" r="1.6" fill="currentColor"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.2L12 5.6v12.8l-4.8-3.9H4z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.2L12 5.6v12.8l-4.8-3.9H4z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M16 9.5l5 5M21 9.5l-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  dice: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',
};
