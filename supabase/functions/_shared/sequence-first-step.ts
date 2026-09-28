// Première exécution d'une inscription créée côté serveur (outil
// enroll_in_sequence de l'assistant), sans accès base.
//
// Audit séquences 2026-09-25, SEQ-044. Avant, l'assistant insérait
// l'inscription sans aucune exécution : rien ne partait avant le rattrapage
// horaire du moteur, et sur une séquence numérotée à partir de 1 (créée par
// l'assistant) le rattrapage cherchait l'étape 0, n'en trouvait pas et
// clôturait l'inscription sans rien envoyer.
//
//   deno test --no-check supabase/functions/_shared/sequence-first-step.test.ts

export interface SequenceStepLike {
  id: string;
  step_order: number | null;
  parent_step_id?: string | null;
  branch?: string | null;
  if_true_goto_step?: string | null;
  if_false_goto_step?: string | null;
  timeout_branch_step_id?: string | null;
  next_step_id?: string | null;
}

/**
 * Étape racine de plus petit step_order : ni fille (parent_step_id, branch),
 * ni cible d'un branchement (if_true, if_false, timeout, next). Choisie par
 * ordre et non par step_order = 0 : les séquences numérotées à partir de 1
 * restent couvertes. Si toutes les étapes sont des cibles (boucle), la plus
 * petite est prise.
 */
export function pickFirstRootStep<T extends SequenceStepLike>(steps: readonly T[]): T | null {
  if (steps.length === 0) return null;
  const targets = new Set<string>();
  for (const step of steps) {
    for (const target of [step.if_true_goto_step, step.if_false_goto_step, step.timeout_branch_step_id, step.next_step_id]) {
      if (target && target !== step.id) targets.add(target);
    }
  }
  const byOrder = [...steps].sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0));
  const root = byOrder.find((step) => !step.parent_step_id && !step.branch && !targets.has(step.id));
  return root ?? byOrder[0];
}

/** Fuseau IANA valide, sinon Europe/Paris. */
export function validTimeZone(tz: string | null | undefined): string {
  if (!tz) return 'Europe/Paris';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'Europe/Paris';
  }
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
}

function localParts(ms: number, tz: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    weekday: get('weekday'),
  };
}

/** Instant UTC de « jour J à hh:mm » dans le fuseau (jour hors mois accepté : 32 → mois suivant). */
function zonedTime(year: number, month: number, day: number, hour: number, minute: number, tz: string): number {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = wallAsUtc;
  // Deux passes : le décalage du fuseau à l'instant visé (changement d'heure).
  for (let i = 0; i < 2; i += 1) {
    const p = localParts(guess, tz);
    const shownAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
    guess += wallAsUtc - shownAsUtc;
  }
  return guess;
}

/**
 * Date de la première exécution : maintenant + délai de l'étape, ramenée dans
 * la plage horaire préférée de l'étape (jours ouvrés, fuseau de l'inscription),
 * comme le fait l'interface à l'inscription. Le moteur applique ensuite les
 * heures ouvrées et les plafonds de l'expéditeur au moment de l'envoi.
 */
export function firstExecutionTime(
  now: Date,
  delay: { days?: number | null; hours?: number | null; minutes?: number | null },
  window: { start?: number | null; end?: number | null },
  timeZone: string | null | undefined,
): Date {
  const tz = validTimeZone(timeZone);
  let start = Number.isInteger(window.start) ? Number(window.start) : 9;
  let end = Number.isInteger(window.end) ? Number(window.end) : 18;
  if (start < 0 || start > 23 || end < 1 || end > 24 || start >= end) {
    start = 9;
    end = 18;
  }
  const delayMs = (Math.max(0, delay.days ?? 0) * 86_400_000)
    + (Math.max(0, delay.hours ?? 0) * 3_600_000)
    + (Math.max(0, delay.minutes ?? 0) * 60_000);
  let t = now.getTime() + delayMs;
  for (let i = 0; i < 10; i += 1) {
    const p = localParts(t, tz);
    if (p.weekday === 'Sat' || p.weekday === 'Sun') {
      t = zonedTime(p.year, p.month, p.day + 1, start, 0, tz);
      continue;
    }
    if (p.hour < start) return new Date(zonedTime(p.year, p.month, p.day, start, 0, tz));
    if (p.hour >= end) {
      t = zonedTime(p.year, p.month, p.day + 1, start, 0, tz);
      continue;
    }
    return new Date(t);
  }
  return new Date(t);
}
