/**
 * GlobalTaskShortcut — composant à monter une fois dans AppLayout pour
 * permettre la création rapide d'une tâche depuis n'importe quelle page,
 * via l'action « Nouvelle tâche » de la palette Ctrl+J (événement
 * konekt:new-task).
 *
 * Ctrl+T / Cmd+T reste au navigateur (nouvel onglet) : Chrome ne transmet
 * de toute façon pas cette touche à la page.
 */

import React, { useEffect, useState } from 'react';
import { CreateTaskModal } from './CreateTaskModal';

export const GlobalTaskShortcut: React.FC = () => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const openModal = () => setOpen(true);
    window.addEventListener('konekt:new-task', openModal);
    return () => window.removeEventListener('konekt:new-task', openModal);
  }, []);

  return <CreateTaskModal open={open} onOpenChange={setOpen} />;
};
