// Refonte mission, lot 2 : ordre figé de la liste de Pipeline pendant la
// session (conception 4.2, U-M3), et étapes connues après un geste.
//
// Module sans React ni Supabase. L'ordre des lignes affichées est mémorisé par
// `${projectId}|${stageFilterKey}` dans une Map du module : il vit le temps de
// l'onglet et se perd au rechargement.
// - Une relecture met à jour le contenu des lignes sans les déplacer.
// - Une ligne qui ne correspond plus au filtre (déplacée par un geste) reste à
//   sa place avec sa nouvelle étape, atténuée.
// - Les nouvelles lignes vont en fin.
// - Quand l'ordre de la base diffère de l'ordre figé, l'écran propose
//   « Actualiser l'ordre » (resetFrozenOrder).
//
// Étapes connues après un geste (rememberStageMoves) : l'écriture a réussi,
// la relecture n'est pas encore là. Une étape connue s'applique à une ligne
// lue AVANT le geste (at > dataUpdatedAt de la lecture), et à une ligne figée
// que la relecture ne rend plus (sortie du filtre ou de la page chargée).

import type { GeneralStage, StageBatchOutcome } from '@/lib/candidateStage';
import type { MissionCandidateRow, MissionRowRef } from '../types';

// ------------------------------------------------------ étapes connues

export interface KnownStage {
  stage: GeneralStage;
  processStepId: string | null;
  stageEnteredAt: string | null;
  /** Heure locale de la réponse de la base (Date.now()). */
  at: number;
}

export type KnownStages = Map<string, KnownStage>;

const knownStages: KnownStages = new Map();
const listeners = new Set<() => void>();
let version = 0;

/** Version du magasin des étapes connues (useSyncExternalStore). */
export function getKnownStagesVersion(): number {
  return version;
}

export function subscribeKnownStages(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Étapes connues du module (lecture seule pour les écrans). */
export function knownStagesStore(): ReadonlyMap<string, KnownStage> {
  return knownStages;
}

/**
 * Retient l'étape des lignes changées par un geste, par ligne canonique
 * (row.id) : le résultat de la ligne elle-même s'il a changé, sinon celui
 * d'une autre ligne changée de son groupe.
 */
export function rememberStageMoves(
  rows: readonly MissionRowRef[],
  outcome: Pick<StageBatchOutcome, 'rows'>,
  at: number = Date.now(),
  store: KnownStages = knownStages,
): number {
  const byId = new Map(outcome.rows.map((r) => [r.id, r]));
  let remembered = 0;
  for (const row of rows) {
    const ids = row.groupIds.length > 0 ? row.groupIds : [row.id];
    const own = byId.get(row.id);
    const changed =
      own && own.result === 'updated' ? own : ids.map((id) => byId.get(id)).find((r) => r && r.result === 'updated');
    if (!changed || !changed.generalStage) continue;
    store.set(row.id, {
      stage: changed.generalStage,
      processStepId: changed.generalStage === 'interviewing' ? changed.processStepId : null,
      stageEnteredAt: changed.stageEnteredAt,
      at,
    });
    remembered += 1;
  }
  if (remembered > 0 && store === knownStages) {
    version += 1;
    for (const listener of listeners) listener();
  }
  return remembered;
}

/** Ligne avec l'étape connue appliquée. */
export function withKnownStage<T extends MissionCandidateRow>(row: T, known: KnownStage | undefined): T {
  if (!known) return row;
  return { ...row, stage: known.stage, processStepId: known.processStepId, stageEnteredAt: known.stageEnteredAt ?? row.stageEnteredAt };
}

/**
 * Lignes lues à `dataUpdatedAt`, avec les étapes connues plus récentes que la
 * lecture (un geste confirmé après elle).
 */
export function applyKnownStages<T extends MissionCandidateRow>(
  rows: readonly T[],
  dataUpdatedAt: number,
  store: ReadonlyMap<string, KnownStage> = knownStages,
): T[] {
  if (store.size === 0) return [...rows];
  return rows.map((row) => {
    const known = store.get(row.id);
    return known && known.at > dataUpdatedAt ? withKnownStage(row, known) : row;
  });
}

// ------------------------------------------------------------ ordre figé

interface FrozenEntry<T> {
  ids: string[];
  rows: Map<string, T>;
}

export type FrozenOrderStore = Map<string, FrozenEntry<MissionCandidateRow>>;

const frozenStore: FrozenOrderStore = new Map();

export function frozenOrderKey(projectId: string, filterKey: string): string {
  return `${projectId}|${filterKey}`;
}

export interface ArrangedRows<T> {
  /** Lignes dans l'ordre figé. */
  rows: T[];
  /** Lignes gardées à leur place mais sorties du filtre (à atténuer). */
  outOfFilter: ReadonlySet<string>;
  /** L'ordre de la base diffère de l'ordre affiché : proposer « Actualiser l'ordre ». */
  orderDiffers: boolean;
}

/**
 * Range `fetched` (ordre de la base, étapes connues déjà appliquées) selon
 * l'ordre figé de `key`, puis mémorise l'ordre affiché. `matches` dit si une
 * ligne entre dans le filtre de la liste.
 */
export function arrangeFrozen<T extends MissionCandidateRow>(
  key: string,
  fetched: readonly T[],
  matches: (row: T) => boolean,
  store: FrozenOrderStore = frozenStore,
  known: ReadonlyMap<string, KnownStage> = knownStages,
): ArrangedRows<T> {
  const fetchedById = new Map<string, T>();
  for (const row of fetched) if (!fetchedById.has(row.id)) fetchedById.set(row.id, row);
  const previous = store.get(key) as FrozenEntry<T> | undefined;

  const out: T[] = [];
  const outOfFilter = new Set<string>();
  const placed = new Set<string>();

  if (previous) {
    for (const id of previous.ids) {
      const current = fetchedById.get(id);
      if (current) {
        out.push(current);
        placed.add(id);
        if (!matches(current)) outOfFilter.add(id);
        continue;
      }
      // Absente de la relecture : gardée seulement si un geste l'a déplacée.
      const old = previous.rows.get(id);
      const move = known.get(id);
      if (!old || !move) continue;
      const moved = withKnownStage(old, move);
      out.push(moved);
      placed.add(id);
      if (!matches(moved)) outOfFilter.add(id);
    }
  }
  for (const row of fetchedById.values()) {
    if (placed.has(row.id)) continue;
    out.push(row);
    placed.add(row.id);
    if (!matches(row)) outOfFilter.add(row.id);
  }

  store.set(key, { ids: out.map((r) => r.id), rows: new Map(out.map((r) => [r.id, r])) as Map<string, MissionCandidateRow> });

  const dbOrder = [...fetchedById.keys()];
  const shownFetched = out.filter((r) => fetchedById.has(r.id)).map((r) => r.id);
  const orderDiffers =
    out.length !== shownFetched.length || shownFetched.some((id, index) => id !== dbOrder[index]);

  return { rows: out, outOfFilter, orderDiffers };
}

/** « Actualiser l'ordre » : oublie l'ordre figé de `key` (reprend l'ordre de la base). */
export function resetFrozenOrder(key: string, store: FrozenOrderStore = frozenStore): void {
  store.delete(key);
}

/** Tests seulement. */
export function resetFrozenOrderForTests(): void {
  frozenStore.clear();
  knownStages.clear();
  version = 0;
}
