/**
 * Analytics — Plausible (RGPD-compliant, no cookies, privacy-first)
 *
 * Plausible est chargé via env vars (VITE_PLAUSIBLE_DOMAIN et VITE_PLAUSIBLE_SRC).
 * Si VITE_PLAUSIBLE_DOMAIN n'est pas défini, analytics est désactivé (dev, preview).
 *
 * Adresses envoyées (SEC-043, audit du 01/09/2026) : certaines pages portent un
 * jeton dans leur chemin (/client/:token, /portal/:token, /mission-invite/:token)
 * et d'autres un identifiant de candidat, de mission ou de séquence ; la requête
 * (?token=…) et le fragment (#access_token=…) peuvent aussi en porter. Le script
 * automatique enverrait l'adresse entière à chaque page. On charge donc la
 * variante manuelle du script, qui n'envoie rien seule, et chaque envoi (pages
 * vues et événements) passe l'adresse réduite par analyticsUrl : origine et
 * chemin du routeur, paramètres remplacés par leur nom, sans requête ni fragment.
 * Un VITE_PLAUSIBLE_SRC qui n'est pas une variante manuelle n'est pas chargé.
 * Limite : le script envoie aussi document.referrer tel quel ; aucune page de
 * l'application ne quitte une page à jeton par un chargement complet.
 *
 * Pages vues : trackPageview, appelé par App.tsx à chaque changement de chemin.
 * Pour les événements custom (signup, search, etc.), utiliser trackEvent().
 */

type PlausibleOptions = {
  callback?: () => void;
  /** Adresse enregistrée à la place de location.href (variante manuelle du script). */
  u?: string;
  props?: Record<string, string | number | boolean>;
};

declare global {
  interface Window {
    // `q` : file d'attente des événements émis avant le chargement du script
    // (shim officiel Plausible).
    plausible?: ((eventName: string, options?: PlausibleOptions) => void) & { q?: unknown[] };
  }
}

// import.meta.env peut manquer hors de Vite (tests Node qui chargent un module
// appelant trackEvent) : la mesure ne doit jamais empêcher le chargement.
const PLAUSIBLE_DOMAIN = import.meta.env?.VITE_PLAUSIBLE_DOMAIN as string | undefined;
const PLAUSIBLE_SRC = (import.meta.env?.VITE_PLAUSIBLE_SRC as string | undefined)
  || 'https://plausible.io/js/script.manual.js';

let loaded = false;

// Premier segment de chaque route de App.tsx. Un chemin hors de cette liste
// (page introuvable, faute de frappe) est envoyé « /autre », jamais tel quel.
const KNOWN_ROOTS = new Set([
  'agents', 'ats', 'auth', 'calendar', 'calls', 'candidates', 'client', 'dashboard',
  'inbox', 'index', 'marketplace', 'mission-invite', 'missions', 'onboarding',
  'outreach', 'pipeline', 'portal', 'pricing', 'privacy', 'privacy-extension',
  'qualification', 'r', 'sequences', 'settings', 'sourcing', 'tasks', 'unsubscribe',
]);

// Segment fixe d'une route (« sourcing », « nouvelle », « account »…).
const STATIC_SEGMENT = /^[a-z]+(?:-[a-z]+)*$/;

/** Nom du paramètre au segment `index` du chemin découpé, ou null pour un segment fixe. */
function routeParam(segments: string[], index: number): string | null {
  const [root, second] = segments;
  if (index === 1) {
    if (root === 'portal' || root === 'client' || root === 'mission-invite') return ':token';
    if (root === 'r') return ':slug';
    if (root === 'missions' || root === 'sourcing' || root === 'qualification') return ':id';
    if (root === 'sequences' && segments[1] !== 'nouvelle') return ':id';
  }
  if (index === 2) {
    if (root === 'agents' && second === 'sourcing') return ':projectId';
    if ((root === 'pipeline' || root === 'ats') && second === 'scorecard') return ':candidateId';
  }
  return null;
}

/**
 * Chemin envoyé à la mesure : chaque paramètre de route remplacé par son nom
 * (/client/:token, /missions/:id/sourcing), tout autre segment qui n'a pas la
 * forme d'un mot fixe remplacé par « :id », racine inconnue ramenée à « /autre ».
 */
export function analyticsPath(pathname: string): string {
  const segments = String(pathname ?? '').split('/').filter(Boolean);
  if (segments.length === 0) return '/';
  if (!KNOWN_ROOTS.has(segments[0])) return '/autre';
  return '/' + segments
    .map((segment, index) => {
      if (index === 0) return segment;
      return routeParam(segments, index) ?? (STATIC_SEGMENT.test(segment) ? segment : ':id');
    })
    .join('/');
}

/** Adresse envoyée à la mesure : origine et chemin réduit, sans requête ni fragment. null si illisible. */
export function analyticsUrl(location: { origin?: unknown; pathname?: unknown } | null | undefined): string | null {
  if (!location || typeof location.origin !== 'string' || typeof location.pathname !== 'string') return null;
  if (!/^https?:\/\/[^/?#]+$/.test(location.origin)) return null;
  return location.origin + analyticsPath(location.pathname);
}

/**
 * Vrai pour une variante manuelle du script (script.manual.js,
 * script.manual.outbound-links.js…) : elle n'envoie rien seule et honore
 * l'adresse passée en `u`. Toute autre variante enverrait l'adresse entière.
 */
export function isManualPlausibleScript(src: string): boolean {
  let file: string;
  try {
    file = new URL(src, 'https://exemple.invalid').pathname.split('/').pop() ?? '';
  } catch {
    return false;
  }
  const parts = file.split('.');
  return parts.length >= 3 && parts[0] === 'script' && parts[parts.length - 1] === 'js'
    && parts.slice(1, -1).includes('manual');
}

/**
 * Charge le script Plausible (idempotent). Appelé automatiquement depuis App.tsx.
 * Aucune opération si VITE_PLAUSIBLE_DOMAIN absente (dev, preview).
 */
export function loadAnalytics(): void {
  if (loaded) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!PLAUSIBLE_DOMAIN) return;
  if (!isManualPlausibleScript(PLAUSIBLE_SRC)) {
    console.warn('[analytics] VITE_PLAUSIBLE_SRC doit désigner une variante manuelle du script (script.manual.js) : mesure désactivée.');
    return;
  }
  if (document.querySelector('script[data-plausible-loaded]')) {
    loaded = true;
    return;
  }

  const script = document.createElement('script');
  script.defer = true;
  script.src = PLAUSIBLE_SRC;
  script.setAttribute('data-domain', PLAUSIBLE_DOMAIN);
  script.setAttribute('data-plausible-loaded', '1');
  document.head.appendChild(script);

  // Shim Plausible (queue events avant que le script soit chargé)
  window.plausible = window.plausible || function (...args: unknown[]) {
    (window.plausible!.q = window.plausible!.q || []).push(args);
  } as NonNullable<typeof window.plausible>;

  loaded = true;
}

/**
 * Track un event custom Plausible (ex. "Signup", "Mission Created", "Search").
 * No-op si analytics désactivé. Ne throw jamais. L'adresse envoyée est celle
 * d'analyticsUrl ; si elle est illisible, rien n'est envoyé (le script
 * prendrait sinon l'adresse entière).
 */
export function trackEvent(
  eventName: string,
  props?: Record<string, string | number | boolean>,
): void {
  try {
    if (typeof window === 'undefined') return;
    if (!window.plausible) return;
    const u = analyticsUrl(window.location);
    if (!u) return;
    window.plausible(eventName, props ? { u, props } : { u });
  } catch {
    // Analytics doit être 100% silent-fail — ne jamais casser l'app
  }
}

/**
 * Page vue, adresse réduite comprise. Appelé par App.tsx à chaque changement de
 * chemin : la variante manuelle du script n'en envoie aucune seule.
 */
export function trackPageview(): void {
  trackEvent('pageview');
}
