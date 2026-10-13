/**
 * Projets Recruiter du compte : lecture de la réponse de `list_recruiter_projects`
 * (unipile-search) et options du sélecteur.
 *
 * Le projet choisi sert de périmètre à la recherche : son identifiant est écrit dans
 * `filters.hiring_project`, que `useLinkedInSearchActions` envoie déjà à l'action
 * `search` (le serveur le range sous le filtre « projet » de Recruiter).
 *
 * Module pur, testé par tests/ux/recherche-lien-projet.test.mjs.
 */

import { safeServerMessage } from '@/lib/connectionCopy';
import { RECRUITER_PROJECT_COPY, unknownProjectLabel } from './searchControlsCopy';

type Dict = Record<string, unknown>;

export interface RecruiterProject {
  id: string;
  name: string;
  archived: boolean;
}

/** Page de la liste, avec le curseur de la page suivante (`null` à la dernière). */
export interface RecruiterProjectsPage {
  projects: RecruiterProject[];
  cursor: string | null;
}

/** Erreur de chargement : `retryable` faux quand le compte n'a pas droit aux projets (licence). */
export class RecruiterProjectsError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'RecruiterProjectsError';
  }
}

/** Identifiant d'un projet : chiffres seulement, comme l'exige le serveur. */
export const PROJECT_ID_RE = /^\d{1,20}$/;

const isDict = (value: unknown): value is Dict => !!value && typeof value === 'object' && !Array.isArray(value);

/** Réponse de `list_recruiter_projects` → page lue ; lève `RecruiterProjectsError` sinon. */
export function parseRecruiterProjectsResponse(data: unknown): RecruiterProjectsPage {
  if (!isDict(data) || data.success !== true || !Array.isArray(data.projects)) {
    const licence = isDict(data) && data.errorType === 'LICENCE_UNAVAILABLE';
    const message = licence ? safeServerMessage(isDict(data) ? data.error : null) : null;
    throw new RecruiterProjectsError(message ?? RECRUITER_PROJECT_COPY.error, !licence);
  }
  const projects: RecruiterProject[] = [];
  for (const raw of data.projects) {
    if (!isDict(raw)) continue;
    const id = typeof raw.id === 'number' ? String(raw.id) : typeof raw.id === 'string' ? raw.id.trim() : '';
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (PROJECT_ID_RE.test(id) && name) projects.push({ id, name, archived: raw.archived === true });
  }
  return { projects, cursor: typeof data.cursor === 'string' && data.cursor !== '' ? data.cursor : null };
}

export interface ProjectOption {
  id: string;
  label: string;
}

/**
 * Options du sélecteur : projets en cours d'abord, archivés ensuite (chacun dans l'ordre
 * du serveur). Un projet déjà choisi mais absent de la liste garde une ligne, sans nom.
 */
export function projectOptions(projects: readonly RecruiterProject[], selectedId: string): ProjectOption[] {
  const seen = new Set<string>();
  const unique = projects.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  const options: ProjectOption[] = [
    ...unique.filter((p) => !p.archived).map((p) => ({ id: p.id, label: p.name })),
    ...unique.filter((p) => p.archived).map((p) => ({ id: p.id, label: `${p.name}${RECRUITER_PROJECT_COPY.archivedSuffix}` })),
  ];
  if (selectedId && !seen.has(selectedId)) options.push({ id: selectedId, label: unknownProjectLabel(selectedId) });
  return options;
}

/**
 * Le projet choisi (`filters.hiring_project`) est-il à retirer ? Oui hors de la source Recruiter (la recherche
 * le laisserait partir sans qu'aucun contrôle ne le montre), et quand le compte change entre deux comptes
 * connus (un projet appartient au contrat d'un compte). Un compte encore inconnu au chargement ne retire rien.
 */
export function shouldClearHiringProject(args: {
  projectId: string;
  api: string;
  previousAccount: string | null;
  account: string | null;
}): boolean {
  if (!args.projectId) return false;
  if (args.api !== 'recruiter') return true;
  return !!args.previousAccount && !!args.account && args.previousAccount !== args.account;
}
