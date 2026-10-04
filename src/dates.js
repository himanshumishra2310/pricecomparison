/**
 * Date helpers. Everything is computed in the configured timezone (IST by default)
 * so a run at 11 PM IST still treats "today" as the Indian calendar day.
 */

function partsInTz(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const o = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return { y: +o.year, m: +o.month, d: +o.day, hh: +o.hour, mm: +o.minute };
}

export function todayIso(timeZone, now = new Date()) {
  const { y, m, d } = partsInTz(now, timeZone);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function addDaysIso(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export function formatShort(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

export function formatStamp(date, timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(date) + ' IST';
}

/** Build the check-in/check-out windows from settings (D0, D1, D2 by default). */
export function buildWindows(settings, now = new Date()) {
  const today = todayIso(settings.timezone, now);
  return settings.dateWindows.map((w) => {
    const checkIn = addDaysIso(today, w.offsetDays);
    const checkOut = addDaysIso(checkIn, settings.nights || 1);
    return { ...w, checkIn, checkOut, label: `${w.label} · ${formatShort(checkIn)} → ${formatShort(checkOut)}` };
  });
}

/** File-safe run id, e.g. 2026-10-04_2317 (IST). */
export function runId(timeZone, now = new Date()) {
  const { y, m, d, hh, mm } = partsInTz(now, timeZone);
  const p = (n) => String(n).padStart(2, '0');
  return `${y}-${p(m)}-${p(d)}_${p(hh)}${p(mm)}`;
}
