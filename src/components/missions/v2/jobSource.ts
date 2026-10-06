/**
 * Lecture d'offres depuis une adresse web, pour le Brief IA (fonction
 * fetch-job-source) : appels, texte de brief, analyse et création en lot.
 *
 * Sans React : l'exécuteur de lot et la création reçoivent leurs dépendances, ce
 * qui permet de les tester seuls (tests/ux/import-offres.test.mjs).
 */

import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import type { CreateProjectInput } from '@/hooks/useSourcingProjects';
import { buildJobDetails, type BriefAnalysis } from './briefAnalysis';

/** Offres analysées et créées d'un coup : au-delà, des crédits partis et des missions en trop par erreur. */
export const MAX_BATCH_OFFERS = 10;
/** Analyses menées en parallèle : trois suffisent à tenir dans la limite de 30 lectures par minute. */
const BULK_CONCURRENCY = 3;

export interface SourceJob {
  id: string;
  title: string;
  company?: string;
  location?: string;
  contract?: string;
  posted_at?: string;
  url: string;
  /** Texte brut de la fiche, absent des listes. */
  description?: string;
}

export type ResolveData =
  | { kind: 'job'; job: SourceJob; reader: string }
  | { kind: 'company'; company: { name: string; url: string }; jobs: SourceJob[]; reader: string; truncated: boolean }
  | { kind: 'unreadable'; message: string };

// Discriminant texte : le projet n'est pas en mode strict, où un booléen ne distingue pas les cas d'une union.
export type Outcome<T> = { status: 'ok'; data: T } | { status: 'error'; message: string };

const GENERIC_FAILURE = "La page n'a pas pu être lue. Collez le texte de la fiche.";

async function callSource<T>(action: 'resolve' | 'read_job', url: string): Promise<Outcome<T>> {
  try {
    const { data, error } = await invokeEdgeFunction<Record<string, unknown>>('fetch-job-source', { action, url });
    if (error) {
      // Le serveur écrit ses refus en français (adresse invalide, trop de lectures) : on les montre tels quels.
      const status = error.status;
      return { status: 'error', message: status === 400 || status === 429 ? error.message : GENERIC_FAILURE };
    }
    if (!data?.success) return { status: 'error', message: GENERIC_FAILURE };
    return { status: 'ok', data: data as unknown as T };
  } catch {
    return { status: 'error', message: GENERIC_FAILURE };
  }
}

export function resolveJobSource(url: string): Promise<Outcome<ResolveData>> {
  return callSource<ResolveData>('resolve', url);
}

export async function readJobSource(url: string): Promise<Outcome<SourceJob>> {
  const result = await callSource<ResolveData>('read_job', url);
  if (result.status === 'error') return result;
  if (result.data.kind === 'job' && result.data.job.description) return { status: 'ok', data: result.data.job };
  return { status: 'error', message: result.data.kind === 'unreadable' ? result.data.message : GENERIC_FAILURE };
}

/** Texte placé dans la zone « Fiche de poste » : l'intitulé en première ligne, puis société, lieu et contrat, puis la fiche. */
export function buildBriefText(job: SourceJob): string {
  const meta = [job.company, job.location, job.contract].filter(Boolean).join(' · ');
  return [job.title, meta, '', job.description ?? ''].join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Nom de la mission créée depuis une offre : l'intitulé, et le lieu s'il distingue deux offres identiques. */
export function missionNameOf(job: SourceJob): string {
  return job.location ? `${job.title}, ${job.location}` : job.title;
}

// ─── Analyse en lot ───────────────────────────────────────────────────────

export type BulkStatus = 'pending' | 'reading' | 'analyzing' | 'done' | 'error' | 'skipped';

export interface BulkItem {
  job: SourceJob;
  status: BulkStatus;
  /** Fiche lue, prête à devenir le brief de la mission. */
  text?: string;
  analysis?: BriefAnalysis;
  error?: string;
}

export interface BulkDeps {
  read(job: SourceJob): Promise<{ text: string } | { error: string }>;
  analyze(text: string, job: SourceJob): Promise<{ analysis: BriefAnalysis } | { error: 'credits' | 'failed' }>;
}

export const BULK_MESSAGES = {
  credits: 'Crédits IA épuisés',
  failed: "L'analyse n'a pas abouti",
  unreadable: 'Fiche illisible',
  skipped: 'Non analysée',
} as const;

/**
 * Lit puis analyse chaque offre, trois à la fois. Une offre en échec n'arrête pas
 * les autres ; des crédits épuisés arrêtent les suivantes (marquées « non analysée »,
 * ce qui laisse créer celles qui sont prêtes). Annulation : isCancelled.
 */
export async function runBulkAnalysis(
  jobs: SourceJob[],
  deps: BulkDeps,
  onUpdate: (index: number, patch: Partial<BulkItem>) => void,
  options: { concurrency?: number; isCancelled?: () => boolean } = {},
): Promise<void> {
  let next = 0;
  let creditsExhausted = false;

  const runOne = async (index: number): Promise<void> => {
    const job = jobs[index];
    if (options.isCancelled?.() || creditsExhausted) {
      onUpdate(index, { status: 'skipped', error: BULK_MESSAGES.skipped });
      return;
    }
    onUpdate(index, { status: 'reading' });
    const read = await deps.read(job);
    if ('error' in read) {
      onUpdate(index, { status: 'error', error: read.error });
      return;
    }
    if (options.isCancelled?.() || creditsExhausted) {
      onUpdate(index, { status: 'skipped', error: BULK_MESSAGES.skipped });
      return;
    }
    onUpdate(index, { status: 'analyzing', text: read.text });
    const analysed = await deps.analyze(read.text, job);
    if ('error' in analysed) {
      if (analysed.error === 'credits') creditsExhausted = true;
      onUpdate(index, { status: 'error', error: BULK_MESSAGES[analysed.error] });
      return;
    }
    onUpdate(index, { status: 'done', analysis: analysed.analysis });
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= jobs.length) return;
      try {
        await runOne(index);
      } catch {
        onUpdate(index, { status: 'error', error: BULK_MESSAGES.failed });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? BULK_CONCURRENCY, jobs.length) }, worker));
}

// ─── Création en lot ──────────────────────────────────────────────────────

/** Mission à créer pour une offre analysée : mêmes données que le Brief IA d'une seule fiche, plus l'adresse source. */
export function missionInputFor(item: BulkItem, company: string): CreateProjectInput {
  const text = item.text ?? '';
  const name = missionNameOf(item.job);
  const clientName = item.job.company || company;
  const input: CreateProjectInput = {
    name,
    description: text,
    client_name: clientName || undefined,
    // Une confirmation par mission serait 10 messages d'affilée : le lot annonce un seul résultat.
    silent: true,
  };
  if (item.analysis) {
    input.filters_snapshot = {
      ...item.analysis.filters,
      generated_at: new Date().toISOString(),
      brief_text: text,
    };
    input.job_details = buildJobDetails(item.analysis.analysis, {
      briefName: name,
      briefText: text,
      clientName,
      sourceUrl: item.job.url,
    });
  }
  return input;
}

/** Crée, une par une, les missions des offres prêtes. Une création en échec n'empêche pas les autres. */
export async function createMissionsFromItems(
  items: BulkItem[],
  company: string,
  create: (input: CreateProjectInput) => Promise<{ id?: string } | undefined>,
): Promise<{ created: number; failed: number; firstId?: string }> {
  let created = 0;
  let failed = 0;
  let firstId: string | undefined;
  for (const item of items.filter((i) => i.status === 'done')) {
    try {
      const project = await create(missionInputFor(item, company));
      created += 1;
      firstId = firstId ?? project?.id;
    } catch {
      failed += 1;
    }
  }
  return { created, failed, firstId };
}
