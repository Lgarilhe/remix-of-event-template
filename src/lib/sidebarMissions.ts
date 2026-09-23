/**
 * Onglet Missions de la barre latérale (§3, D18 à D22). Module pur, sans import.
 *
 * - fusion « Mes missions » (D20, D21) et épingles (D22) ;
 * - règle de verrou des vues, identique à la page mission (§3.2) ;
 * - cible de réouverture d'une mission (D19) ;
 * - relevé local des visites et point « nouveaux profils » (D18, §3.6).
 */

// ── États ─────────────────────────────────────────────────────────

/** Mêmes valeurs que SectionState (src/lib/sidebarSection.ts), redéclarées faute d'import. */
export type MissionSectionState = 'loading' | 'offline' | 'error' | 'ok';

/** Une source de données, telle que React Query la décrit. */
export interface SourceInput<T> {
  data: T | undefined;
  isError: boolean;
  /** Requête en pause faute de réseau. */
  paused: boolean;
}

interface StateWithStale {
  state: MissionSectionState;
  stale: boolean;
}

function sourceState<T>(s: SourceInput<T>): StateWithStale {
  if (s.data !== undefined) return { state: 'ok', stale: s.isError && !s.paused };
  if (s.paused) return { state: 'offline', stale: false };
  if (s.isError) return { state: 'error', stale: false };
  return { state: 'loading', stale: false };
}

/** Erreur d'abord (avec « Réessayer »), puis hors ligne, puis chargement ; sinon ok. */
function combineStates(states: readonly StateWithStale[]): StateWithStale {
  const stale = states.some((s) => s.stale);
  if (states.some((s) => s.state === 'error')) return { state: 'error', stale: false };
  if (states.some((s) => s.state === 'offline')) return { state: 'offline', stale: false };
  if (states.some((s) => s.state === 'loading')) return { state: 'loading', stale: false };
  return { state: 'ok', stale };
}

// ── Lignes ────────────────────────────────────────────────────────

/** Colonnes d'une mission lues par la barre (liste de l'organisation ou jointure d'équipe). */
export interface MissionRow {
  id: string;
  name: string;
  client_name: string | null;
  organization_id: string | null;
  kind: string;
  status: string;
  job_title: string | null;
  created_by: string | null;
  updated_at: string;
  stats_total_found: number | null;
  stats_messaged: number | null;
}

export interface TeamRow {
  project_id: string;
  /** null : mission invisible (RLS), ligne ignorée. */
  sourcing_projects: MissionRow | null;
}

export interface PartnerRow {
  id: string;
  organization_name: string | null;
}

export interface PinRow {
  job_id: string;
}

/** Une mission telle que la barre l'affiche. */
export interface MissionNavItem {
  id: string;
  name: string;
  client_name: string | null;
  organization_id: string | null;
  status: string;
  job_title: string | null;
  updated_at: string;
  stats_total_found: number;
  stats_messaged: number;
  /** Mission confiée par une autre organisation : nom de celle-ci. */
  partner_org_name: string | null;
  isPartner: boolean;
  /** Sous-titre : client, et pour une mission partenaire « Confiée par … ». */
  sub: string | null;
}

/** Statuts affichés dans « Mes missions » (D20) ; `completed` et `archived` restent sur /missions. */
export const MY_MISSIONS_STATUSES: readonly string[] = ['active', 'paused'];
/** Nombre de lignes de « Mes missions ». */
export const MY_MISSIONS_LIMIT = 15;

export function missionSubtitle(clientName: string | null, partnerOrgName: string | null): string | null {
  if (partnerOrgName) {
    return clientName ? `${clientName} · Confiée par ${partnerOrgName}` : `Confiée par ${partnerOrgName}`;
  }
  return clientName || null;
}

/** Initiale de la pastille : client, sinon nom de la mission. */
export function missionInitial(item: { name: string; client_name: string | null }): string {
  const source = (item.client_name || item.name || '').trim();
  return source ? source.charAt(0).toUpperCase() : '?';
}

export function toMissionNavItem(
  row: Pick<MissionRow, 'id' | 'name' | 'client_name' | 'organization_id' | 'status' | 'job_title' | 'updated_at' | 'stats_total_found' | 'stats_messaged'>,
  partnerOrgName: string | null = null,
  isPartner = false,
): MissionNavItem {
  return {
    id: row.id,
    name: row.name,
    client_name: row.client_name,
    organization_id: row.organization_id,
    status: row.status,
    job_title: row.job_title,
    updated_at: row.updated_at,
    stats_total_found: row.stats_total_found ?? 0,
    stats_messaged: row.stats_messaged ?? 0,
    partner_org_name: isPartner ? partnerOrgName : null,
    isPartner,
    sub: missionSubtitle(row.client_name, isPartner ? partnerOrgName : null),
  };
}

/** Vrai si la jointure d'équipe contient une mission d'une autre organisation (noms partenaires nécessaires, D21). */
export function needsPartnerNames(team: readonly TeamRow[] | undefined, organizationId: string | null): boolean {
  if (!team || !organizationId) return false;
  return team.some((t) => t.sourcing_projects != null && t.sourcing_projects.organization_id !== organizationId);
}

// ── Épingles (D22) ───────────────────────────────────────────────

export const PIN_LIMIT = 10;
/** Message du plafond d'épingles (infobulle et clic, aucun appel). */
export const PIN_LIMIT_MESSAGE = '10 épingles au plus. Retirez-en une pour épingler cette mission.';

/**
 * Épingles résolues vers une mission visible, dans l'ordre des épingles.
 * Les orphelines (mission supprimée, ancien identifiant, mission hors de portée)
 * sont ignorées, jamais supprimées. Un doublon ne compte qu'une fois.
 */
export function resolvePins<T extends { id: string }>(
  pins: readonly PinRow[],
  missionsById: ReadonlyMap<string, T>,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const pin of pins) {
    if (seen.has(pin.job_id)) continue;
    const mission = missionsById.get(pin.job_id);
    if (!mission) continue;
    seen.add(pin.job_id);
    out.push(mission);
  }
  return out;
}

/** Plafond compté sur les épingles résolues (visibles dans la barre). */
export function canPin(resolvedCount: number): boolean {
  return resolvedCount < PIN_LIMIT;
}

// ── Fusion « Mes missions » (D20, D21) ───────────────────────────

export interface BuildMyMissionsInput {
  userId: string | null;
  organizationId: string | null;
  /** Liste de l'organisation (useSourcingProjects('mission')). */
  orgList: SourceInput<readonly MissionRow[]>;
  /** Mes lignes d'équipe avec la mission jointe. */
  team: SourceInput<readonly TeamRow[]>;
  /** Missions partenaires (get_partner_missions) ; lue seulement si needsPartnerNames. */
  partners: SourceInput<readonly PartnerRow[]>;
  /** Épingles ; null quand l'appelant ne les demande pas. */
  pins: SourceInput<readonly PinRow[]> | null;
  /** Mission ouverte (/missions/:id), exclue des épinglées et de « Mes missions ». */
  openMissionId?: string | null;
}

export interface BuildMyMissionsResult {
  status: MissionSectionState;
  stale: boolean;
  mine: MissionNavItem[];
  /** Épingles résolues, hors mission ouverte. */
  pinned: MissionNavItem[];
  pinsStatus: MissionSectionState;
  pinsStale: boolean;
  /** Identifiants des épingles résolues, mission ouverte comprise. */
  pinnedIds: string[];
  /** Nombre d'épingles résolues (plafond D22). */
  resolvedPinCount: number;
  /** Ligne de liste ou de jointure de la mission ouverte, si elle est connue. */
  open: MissionNavItem | null;
  /** Missions de l'organisation, tous statuts ; null si inconnu. */
  ownOrgMissionCount: number | null;
  /** Missions partenaires ; null si inconnu. */
  partnerMissionCount: number | null;
  firstOwnMissionId: string | null;
}

function byUpdatedDesc(a: MissionNavItem, b: MissionNavItem): number {
  const ta = Date.parse(a.updated_at) || 0;
  const tb = Date.parse(b.updated_at) || 0;
  return tb - ta;
}

export function buildMyMissions(input: BuildMyMissionsInput): BuildMyMissionsResult {
  const { userId, organizationId, orgList, team, partners, pins } = input;
  const openId = input.openMissionId ?? null;

  const needPartners = needsPartnerNames(team.data, organizationId);

  const required: StateWithStale[] = [sourceState(orgList), sourceState(team)];
  if (needPartners) required.push(sourceState(partners));
  if (!userId || !organizationId) required.push({ state: 'loading', stale: false });
  const missions = combineStates(required);

  const orgRows = (orgList.data ?? []).filter((r) => r.kind === 'mission');
  const ownOrgMissionCount = orgList.data !== undefined && organizationId ? orgRows.length : null;

  let partnerMissionCount: number | null;
  if (team.data === undefined || !organizationId) partnerMissionCount = null;
  else if (!needPartners) partnerMissionCount = 0;
  else partnerMissionCount = partners.data !== undefined ? partners.data.length : null;

  const firstOwn =
    orgRows.find((r) => MY_MISSIONS_STATUSES.includes(r.status)) ?? orgRows[0] ?? null;
  const firstOwnMissionId = firstOwn ? firstOwn.id : null;

  // Missions visibles par la barre : celles de l'organisation, puis les
  // missions partenaires connues de la RPC (une autre organisation dont je suis
  // membre en est exclue par la RPC, et donc ici aussi).
  const partnerNames = new Map<string, string | null>();
  for (const p of partners.data ?? []) partnerNames.set(p.id, p.organization_name);

  const visible = new Map<string, MissionNavItem>();
  for (const row of orgRows) visible.set(row.id, toMissionNavItem(row));

  const teamIds = new Set<string>();
  for (const t of team.data ?? []) {
    const sp = t.sourcing_projects;
    if (!sp) continue;
    teamIds.add(sp.id);
    if (sp.organization_id === organizationId) continue; // source : la liste de l'organisation
    if (sp.kind !== 'mission') continue;
    if (!needPartners || !partnerNames.has(sp.id)) continue;
    visible.set(sp.id, toMissionNavItem(sp, partnerNames.get(sp.id) ?? null, true));
  }

  const pinState = pins ? sourceState(pins) : { state: 'ok' as const, stale: false };
  const resolved = pins?.data ? resolvePins(pins.data, visible) : [];
  const pinnedIds = resolved.map((m) => m.id);
  const pinnedSet = new Set(pinnedIds);
  const pinsCombined = combineStates([pinState, missions]);

  const mineCandidates: MissionNavItem[] = [];
  for (const item of visible.values()) {
    if (!MY_MISSIONS_STATUSES.includes(item.status)) continue;
    if (item.id === openId || pinnedSet.has(item.id)) continue;
    if (item.isPartner) {
      mineCandidates.push(item);
      continue;
    }
    const row = orgRows.find((r) => r.id === item.id);
    if (!row) continue;
    if ((userId && row.created_by === userId) || teamIds.has(row.id)) mineCandidates.push(item);
  }
  mineCandidates.sort(byUpdatedDesc);

  // Tant que les épingles se chargent, « Mes missions » attend : une mission
  // épinglée y apparaîtrait puis sauterait dans « Épinglées ».
  const mineState =
    missions.state === 'ok' && pins && pinState.state === 'loading'
      ? { state: 'loading' as const, stale: false }
      : missions;

  return {
    status: mineState.state,
    stale: mineState.stale,
    mine: mineState.state === 'ok' ? mineCandidates.slice(0, MY_MISSIONS_LIMIT) : [],
    pinned: pinsCombined.state === 'ok' ? resolved.filter((m) => m.id !== openId) : [],
    pinsStatus: pinsCombined.state,
    pinsStale: pinsCombined.stale,
    pinnedIds,
    resolvedPinCount: resolved.length,
    open: openId ? visible.get(openId) ?? null : null,
    ownOrgMissionCount,
    partnerMissionCount,
    firstOwnMissionId,
  };
}

// ── Vues et verrous (§3.2, D19) ──────────────────────────────────

/** Même expression que la page mission : seule une étape marquée verrouillée l'est. */
export function isViewLocked(
  readiness: ReadonlyArray<{ id: string; isLocked: boolean }>,
  view: string,
): boolean {
  return readiness.find((r) => r.id === view)?.isLocked === true;
}

export function blockerOf(
  readiness: ReadonlyArray<{ id: string; blockerMessage: string | null }>,
  view: string,
): string | null {
  return readiness.find((r) => r.id === view)?.blockerMessage ?? null;
}

/** Message de la page quand une étape verrouillée n'a pas de message propre. */
export const DEFAULT_BLOCKER_MESSAGE = 'Complétez les étapes précédentes.';

export function missionViewPath(projectId: string, view: string | null): string {
  const base = `/missions/${encodeURIComponent(projectId)}`;
  if (!view || view === 'overview') return base;
  return `${base}?tab=${encodeURIComponent(view)}`;
}

/**
 * Cible de réouverture d'une mission : sa dernière vue, sauf si elle est
 * verrouillée (Vue d'ensemble et message de blocage, comme la page).
 */
export function resolveOpenTarget(input: {
  projectId: string;
  lastView: string | null;
  readiness: ReadonlyArray<{ id: string; isLocked: boolean; blockerMessage: string | null }>;
}): { path: string; blocker: string | null } {
  const { projectId, lastView, readiness } = input;
  if (!lastView || lastView === 'overview') return { path: missionViewPath(projectId, null), blocker: null };
  if (isViewLocked(readiness, lastView)) {
    return {
      path: missionViewPath(projectId, null),
      blocker: blockerOf(readiness, lastView) ?? DEFAULT_BLOCKER_MESSAGE,
    };
  }
  return { path: missionViewPath(projectId, lastView), blocker: null };
}

// ── Relevé local des visites (D18, §3.6) ─────────────────────────

export const MISSION_VISITS_KEY_PREFIX = 'konekt:nav:missions:';
export const MISSION_VISITS_MAX = 100;

export function missionVisitsStorageKey(userId: string): string {
  return `${MISSION_VISITS_KEY_PREFIX}${userId}`;
}

/** v : dernière vue ; n : stats_total_found vu ; t : date du relevé (ISO). */
export interface MissionVisit {
  v: string | null;
  n: number;
  t: string;
}

export type MissionVisits = Readonly<Record<string, MissionVisit>>;

/** Lecture tolérante : toute entrée mal formée est ignorée. */
export function parseMissionVisits(raw: string | null): MissionVisits {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, MissionVisit> = {};
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as Record<string, unknown>;
    const v = typeof entry.v === 'string' ? entry.v : entry.v === null ? null : undefined;
    const n = entry.n;
    const t = entry.t;
    if (v === undefined) continue;
    if (typeof n !== 'number' || !Number.isFinite(n)) continue;
    if (typeof t !== 'string') continue;
    out[id] = { v, n, t };
  }
  return out;
}

/** Garde les `max` relevés les plus récents (par `t`). */
export function pruneMissionVisits(visits: MissionVisits, max = MISSION_VISITS_MAX): MissionVisits {
  const entries = Object.entries(visits);
  if (entries.length <= max) return visits;
  entries.sort((a, b) => (Date.parse(b[1].t) || 0) - (Date.parse(a[1].t) || 0));
  return Object.fromEntries(entries.slice(0, max));
}

/**
 * Écrit un relevé. Renvoie le même objet si rien ne change (ni vue ni total),
 * pour ne pas notifier les abonnés pour rien.
 */
export function withMissionVisit(
  visits: MissionVisits,
  projectId: string,
  visit: { v: string | null; n: number },
  nowIso: string,
): MissionVisits {
  const current = visits[projectId];
  if (current && current.v === visit.v && current.n === visit.n) return visits;
  return pruneMissionVisits({ ...visits, [projectId]: { v: visit.v, n: visit.n, t: nowIso } });
}

/**
 * Pose une référence `{ v: null, n }` pour chaque mission jamais relevée.
 * N'allume aucun point et ne touche pas aux relevés existants.
 */
export function withMissionBaselines(
  visits: MissionVisits,
  items: ReadonlyArray<{ id: string; n: number }>,
  nowIso: string,
): MissionVisits {
  let next: Record<string, MissionVisit> | null = null;
  for (const item of items) {
    if (visits[item.id] || next?.[item.id]) continue;
    if (!next) next = { ...visits };
    next[item.id] = { v: null, n: item.n, t: nowIso };
  }
  return next ? pruneMissionVisits(next) : visits;
}

/** Point « nouveaux profils » : le total dépasse celui vu à la dernière visite. */
export function hasNewProfiles(current: number, visit: { n: number } | undefined): boolean {
  return visit !== undefined && current > visit.n;
}

// ── Plafond de missions (D14, D23) ───────────────────────────────

/** Texte du plafond atteint, partagé par la barre et la page /missions. */
export function missionQuotaMessage(maxJobs: number): string {
  // Le plafond compte aussi les missions en pause (useQuotaGate) : le texte le dit,
  // sinon il contredit le compteur « missions actives » de /missions.
  return maxJobs === 1
    ? 'Plafond de 1 mission en cours atteint (active ou en pause).'
    : `Plafond de ${maxJobs} missions en cours atteint (actives ou en pause).`;
}
