/**
 * Analytics — Plausible (RGPD-compliant, no cookies, privacy-first)
 *
 * Plausible est chargé via env vars (VITE_PLAUSIBLE_DOMAIN et VITE_PLAUSIBLE_SRC).
 * Si VITE_PLAUSIBLE_DOMAIN n'est pas défini, analytics est désactivé (dev, preview).
 *
 * Le script officiel auto-track les pageviews sur SPA via pushState depuis 2022,
 * donc pas besoin d'appeler trackPageview manuellement.
 *
 * Pour les événements custom (signup, search, etc.), utiliser trackEvent().
 */

type PlausibleOptions = {
  callback?: () => void;
  props?: Record<string, string | number | boolean>;
};

declare global {
  interface Window {
    plausible?: (eventName: string, options?: PlausibleOptions) => void;
  }
}

const PLAUSIBLE_DOMAIN = import.meta.env.VITE_PLAUSIBLE_DOMAIN as string | undefined;
const PLAUSIBLE_SRC = (import.meta.env.VITE_PLAUSIBLE_SRC as string | undefined)
  || 'https://plausible.io/js/script.js';

let loaded = false;

/**
 * Charge le script Plausible (idempotent). Appelé automatiquement depuis App.tsx.
 * Aucune opération si VITE_PLAUSIBLE_DOMAIN absente (dev, preview).
 */
export function loadAnalytics(): void {
  if (loaded) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!PLAUSIBLE_DOMAIN) return;
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
  } as typeof window.plausible & { q?: unknown[] };

  loaded = true;
}

/**
 * Track un event custom Plausible (ex. "Signup", "Mission Created", "Search").
 * No-op si analytics désactivé. Ne throw jamais.
 */
export function trackEvent(
  eventName: string,
  props?: Record<string, string | number | boolean>,
): void {
  try {
    if (typeof window === 'undefined') return;
    if (!window.plausible) return;
    window.plausible(eventName, props ? { props } : undefined);
  } catch {
    // Analytics doit être 100% silent-fail — ne jamais casser l'app
  }
}

/**
 * Track un pageview manuellement (rarement utile, le script auto-track pushState).
 */
export function trackPageview(): void {
  trackEvent('pageview');
}
