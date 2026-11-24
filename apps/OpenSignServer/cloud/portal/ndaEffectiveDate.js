// Calendar dates, never instants. The default NDA flow uses America/Chicago.
const centralDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const displayDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

export function validEffectiveDate(value, now = new Date()) {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    return false;
  const parts = Object.fromEntries(centralDate.formatToParts(now).map(p => [p.type, p.value]));
  return value <= `${parts.year}-${parts.month}-${parts.day}`;
}

export function ndaEffectiveDateText(date, now = new Date()) {
  if (date === undefined) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', year: 'numeric', month: 'long', day: 'numeric',
    }).format(now);
  }
  if (!validEffectiveDate(date, now)) throw new Error('Invalid NDA effective date');
  return displayDate.format(new Date(date + 'T00:00:00.000Z'));
}
