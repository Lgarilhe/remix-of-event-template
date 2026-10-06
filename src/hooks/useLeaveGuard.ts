/**
 * « Quitter sans enregistrer ? » pour l'éditeur unique de séquence (lot 5d-2).
 *
 * Tant que des modifications ne sont pas enregistrées :
 * - un lien de l'application (fil d'Ariane, barre latérale, « Inscrire des
 *   candidats »…) ne navigue pas tout de suite : la fenêtre le demande ;
 * - un changement d'onglet de la page passe par `request` ;
 * - un rechargement ou une fermeture de l'onglet du navigateur déclenche la
 *   demande du navigateur, après `onBeforeUnload` (le brouillon local est
 *   écrit tout de suite).
 * Les navigations que l'application ne voit pas passer (retour du
 * navigateur) gardent le brouillon local : rien n'est perdu.
 *
 * L'application utilise BrowserRouter (pas de routeur de données) :
 * useBlocker n'y existe pas, d'où l'écoute des clics sur les liens.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface LeaveGuardOptions {
  dirty: boolean;
  /** Avant le départ confirmé : abandon des modifications (brouillon effacé). */
  onDiscard: () => void;
  /** Avant un rechargement ou une fermeture : brouillon écrit tout de suite. */
  onBeforeUnload?: () => void;
}

export interface LeaveGuard {
  open: boolean;
  /** Geste qui quitte l'édition (changement d'onglet) : demandé s'il reste des modifications. */
  request: (action: () => void) => void;
  confirm: () => void;
  cancel: () => void;
}

export function useLeaveGuard({ dirty, onDiscard, onBeforeUnload }: LeaveGuardOptions): LeaveGuard {
  const navigate = useNavigate();
  const [pending, setPending] = useState<{ action: () => void } | null>(null);
  const callbacks = useRef({ onDiscard, onBeforeUnload });
  callbacks.current = { onDiscard, onBeforeUnload };

  useEffect(() => {
    if (!dirty) return;
    const onUnload = (event: BeforeUnloadEvent) => {
      callbacks.current.onBeforeUnload?.();
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      const to = `${url.pathname}${url.search}${url.hash}`;
      setPending({ action: () => navigate(to) });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [dirty, navigate]);

  const request = useCallback((action: () => void) => {
    if (dirty) setPending({ action });
    else action();
  }, [dirty]);

  const confirm = useCallback(() => {
    const next = pending;
    setPending(null);
    if (!next) return;
    callbacks.current.onDiscard();
    next.action();
  }, [pending]);

  const cancel = useCallback(() => setPending(null), []);

  return { open: !!pending, request, confirm, cancel };
}
