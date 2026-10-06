/**
 * useClientLogoBackfill : fait enregistrer le logo du client des missions qui
 * n'en ont pas, à l'affichage de la liste ou d'une mission.
 *
 * La recherche se fait côté serveur (resolve-client-logo) : le navigateur ne
 * devine jamais un logo en interrogeant un service tiers. Une fois par client et
 * par session ; le serveur enregistre le logo pour toutes les missions du même
 * client, et note l'échec pour ne pas chercher de nouveau avant 30 jours.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';

export interface LogoCandidate {
  id: string;
  /** Client de la mission (brief, sinon colonne client_name). */
  clientName: string | null;
  logoUrl: string | null;
  /** Date de la dernière recherche infructueuse (logo_checked_at). */
  logoCheckedAt: string | null;
}

const RETRY_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** Clients déjà demandés ou en cours, pour toute la session : quitter la page n'interrompt pas la recherche. */
const requested = new Set<string>();
const normalize = (name: string) => name.trim().toLowerCase();

/** Une mission par client sans logo ni recherche récente. */
export function logoLookups(projects: readonly LogoCandidate[], now = Date.now()): LogoCandidate[] {
  const withLogo = new Set<string>();
  for (const p of projects) if (p.clientName && p.logoUrl) withLogo.add(normalize(p.clientName));
  const seen = new Set<string>();
  const out: LogoCandidate[] = [];
  for (const p of projects) {
    if (!p.clientName || p.logoUrl) continue;
    const key = normalize(p.clientName);
    if (withLogo.has(key) || seen.has(key)) continue;
    const checked = p.logoCheckedAt ? Date.parse(p.logoCheckedAt) : NaN;
    if (!Number.isNaN(checked) && now - checked < RETRY_AFTER_MS) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

export function useClientLogoBackfill(projects: readonly LogoCandidate[]): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const todo = logoLookups(projects).filter((p) => !requested.has(normalize(p.clientName ?? '')));
    if (todo.length === 0) return;
    for (const p of todo) requested.add(normalize(p.clientName ?? ''));
    void (async () => {
      for (const p of todo) {
        try {
          const { data, error } = await invokeEdgeFunction<{ status?: string }>('resolve-client-logo', { project_id: p.id });
          // Chaque logo apparaît dès qu'il est enregistré.
          if (!error && data?.status === 'resolved') {
            void queryClient.invalidateQueries({ queryKey: ['sourcing-projects'] });
            void queryClient.invalidateQueries({ queryKey: ['sourcing-project'] });
          }
        } catch {
          // Le logo est un confort : un échec laisse les initiales.
        }
      }
    })();
  }, [projects, queryClient]);
}
