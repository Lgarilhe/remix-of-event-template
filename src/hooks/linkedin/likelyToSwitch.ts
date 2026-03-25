import { LinkedInProfile } from '@/components/outreach/types';

export interface SwitchSignal {
  key: string;
  label: string;
  emoji: string;
  weight: number;
  active: boolean;
  detail?: string;
}

export interface LikelyToSwitchResult {
  score: number;
  level: 'high' | 'medium' | 'low' | 'unknown';
  signals: SwitchSignal[];
  summary: string;
}

export function computeLikelyToSwitch(profile: LinkedInProfile): LikelyToSwitchResult {
  const signals: SwitchSignal[] = [];

  // Signal 1: Open to Work (30 pts)
  const isOTW = (profile as any).open_to_work || (profile as any).is_open_to_work;
  signals.push({
    key: 'open_to_work',
    label: 'Open to Work',
    emoji: '🟢',
    weight: 30,
    active: !!isOTW,
    detail: isOTW ? 'Déclaré ouvert aux opportunités' : undefined,
  });

  // Signal 2: Open Profile (15 pts)
  const isOpenProfile = (profile as any).open_profile || (profile as any).is_open_profile;
  signals.push({
    key: 'open_profile',
    label: 'Profil ouvert',
    emoji: '📬',
    weight: 15,
    active: !!isOpenProfile,
    detail: isOpenProfile ? 'InMail gratuit — profil ouvert à tous' : undefined,
  });

  // Signal 3: Likely to Respond (15 pts)
  const isLikelyToRespond = ((profile as any).interests || []).includes('LIKELY_TO_RESPOND');
  signals.push({
    key: 'likely_to_respond',
    label: 'Réactif sur LinkedIn',
    emoji: '⚡',
    weight: 15,
    active: isLikelyToRespond,
    detail: isLikelyToRespond ? 'LinkedIn le classe comme réactif aux messages' : undefined,
  });

  // Signal 4: Short current tenure (20 pts)
  const allWork = [
    ...((profile as any).work_experience || []),
    ...((profile as any).current_positions || []),
  ];
  const currentJob = allWork.find((w: any) => w.current === true || (!w.end));
  let currentTenureMonths: number | null = null;

  if (currentJob) {
    const start = currentJob.start;
    let startYear: number | null = null;
    let startMonth = 1;
    if (typeof start === 'object' && start?.year) {
      startYear = start.year;
      startMonth = start.month || 1;
    } else if (typeof start === 'string') {
      const parsed = parseInt(start.substring(0, 4), 10);
      if (!isNaN(parsed) && parsed > 1970) {
        startYear = parsed;
        const m = parseInt(start.substring(5, 7), 10);
        if (!isNaN(m)) startMonth = m;
      }
    }
    if (!startYear && currentJob.tenure_at_company) {
      const t = currentJob.tenure_at_company as { years?: number; months?: number };
      currentTenureMonths = (t.years || 0) * 12 + (t.months || 0);
    }
    if (startYear && !currentTenureMonths) {
      const startDate = new Date(startYear, startMonth - 1);
      currentTenureMonths = Math.max(1, Math.round(
        (Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
      ));
    }
  }

  const shortTenure = currentTenureMonths !== null && currentTenureMonths < 18;
  const veryNewRole = currentTenureMonths !== null && currentTenureMonths < 6;
  signals.push({
    key: 'short_tenure',
    label: 'Poste récent',
    emoji: '🔄',
    weight: 20,
    active: shortTenure && !veryNewRole,
    detail: currentTenureMonths !== null
      ? (veryNewRole
        ? `En poste depuis ${currentTenureMonths} mois (vient de commencer)`
        : shortTenure
          ? `En poste depuis ${currentTenureMonths} mois (< 18 mois)`
          : `En poste depuis ${currentTenureMonths} mois`)
      : undefined,
  });

  // Signal 5: Job hopping pattern (20 pts)
  const pastPositions = allWork.filter((w: any) => w.end || w.current === false);
  let avgTenureMonths: number | null = null;

  if (pastPositions.length >= 2) {
    let totalMonths = 0;
    let count = 0;
    for (const pos of pastPositions) {
      const start = pos.start;
      const end = pos.end;
      let sYear: number | null = null;
      let sMonth = 1;
      let eYear: number | null = null;
      let eMonth = 1;

      if (typeof start === 'object' && start?.year) {
        sYear = start.year; sMonth = start.month || 1;
      } else if (typeof start === 'string') {
        const p = parseInt(start.substring(0, 4), 10);
        if (!isNaN(p) && p > 1970) { sYear = p; const m = parseInt(start.substring(5, 7), 10); if (!isNaN(m)) sMonth = m; }
      }

      if (typeof end === 'object' && end?.year) {
        eYear = end.year; eMonth = end.month || 1;
      } else if (typeof end === 'string') {
        const p = parseInt(end.substring(0, 4), 10);
        if (!isNaN(p) && p > 1970) { eYear = p; const m = parseInt(end.substring(5, 7), 10); if (!isNaN(m)) eMonth = m; }
      }

      if (sYear && eYear) {
        const months = Math.max(1, (eYear - sYear) * 12 + (eMonth - sMonth));
        totalMonths += months;
        count++;
      }
    }
    if (count >= 2) {
      avgTenureMonths = Math.round(totalMonths / count);
    }
  }

  const isJobHopper = avgTenureMonths !== null && avgTenureMonths < 24;
  signals.push({
    key: 'job_hopping',
    label: 'Mobilité fréquente',
    emoji: '📊',
    weight: 20,
    active: isJobHopper,
    detail: avgTenureMonths !== null
      ? `Tenure moyenne: ${avgTenureMonths} mois${isJobHopper ? ' (< 2 ans)' : ''}`
      : 'Données insuffisantes',
  });

  // Compute total
  const score = signals.reduce((sum, s) => sum + (s.active ? s.weight : 0), 0);

  const level: LikelyToSwitchResult['level'] =
    score >= 50 ? 'high' :
    score >= 25 ? 'medium' :
    score > 0 ? 'low' :
    'unknown';

  const activeSignals = signals.filter(s => s.active);
  const summary = activeSignals.length === 0
    ? 'Aucun signal de disponibilité détecté'
    : activeSignals.map(s => s.label).join(', ');

  return { score, level, signals, summary };
}
