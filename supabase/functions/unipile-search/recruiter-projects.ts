/**
 * Action `list_recruiter_projects` de unipile-search : les projets de recrutement du contrat Recruiter
 * actif du compte, pour le sélecteur de projet de la recherche.
 *
 * Un projet sert de périmètre à une recherche : `recruiter_project_id` de l'action `search` ne garde que
 * les personnes déjà dans ce projet (voir `search-request.ts`). Réservé aux comptes qui ont le produit
 * Recruiter ET dont le contrat actif est Recruiter (les projets sont ceux du contrat sélectionné) ;
 * sinon un texte français neutre explique quoi faire, sans appeler la liste.
 *
 * Pagination : la liste du prestataire avance par décalage (`offset`), pas par curseur. Le curseur rendu
 * est donc `offset:<n>`, le même que celui de Sales Navigator dans l'action `search`.
 */

import {
  encodeOffsetCursor,
  listRecruiterProjects,
  UnipileError,
  type HiringProject,
} from '../_shared/unipile/index.ts';
import { licenceProblem, type Licences } from './licence.ts';
import { failureResponse, json } from './responses.ts';

export const PROJECTS_DEFAULT_LIMIT = 50;
export const PROJECTS_MAX_LIMIT = 100;
const MAX_NAME_FILTER = 200;
/** Projets listés : en cours et clos (clos = `archived` pour le sélecteur). */
const PROJECT_STATUSES = ['ACTIVE', 'CLOSED'] as const;

/** Projet tel que le lit le sélecteur. */
export interface RecruiterProjectOption {
  id: string;
  name: string;
  archived: boolean;
  /** Visible par l'équipe LinkedIn du contrat. */
  shared: boolean;
  owner_name: string | null;
  created_at: string | null;
  last_modified_at: string | null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Projet du prestataire vers l'option du sélecteur ; `null` quand il n'a ni identifiant ni nom lisibles. */
export function toProjectOption(raw: HiringProject | unknown): RecruiterProjectOption | null {
  if (!raw || typeof raw !== 'object') return null;
  const project = raw as Record<string, unknown>;
  const id = typeof project.id === 'number' ? String(project.id) : text(project.id);
  const name = text(project.name);
  if (!id || !name) return null;
  const owner = project.owner && typeof project.owner === 'object' ? (project.owner as Record<string, unknown>) : null;
  return {
    id,
    name,
    archived: project.archived === true,
    shared: project.visibility === 'SHARED',
    owner_name: text(owner?.name),
    created_at: text(project.created_at),
    last_modified_at: text(project.last_modified_at),
  };
}

/** Texte français quand les projets Recruiter ne sont pas disponibles pour ce compte, `null` sinon. */
export function recruiterProjectsProblem(licences: Licences): string | null {
  if (!licences.recruiter) {
    return 'Ce compte LinkedIn n’a pas de licence Recruiter : les projets Recruiter ne sont pas disponibles.';
  }
  if (licences.selectedKnown && licences.active !== 'recruiter') {
    return 'Le contrat LinkedIn actif sur ce compte est Sales Navigator. Activez le contrat Recruiter pour voir vos projets.';
  }
  return null;
}

/** Décalage d'un curseur `offset:<n>` ; `0` sans curseur ; `null` pour un curseur illisible. */
export function offsetOfCursor(cursor: unknown): number | null {
  if (cursor === undefined || cursor === null || cursor === '') return 0;
  const match = typeof cursor === 'string' ? /^offset:(\d{1,9})$/.exec(cursor) : null;
  return match ? Number(match[1]) : null;
}

export function clampLimit(value: unknown, fallback = PROJECTS_DEFAULT_LIMIT): number {
  const n = typeof value === 'number' ? Math.floor(value) : Number.NaN;
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), PROJECTS_MAX_LIMIT) : fallback;
}

// ---------------------------------------------------------------------------
// Nom d'un projet pour le filtre de recherche
// ---------------------------------------------------------------------------

const TITLE_TTL_MS = 5 * 60_000;
const TITLE_MAX_PAGES = 5;
const TITLE_CACHE_MAX = 200;
const titleCache = new Map<string, { at: number; titles: Map<string, string> }>();

/** Vide le cache des noms de projet (tests). */
export function clearProjectTitleCache(): void {
  titleCache.clear();
}

type ProjectLister = typeof listRecruiterProjects;

/** Noms des projets du contrat actif (5 pages de 100 au plus), gardés 5 minutes par compte. */
async function projectTitles(accountId: string, now: () => number, list: ProjectLister): Promise<Map<string, string>> {
  const hit = titleCache.get(accountId);
  if (hit && now() - hit.at < TITLE_TTL_MS) return hit.titles;
  const titles = new Map<string, string>();
  let offset = 0;
  for (let n = 0; n < TITLE_MAX_PAGES; n++) {
    const page = await list(accountId, { offset, limit: PROJECTS_MAX_LIMIT, status: [...PROJECT_STATUSES], sortBy: 'ALPHABETICAL' });
    for (const item of page.items) {
      const option = toProjectOption(item);
      if (option) titles.set(option.id, option.name);
    }
    offset += page.items.length;
    if (page.items.length === 0 || (page.totalCount !== null ? offset >= page.totalCount : page.items.length < PROJECTS_MAX_LIMIT)) break;
  }
  if (titleCache.size >= TITLE_CACHE_MAX) titleCache.clear();
  titleCache.set(accountId, { at: now(), titles });
  return titles;
}

/**
 * Le filtre `project` de la recherche Recruiter demande l'identifiant ET le nom du projet ; le compilateur n'a
 * que l'identifiant et le met aussi en `title`. Le nom lu dans la liste des projets du compte le remplace.
 * Au mieux : sans nom trouvé ou liste illisible, le corps reste tel quel (le prestataire se règle sur l'identifiant).
 */
export async function applyProjectTitle(
  accountId: string,
  body: Record<string, unknown>,
  now: () => number = Date.now,
  list: ProjectLister = listRecruiterProjects,
): Promise<void> {
  const project = body.project;
  const include = project && typeof project === 'object' ? (project as { include?: unknown }).include : undefined;
  if (!Array.isArray(include)) return;
  const pending = include.filter((entry): entry is { id: string; title: string } =>
    !!entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string'
    && (entry as { title?: unknown }).title === (entry as { id: string }).id);
  if (pending.length === 0) return;
  try {
    const titles = await projectTitles(accountId, now, list);
    for (const entry of pending) {
      const title = titles.get(entry.id);
      if (title) entry.title = title;
    }
  } catch {
    console.warn('[unipile-search] search: nom du projet Recruiter non lu');
  }
}

export async function handleListRecruiterProjects(accountId: string, params: Record<string, unknown>): Promise<Response> {
  const offset = offsetOfCursor(params.cursor);
  if (offset === null) {
    return json({ success: false, error: 'La page demandée n’est plus valide. Relancez la liste.', errorType: 'INVALID_CURSOR' }, 400);
  }
  const limit = clampLimit(params.limit);
  const keywords = text(params.keywords)?.slice(0, MAX_NAME_FILTER);

  try {
    const problem = await licenceProblem(accountId, recruiterProjectsProblem);
    if (problem) return json({ success: false, error: problem, errorType: 'LICENCE_UNAVAILABLE' }, 400);
  } catch (error) {
    // Comme `search` : une vérification impossible pour une raison passagère n'empêche pas la liste.
    if (error instanceof UnipileError && ['account_disconnected', 'account_degraded', 'auth', 'config'].includes(error.kind)) {
      return failureResponse(error, 'list_recruiter_projects');
    }
    console.warn('[unipile-search] list_recruiter_projects: licence du compte non vérifiée');
  }

  try {
    // Le prestataire ne rend que les projets actifs par défaut : les projets clos sont demandés, dans un ordre stable.
    const page = await listRecruiterProjects(accountId, {
      offset,
      limit,
      status: [...PROJECT_STATUSES],
      sortBy: 'ALPHABETICAL',
      ...(keywords ? { keywords } : {}),
    });
    const projects = page.items.map(toProjectOption).filter((p): p is RecruiterProjectOption => p !== null);
    const next = offset + page.items.length;
    const more = page.items.length > 0
      && (page.totalCount !== null ? next < page.totalCount : page.nextCursor !== null || page.items.length >= limit);
    return json({ success: true, projects, cursor: more ? encodeOffsetCursor(next) : null, total: page.totalCount });
  } catch (error) {
    return failureResponse(error, 'list_recruiter_projects', {}, { projects: [] });
  }
}
