/**
 * GoShortcuts — séquences G puis une lettre (G D, G M…), affichées dans la
 * palette Ctrl+J. Monté dans AppLayout : actif sur les pages de l'application
 * seulement (pas sur l'onboarding, dont les choix se font aussi par lettres,
 * ni sur les pages publiques).
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { shouldIgnoreShortcut } from '@/lib/keyboardShortcuts';

const G_ROUTES: Record<string, string> = {
  d: '/dashboard',
  m: '/missions',
  p: '/pipeline',
  e: '/calendar',
  t: '/tasks',
  c: '/inbox',
  i: '/agents',
};
const G_SEQUENCE_WINDOW_MS = 1200;

export function GoShortcuts() {
  const navigate = useNavigate();

  // Écoute en capture pour que la seconde lettre ne déclenche pas aussi un
  // raccourci de page (ex. T = aujourd'hui au calendrier).
  useEffect(() => {
    let pendingSince = 0;
    const handler = (e: KeyboardEvent) => {
      if (shouldIgnoreShortcut(e)) {
        pendingSince = 0;
        return;
      }
      const key = (e.key || '').toLowerCase();
      if (pendingSince && e.timeStamp - pendingSince < G_SEQUENCE_WINDOW_MS) {
        pendingSince = 0;
        const path = G_ROUTES[key];
        if (path) {
          e.preventDefault();
          e.stopPropagation();
          navigate(path);
        }
        return;
      }
      pendingSince = key === 'g' && !e.shiftKey ? e.timeStamp : 0;
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [navigate]);

  return null;
}
