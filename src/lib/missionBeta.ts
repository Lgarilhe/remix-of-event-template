// Refonte mission, lots 1 et 2 : interrupteur de la nouvelle page mission, et
// correspondance des adresses entre l'ancienne page (?tab=) et la nouvelle
// (/missions/:id, /missions/:id/sourcing, /missions/:id/cadrage).
//
// Interrupteur par navigateur, éteint par défaut : clé konekt.mission-v3 du
// stockage local ('1' = allumé). ?nouvelle-mission=1 l'allume, ?nouvelle-mission=0
// l'éteint ; la page retire ensuite le paramètre de l'adresse. Stockage
// indisponible (navigation privée, sites bloqués) : l'interrupteur vaut pour la
// session en cours, jamais d'erreur.
//
// Module pur, sans import : lu par la mise en page (clé de page), la barre
// latérale et l'entrée de la page mission.

// ------------------------------------------------------------- interrupteur

export const MISSION_BETA_STORAGE_KEY = 'konekt.mission-v3';
export const MISSION_BETA_PARAM = 'nouvelle-mission';

export type MissionBetaStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): MissionBetaStorage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Lecture protégée : '1' allume, toute autre valeur ou une erreur éteint. */
export function readMissionBeta(storage: MissionBetaStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(MISSION_BETA_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Écriture protégée : rend false si le stockage a refusé. */
export function writeMissionBeta(on: boolean, storage: MissionBetaStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    if (on) storage.setItem(MISSION_BETA_STORAGE_KEY, '1');
    else storage.removeItem(MISSION_BETA_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

// Magasin du module : une seule copie pour la page, la mise en page et la barre
// (useSyncExternalStore dans src/hooks/useMissionBeta.ts).
let cached: boolean | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== MISSION_BETA_STORAGE_KEY) return;
  const next = event.newValue === '1';
  if (cached === next) return;
  cached = next;
  notify();
}

/** État courant (lu une fois dans le stockage, puis en mémoire). */
export function getMissionBeta(): boolean {
  if (cached === null) cached = readMissionBeta();
  return cached;
}

/** Allume ou éteint, pour la session même si le stockage refuse, et prévient les abonnés. */
export function setMissionBeta(on: boolean): void {
  writeMissionBeta(on);
  if (cached === on) return;
  cached = on;
  notify();
}

export function subscribeMissionBeta(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
    }
  };
}

/** Tests seulement : oublie l'état en mémoire. */
export function resetMissionBetaForTests(): void {
  cached = null;
  listeners.clear();
}

/** Valeur demandée par ?nouvelle-mission= : true (1), false (0), sinon null. */
export function missionBetaParam(search: string): boolean | null {
  const raw = new URLSearchParams(search).get(MISSION_BETA_PARAM);
  if (raw === '1') return true;
  if (raw === '0') return false;
  return null;
}

/** Recherche sans ?nouvelle-mission= : '' ou '?a=b', les autres paramètres gardés dans leur ordre. */
export function withoutMissionBetaParam(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(MISSION_BETA_PARAM);
  const out = params.toString();
  return out ? `?${out}` : '';
}

// ---------------------------------------------------------------- adresses

/** Les trois écrans de la nouvelle page (conception, section 3.1). */
export type MissionScreen = 'pipeline' | 'sourcing' | 'cadrage';
export const MISSION_SCREENS: readonly MissionScreen[] = ['pipeline', 'sourcing', 'cadrage'];

/** Panneaux à droite des lots 1 et 2 : un seul ouvert à la fois. */
export type MissionPanelKind = 'fiche' | 'contact';

/** Sections de Cadrage visées par une adresse (?section=). */
export type CadrageSection = 'poste' | 'etapes' | 'reglages';

/** Affichage de Pipeline (?vue=) : liste par défaut, kanban sur « etapes ». */
export type PipelineViewMode = 'liste' | 'etapes';

/** Paramètres de la nouvelle page. Tous les autres paramètres de l'adresse sont gardés tels quels. */
export const V3_PARAM = {
  panel: 'panneau',
  candidate: 'candidat',
  bilan: 'bilan',
  section: 'section',
  view: 'vue',
  stage: 'etape',
} as const;

const V3_PARAM_NAMES: readonly string[] = Object.values(V3_PARAM);
const LEGACY_TAB_PARAM = 'tab';

const MISSION_PATH_RE = /^\/missions\/([^/]+)(?:\/([^/]*))?\/?$/;

export interface MissionPathInfo {
  /** Identifiant de la mission, décodé. */
  id: string;
  /** Écran du chemin ; null pour un sous-chemin inconnu. */
  screen: MissionScreen | null;
  /** Sous-chemin brut ('' pour /missions/:id). */
  sub: string;
}

function decode(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** /missions/:id et /missions/:id/<écran> ; null pour toute autre adresse (/missions compris). */
export function parseMissionPath(pathname: string): MissionPathInfo | null {
  const match = MISSION_PATH_RE.exec(pathname);
  if (!match) return null;
  const id = decode(match[1]);
  if (!id) return null;
  const sub = match[2] ?? '';
  const screen: MissionScreen | null =
    sub === '' ? 'pipeline' : sub === 'sourcing' ? 'sourcing' : sub === 'cadrage' ? 'cadrage' : null;
  return { id, screen, sub };
}

/** Identifiant de la mission de l'adresse, sous-chemin compris ; null hors d'une mission. */
export function missionIdFromPath(pathname: string): string | null {
  return parseMissionPath(pathname)?.id ?? null;
}

type ParamValues = Readonly<Record<string, string | null | undefined>>;

function withParams(base: URLSearchParams, set: ParamValues, remove: readonly string[] = []): string {
  const params = new URLSearchParams(base);
  for (const name of remove) params.delete(name);
  for (const [name, value] of Object.entries(set)) {
    if (value === null || value === undefined || value === '') params.delete(name);
    else params.set(name, value);
  }
  const out = params.toString();
  return out ? `?${out}` : '';
}

/** Chemin d'un écran de la nouvelle page : /missions/:id, /missions/:id/sourcing, /missions/:id/cadrage. */
export function missionV3Path(id: string, screen: MissionScreen = 'pipeline', params: ParamValues = {}): string {
  const base = `/missions/${encodeURIComponent(id)}${screen === 'pipeline' ? '' : `/${screen}`}`;
  return `${base}${withParams(new URLSearchParams(), params)}`;
}

export interface MissionV3Location {
  id: string;
  screen: MissionScreen;
  /** Panneau ouvert ; 'fiche' seulement avec un identifiant de ligne. */
  panel: MissionPanelKind | null;
  /** Identifiant de ligne (mission_candidate_rows.id) de la fiche ouverte. */
  candidateRowId: string | null;
  bilan: boolean;
  section: CadrageSection | null;
  view: PipelineViewMode;
  /** Filtre d'étape brut (?etape=), lu par src/components/missions/v3/types.ts (parseStageFilter). */
  stage: string | null;
}

const SECTIONS: readonly CadrageSection[] = ['poste', 'etapes', 'reglages'];

/** Lecture de l'adresse de la nouvelle page. Sous-chemin inconnu : Pipeline. null hors d'une mission. */
export function readMissionV3Location(pathname: string, search: string): MissionV3Location | null {
  const path = parseMissionPath(pathname);
  if (!path) return null;
  const params = new URLSearchParams(search);
  const rawPanel = params.get(V3_PARAM.panel);
  const candidateRowId = params.get(V3_PARAM.candidate) || null;
  let panel: MissionPanelKind | null = null;
  if (rawPanel === 'contact') panel = 'contact';
  else if (rawPanel === 'fiche' && candidateRowId) panel = 'fiche';
  const rawSection = params.get(V3_PARAM.section);
  return {
    id: path.id,
    screen: path.screen ?? 'pipeline',
    panel,
    candidateRowId: panel === 'fiche' ? candidateRowId : null,
    bilan: params.get(V3_PARAM.bilan) === '1',
    section: (SECTIONS as readonly string[]).includes(rawSection ?? '') ? (rawSection as CadrageSection) : null,
    view: params.get(V3_PARAM.view) === 'etapes' ? 'etapes' : 'liste',
    stage: params.get(V3_PARAM.stage) || null,
  };
}

/**
 * Ancienne vue (?tab=, identifiants de src/lib/missionViews.ts) vers la nouvelle
 * page (conception, sections 3.2 et 12.1) : Vue d'ensemble, Pipeline, Analyses
 * et Prise de contact mènent à Pipeline (Analyses ouvre le Bilan, Prise de
 * contact son panneau) ; Brief, Process et Configuration à Cadrage ; Sourcing
 * au Sourcing. Valeur absente ou inconnue : Pipeline.
 */
export function legacyTabToV3(tab: string | null | undefined): { screen: MissionScreen; params: ParamValues } {
  switch (tab) {
    case 'sourcing':
      return { screen: 'sourcing', params: {} };
    case 'brief':
      return { screen: 'cadrage', params: { [V3_PARAM.section]: 'poste' } };
    case 'process':
      return { screen: 'cadrage', params: { [V3_PARAM.section]: 'etapes' } };
    case 'config':
      return { screen: 'cadrage', params: { [V3_PARAM.section]: 'reglages' } };
    case 'outreach':
      return { screen: 'pipeline', params: { [V3_PARAM.panel]: 'contact' } };
    case 'insights':
      return { screen: 'pipeline', params: { [V3_PARAM.bilan]: '1' } };
    default:
      return { screen: 'pipeline', params: {} };
  }
}

/**
 * Interrupteur allumé : adresse de la nouvelle page à substituer (remplacement,
 * pas d'entrée d'historique), ou null si l'adresse est déjà bonne. Convertit
 * ?tab= et les sous-chemins inconnus ; garde les autres paramètres.
 */
export function legacyToV3Target(pathname: string, search: string): string | null {
  const path = parseMissionPath(pathname);
  if (!path) return null;
  const params = new URLSearchParams(search);
  const tab = params.get(LEGACY_TAB_PARAM);
  if (tab === null && path.screen !== null) return null;
  const target = tab !== null ? legacyTabToV3(tab) : { screen: 'pipeline' as const, params: {} };
  const base = `/missions/${encodeURIComponent(path.id)}${target.screen === 'pipeline' ? '' : `/${target.screen}`}`;
  return `${base}${withParams(params, target.params, [LEGACY_TAB_PARAM])}`;
}

/**
 * Nouvelle adresse vers l'ancienne vue (?tab=), pour l'interrupteur éteint :
 * Sourcing vers sourcing ; Cadrage vers brief (process pour « etapes »,
 * config pour « reglages ») ; panneau Prise de contact vers outreach ; Bilan
 * vers insights ; fiche, affichage ou filtre d'étape vers pipeline ;
 * sous-chemin inconnu vers la Vue d'ensemble.
 */
export function v3ToLegacyTab(info: { screen: MissionScreen | null; params: URLSearchParams }): string | null {
  const { screen, params } = info;
  if (screen === 'sourcing') return 'sourcing';
  if (screen === 'cadrage') {
    const section = params.get(V3_PARAM.section);
    return section === 'etapes' ? 'process' : section === 'reglages' ? 'config' : 'brief';
  }
  if (screen === null) return null;
  if (params.get(V3_PARAM.panel) === 'contact') return 'outreach';
  if (params.get(V3_PARAM.bilan) === '1') return 'insights';
  if (params.get(V3_PARAM.panel) === 'fiche' || params.has(V3_PARAM.view) || params.has(V3_PARAM.stage)) {
    return 'pipeline';
  }
  return null;
}

/**
 * Interrupteur éteint : ancienne adresse à substituer (remplacement), ou null
 * si l'adresse n'a ni sous-chemin ni paramètre de la nouvelle page (dans ce
 * cas l'ancienne page s'affiche exactement comme aujourd'hui). Un ?tab= déjà
 * présent l'emporte ; les autres paramètres sont gardés.
 */
export function v3ToLegacyTarget(pathname: string, search: string): string | null {
  const path = parseMissionPath(pathname);
  if (!path) return null;
  const params = new URLSearchParams(search);
  const hasV3Param = V3_PARAM_NAMES.some((name) => params.has(name));
  if (path.sub === '' && !hasV3Param) return null;
  const existingTab = params.get(LEGACY_TAB_PARAM);
  const tab = existingTab ?? v3ToLegacyTab({ screen: path.screen, params });
  return `/missions/${encodeURIComponent(path.id)}${withParams(params, { [LEGACY_TAB_PARAM]: tab }, V3_PARAM_NAMES)}`;
}

// ------------------------------------------------- dernières vues (barre latérale)

/**
 * Le relevé des visites (useMissionVisits, clé konekt:nav:missions:{userId})
 * garde le vocabulaire de l'ancienne page, pour que l'interrupteur se
 * rallume ou s'éteigne sans conversion du stockage : Pipeline s'écrit
 * 'pipeline', Sourcing 'sourcing', Cadrage 'brief'.
 */
export function screenToVisitView(screen: MissionScreen): 'pipeline' | 'sourcing' | 'brief' {
  if (screen === 'sourcing') return 'sourcing';
  if (screen === 'cadrage') return 'brief';
  return 'pipeline';
}

/** Dernière vue relevée (ancien ou nouveau vocabulaire) vers l'écran de la nouvelle page. */
export function visitViewToScreen(view: string | null | undefined): MissionScreen {
  switch (view) {
    case 'sourcing':
      return 'sourcing';
    case 'brief':
    case 'process':
    case 'config':
    case 'cadrage':
      return 'cadrage';
    default:
      return 'pipeline';
  }
}

/** Cible d'un clic sur une mission dans la barre, interrupteur allumé : dernier écran, jamais de verrou. */
export function missionV3PathFromVisit(id: string, view: string | null | undefined): string {
  return missionV3Path(id, visitViewToScreen(view));
}

// ------------------------------------------------------------ clé de page

/**
 * Clé de transition de la mise en page (AppLayout) : une seule clé pour toute
 * une mission, sous-chemins compris, comme pour /settings ; sinon le chemin.
 * Interrupteur éteint, l'ancienne page n'a que /missions/:id : même clé
 * qu'aujourd'hui.
 */
export function pageTransitionKey(pathname: string): string {
  if (pathname.startsWith('/settings/')) return '/settings';
  const id = missionIdFromPath(pathname);
  if (id !== null) return `/missions/${encodeURIComponent(id)}`;
  return pathname;
}
