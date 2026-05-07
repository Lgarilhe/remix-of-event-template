/**
 * GlobalTaskShortcut — composant à monter une fois dans AppLayout pour
 * permettre la création rapide d'une tâche depuis n'importe quelle page
 * via Cmd+T (Mac) / Ctrl+T (Windows/Linux).
 *
 * Pattern Linear / Notion : raccourci global pour les actions fréquentes.
 *
 * Note : Ctrl+T est normalement réservé "nouvel onglet" navigateur. On le
 * laisse en dehors de la table active dans un input/textarea (sinon ça
 * coupe la saisie) et on event.preventDefault() pour bloquer le comportement
 * navigateur. Sur Mac, Cmd+T fait pareil par défaut, on le bloque pareil.
 */

import React, { useEffect, useState } from 'react';
import { CreateTaskModal } from './CreateTaskModal';

export const GlobalTaskShortcut: React.FC = () => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      // Cmd+T sur Mac, Ctrl+T sur Windows/Linux
      const isMac = /Mac/.test(navigator.platform);
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
      if (cmdOrCtrl && e.key.toLowerCase() === 't') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return <CreateTaskModal open={open} onOpenChange={setOpen} />;
};
