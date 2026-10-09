/** Shared by the browser and workers. Education is context, never proof of time worked. */
export interface ExperiencePosition {
  start?: unknown;
  end?: unknown;
  current?: boolean;
}

export interface ExperienceProfile {
  work_experience?: ExperiencePosition[];
  current_positions?: ExperiencePosition[];
  past_positions?: ExperiencePosition[];
  education?: Array<{ end?: unknown; degree?: string }>;
}

export interface ExperienceAssessment {
  source: 'work' | 'education' | 'unknown';
  years: number | null;
  months: number | null;
  lowerYears: number | null;
  upperYears: number | null;
  complete: boolean;
  approximate: boolean;
  educationYear?: number;
}

function dateParts(value: unknown): { year: number; month?: number } | null {
  let year: unknown;
  let month: unknown;
  if (typeof value === 'string') {
    const match = /^(\d{4})(?:-(\d{2})(?:-\d{2})?)?$/.exec(value);
    if (!match) return null;
    year = Number(match[1]);
    month = match[2] ? Number(match[2]) : undefined;
  } else if (value && typeof value === 'object') {
    ({ year, month } = value as { year?: unknown; month?: unknown });
  }
  if (typeof year !== 'number' || !Number.isInteger(year) || year < 1970) return null;
  if (month != null && (typeof month !== 'number' || !Number.isInteger(month) || month < 1 || month > 12)) return null;
  return { year, month: typeof month === 'number' ? month : undefined };
}

function positionInterval(position: ExperiencePosition, now: Date) {
  if (!position || typeof position !== 'object' || Array.isArray(position)) return null;
  const start = dateParts(position.start);
  const end = dateParts(position.end);
  if (!start || (position.end && !end) || (!end && position.current === false)) return null;
  const currentMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const startMonth = start.year * 12 + (start.month ?? 1) - 1;
  const endMonth = end ? end.year * 12 + (end.month ?? 1) - 1 : currentMonth;
  if (startMonth > currentMonth || endMonth < startMonth || endMonth > currentMonth || endMonth - startMonth > 60 * 12) return null;
  return {
    start: startMonth, end: endMonth,
    latestStart: start.month ? startMonth : Math.min(startMonth + 11, currentMonth),
    latestEnd: end && !end.month ? Math.min(endMonth + 11, currentMonth) : endMonth,
    approximate: !start.month || Boolean(end && !end.month),
  };
}

export function getWorkExperienceDurationMonths(position: ExperiencePosition, now = new Date()): number | null {
  const interval = positionInterval(position, now);
  return interval ? interval.end - interval.start : null;
}

function unionMonths(intervals: Array<{ start: number; end: number }>): number {
  const sorted = intervals.filter(interval => interval.end > interval.start).sort((a, b) => a.start - b.start);
  let total = 0;
  let start = 0;
  let end = 0;
  for (const interval of sorted) {
    if (interval.start > end) {
      total += end - start;
      start = interval.start;
      end = interval.end;
    } else end = Math.max(end, interval.end);
  }
  return total + end - start;
}

export function assessProfileExperience(profile: ExperienceProfile, now = new Date()): ExperienceAssessment {
  const values = profile && typeof profile === 'object' ? profile : {};
  const hasHistory = Array.isArray(values.work_experience) && values.work_experience.length > 0;
  const work = hasHistory ? values.work_experience! : [
    ...(Array.isArray(values.current_positions) ? values.current_positions : []).map(position => ({ ...position, current: true })),
    ...(Array.isArray(values.past_positions) ? values.past_positions : []).map(position => ({ ...position, current: false })),
  ];
  const intervals = work.map(position => positionInterval(position, now)).filter(interval => interval !== null);
  if (intervals.length) {
    const months = unionMonths(intervals);
    return {
      source: 'work', months, years: Math.floor(months / 12),
      lowerYears: unionMonths(intervals.map(interval => ({ start: interval.latestStart, end: interval.end }))) / 12,
      upperYears: unionMonths(intervals.map(interval => ({ start: interval.start, end: interval.latestEnd }))) / 12,
      // Search result position summaries may omit an entire earlier career.
      complete: hasHistory && intervals.length === work.length,
      approximate: intervals.some(interval => interval.approximate),
    };
  }
  const educationYears = (Array.isArray(values.education) ? values.education : []).map(education => dateParts(education?.end)?.year)
    .filter((year): year is number => year !== undefined && year <= now.getUTCFullYear() && now.getUTCFullYear() - year <= 60);
  const educationYear = educationYears.length ? Math.min(...educationYears) : undefined;
  return {
    source: educationYear === undefined ? 'unknown' : 'education',
    years: null, months: null, lowerYears: null, upperYears: null, complete: false, approximate: true,
    ...(educationYear === undefined ? {} : { educationYear }),
  };
}

/** Unknown or partial careers stay visible. Year-only dates use conservative bounds. */
export function matchesCalculatedExperience(profile: ExperienceProfile, minYears: number | null, maxYears: number | null, now = new Date()): boolean {
  const experience = assessProfileExperience(profile, now);
  if (experience.source !== 'work' || !experience.complete) return true;
  if (minYears !== null && experience.upperYears !== null && experience.upperYears < minYears) return false;
  if (maxYears !== null && experience.lowerYears !== null && experience.lowerYears > maxYears) return false;
  return true;
}

/** A cutoff inside a year-only date interval cannot establish a fit or mismatch. */
export function isExperienceRangeUncertain(experience: ExperienceAssessment | undefined, minYears: number | null, maxYears: number | null): boolean {
  if (!experience?.approximate || experience.lowerYears === null || experience.upperYears === null) return false;
  return (minYears !== null && experience.lowerYears < minYears && experience.upperYears >= minYears)
    || (maxYears !== null && experience.lowerYears <= maxYears && experience.upperYears > maxYears);
}
