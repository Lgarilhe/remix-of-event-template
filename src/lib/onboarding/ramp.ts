/**
 * Montée en charge d'un compte LinkedIn récemment relié, telle que la lit le
 * serveur (supabase/functions/_shared/linkedin-quotas.ts et la migration
 * 20260906193347) : plafond de base de 80 actions visibles par jour (invitations,
 * messages et InMails ensemble), multiplié par 0,25 la première semaine, 0,5 la
 * deuxième, 0,75 la troisième, puis 1. Du lundi au vendredi, de 8 h à 19 h
 * (heure de Paris). tests/ux vérifie que ces constantes suivent celles du serveur.
 */
export const WARMUP_BASE_DAILY_ACTIONS = 80;
export const WARMUP_FACTORS = [0.25, 0.5, 0.75, 1] as const;

export interface WarmupWeek {
  /** 1 à 4 ; la quatrième vaut « à partir de la semaine 4 ». */
  week: number;
  label: string;
  dailyActions: number;
}

export const WARMUP_WEEKS: WarmupWeek[] = WARMUP_FACTORS.map((factor, i) => ({
  week: i + 1,
  label: i === WARMUP_FACTORS.length - 1 ? 'Semaine 4 et après' : `Semaine ${i + 1}`,
  dailyActions: Math.ceil(WARMUP_BASE_DAILY_ACTIONS * factor),
}));
