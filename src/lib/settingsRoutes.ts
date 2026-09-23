/**
 * Adresses des Paramètres (lots 2 et 3) : rubriques, anciens ?tab= et accès par rôle.
 * Module pur, sans dépendance : tests/ux le charge transpilé via une URL data:.
 */
export type SettingsSectionId = 'connections' | 'writing' | 'journal' | 'general' | 'team' | 'billing' | 'assistant';
export type SettingsDoor = 'account' | 'org';

export const SETTINGS_PATHS: Record<SettingsSectionId, string> = {
  connections: '/settings/account/connections',
  writing: '/settings/account/writing',
  journal: '/settings/account/journal', // provisoire : part dans /agents au lot 9
  general: '/settings/org/general',
  team: '/settings/org/team',
  billing: '/settings/org/billing',
  assistant: '/settings/org/assistant',
};

export const SETTINGS_DOOR: Record<SettingsSectionId, SettingsDoor> = {
  connections: 'account', writing: 'account', journal: 'account',
  general: 'org', team: 'org', billing: 'org', assistant: 'org',
};

/** Mémo de session : révéler la carte de l'extension malgré un détour par /auth (D13). */
export const EXTENSION_REVEAL_STORAGE_KEY = 'konekt:settings:reveal-extension';

interface LegacyTab { pathname: string; hash?: string; kind?: 'pack' | 'subscription'; revealExtension?: boolean }

/** Les 13 anciens onglets (Settings.tsx:139-151 au commit 97d6fdf). Redirigés pour toujours. */
export const LEGACY_SETTINGS_TABS: Readonly<Record<string, LegacyTab>> = Object.freeze({
  general: { pathname: SETTINGS_PATHS.general },
  account: { pathname: SETTINGS_PATHS.connections, revealExtension: true },
  templates: { pathname: SETTINGS_PATHS.writing, hash: '#modeles' },
  'ai-context': { pathname: SETTINGS_PATHS.writing, hash: '#style' },
  'agent-actions': { pathname: SETTINGS_PATHS.assistant, hash: '#resume' },
  presets: { pathname: SETTINGS_PATHS.assistant, hash: '#icp' },
  team: { pathname: SETTINGS_PATHS.team },
  agency: { pathname: SETTINGS_PATHS.team },
  connectors: { pathname: SETTINGS_PATHS.general, hash: '#outils' },
  integrations: { pathname: SETTINGS_PATHS.general, hash: '#outils' },
  billing: { pathname: SETTINGS_PATHS.billing, kind: 'subscription' },
  credits: { pathname: SETTINGS_PATHS.billing, hash: '#credits', kind: 'pack' },
  marketplace: { pathname: '/marketplace' },
});

export interface LegacySettingsTarget { pathname: string; search: string; hash: string; revealExtension: boolean }

/**
 * Ancienne adresse /settings?tab=… (e-mails envoyés, notifications en base, retours de paiement
 * et d'OAuth, extension installée) → nouvelle adresse. null si ce n'en est pas une.
 * - tab retiré ; tous les autres paramètres gardés (checkout, kind, notion_*, __lovable_token…) ;
 * - notion_oauth / notion_error : Connexions #notion, quel que soit l'onglet (seul lecteur : NotionConnectionCard) ;
 * - checkout sans kind : kind déduit de l'onglet (le repli de checkoutReturn.ts:34-36 lisait tab) ;
 * - un hash déjà présent passe avant l'ancre de la table.
 */
export function resolveLegacySettingsUrl(pathname: string, search: string, hash: string): LegacySettingsTarget | null {
  if (pathname.replace(/\/+$/, '') !== '/settings') return null;
  const params = new URLSearchParams(search);
  const rawTab = params.get('tab');
  const notionReturn = params.has('notion_oauth') || params.has('notion_error');
  if (rawTab === null && !notionReturn) return null;
  const key = (rawTab ?? '').trim().toLowerCase();
  // hasOwnProperty : ?tab=constructor ou ?tab=__proto__ ne doivent pas lire le prototype.
  const legacy = Object.prototype.hasOwnProperty.call(LEGACY_SETTINGS_TABS, key) ? LEGACY_SETTINGS_TABS[key] : undefined;
  const target: LegacyTab = notionReturn
    ? { pathname: SETTINGS_PATHS.connections, hash: '#notion' }
    : legacy ?? { pathname: '/settings' };
  params.delete('tab');
  if (legacy?.kind && params.has('checkout') && !params.has('kind')) params.set('kind', legacy.kind);
  const qs = params.toString();
  return {
    pathname: target.pathname,
    search: qs ? `?${qs}` : '',
    hash: hash && hash !== '#' ? hash : target.hash ?? '',
    revealExtension: target.revealExtension === true,
  };
}

export interface SettingsViewer {
  /** Propriétaire ou admin. */
  isAdmin: boolean;
  isOwner: boolean;
  orgType: 'enterprise' | 'agency' | 'freelance' | null;
  /** hasFeature(orgType, 'team_management'), calculé par l'appelant : ce module ne dépend de rien. */
  hasTeam: boolean;
}
export type SectionAccess = 'open' | 'managed' | 'team_unavailable';

export function sectionAccess(id: SettingsSectionId, v: SettingsViewer): SectionAccess {
  if (SETTINGS_DOOR[id] === 'account') return 'open';
  if (!v.isAdmin) return 'managed';
  if (id === 'team' && !v.hasTeam) return 'team_unavailable';
  return 'open';
}

/** Rubrique ouverte par /settings sur ordinateur. Sans type, missions, brief et Équipe restent fermés : le propriétaire atterrit sur Général. */
export function landingPath(v: SettingsViewer): string {
  return v.isOwner && !v.orgType ? SETTINGS_PATHS.general : SETTINGS_PATHS.connections;
}

export const MANAGED_FALLBACK_NAME = 'votre administrateur';
export function managedBySentence(name: string | null | undefined): string {
  const n = typeof name === 'string' ? name.trim() : '';
  return `Les réglages de l’organisation sont gérés par ${n || MANAGED_FALLBACK_NAME}.`;
}
