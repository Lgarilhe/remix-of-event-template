/**
 * GoShortcuts — séquences G puis une lettre (G D, G M…), affichées dans la
 * palette Ctrl+J. Monté dans AppLayout : actif sur les pages de l'application
 * seulement (pas sur l'onboarding, dont les choix se font aussi par lettres,
 * ni sur les pages publiques).
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

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
const BLOCKING_ROLES = '[role="menu"], [role="listbox"], [role="combobox"], [role="grid"], [role="dialog"], [role="alertdialog"]';

function isTypingOrInMenu(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.isContentEditable) return true;
  if (el.closest('input, textarea, select, [contenteditable="true"]')) return true;
  return !!el.closest(BLOCKING_ROLES);
}

// Palette, tiroir de l'assistant, fenêtre de confirmation… : tout dialogue Radix ouvert.
function hasOpenDialog(): boolean {
  return !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');
}

export function GoShortcuts() {
  const navigate = useNavigate();

  // Écoute en capture pour que la seconde lettre ne déclenche pas aussi un
  // raccourci de page (ex. T = aujourd'hui au calendrier).
  useEffect(() => {
    let pendingSince = 0;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTypingOrInMenu(e.target) || hasOpenDialog()) {
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
