/**
 * Routes publiques de l'app — source de vérité UNIQUE.
 *
 * Consommée par :
 *  - App.tsx (pas de dialog « session expirée » sur une route publique)
 *  - AgentDrawer (l'assistant interne — FAB + Cmd+K — ne doit jamais être
 *    exposé aux visiteurs ni aux clients du portail externe)
 *
 * Ajouter une nouvelle route publique ICI la masque automatiquement à l'agent.
 */
export const PUBLIC_ROUTES = ['/', '/index', '/auth', '/portal', '/client'] as const;

export const isPublicRoute = (pathname: string): boolean =>
  PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'));
