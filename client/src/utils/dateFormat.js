/**
 * Shared date formatting for display (dd-mm-yyyy) and API/inputs (YYYY-MM-DD).
 */

function parseDateParts(value) {
  if (value == null || value === '') return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
      hours: value.getHours(),
      minutes: value.getMinutes(),
      hasTime: true,
    };
  }

  const str = String(value).trim();

  // YYYY-MM-DD or ISO datetime
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?/.exec(str);
  if (iso) {
    const hasTime = iso[4] != null;
    if (!hasTime) {
      return {
        year: Number(iso[1]),
        month: Number(iso[2]),
        day: Number(iso[3]),
        hours: 0,
        minutes: 0,
        hasTime: false,
      };
    }
    const d = new Date(str);
    if (Number.isNaN(d.getTime())) return null;
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      hours: d.getHours(),
      minutes: d.getMinutes(),
      hasTime: true,
    };
  }

  // Already dd-mm-yyyy
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(str);
  if (dmy) {
    return {
      year: Number(dmy[3]),
      month: Number(dmy[2]),
      day: Number(dmy[1]),
      hours: 0,
      minutes: 0,
      hasTime: false,
    };
  }

  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hours: d.getHours(),
    minutes: d.getMinutes(),
    hasTime: true,
  };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Display date as dd-mm-yyyy */
export function formatDisplayDate(value, fallback = '—') {
  const parts = parseDateParts(value);
  if (!parts) return fallback;
  return `${pad2(parts.day)}-${pad2(parts.month)}-${parts.year}`;
}

/** Display datetime as dd-mm-yyyy, HH:mm */
export function formatDisplayDateTime(value, fallback = '—') {
  const parts = parseDateParts(value);
  if (!parts) return fallback;
  const date = `${pad2(parts.day)}-${pad2(parts.month)}-${parts.year}`;
  if (!parts.hasTime) return date;
  return `${date}, ${pad2(parts.hours)}:${pad2(parts.minutes)}`;
}

/** API / <input type="date"> value as YYYY-MM-DD */
export function toISODateString(value = new Date()) {
  const parts = parseDateParts(value instanceof Date || value != null ? value : new Date());
  if (!parts) return '';
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/**
 * Parse a single date token (dd-mm-yyyy or YYYY-MM-DD) to API ISO date.
 * Returns '' if invalid.
 */
export function parseToISODate(value) {
  const parts = parseDateParts(value);
  if (!parts) return '';
  // Reject clearly impossible calendar dates after parse
  const probe = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    probe.getUTCFullYear() !== parts.year ||
    probe.getUTCMonth() + 1 !== parts.month ||
    probe.getUTCDate() !== parts.day
  ) {
    return '';
  }
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/**
 * Parse a multi-date paste blob (newlines / commas / spaces) into unique ISO dates.
 * Accepts dd-mm-yyyy and YYYY-MM-DD.
 */
export function parseDateListToISO(text) {
  const tokens = String(text || '')
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const dates = [];
  const seen = new Set();
  for (const t of tokens) {
    const iso = parseToISODate(t);
    if (!iso || seen.has(iso)) continue;
    seen.add(iso);
    dates.push(iso);
  }
  return dates.sort();
}
