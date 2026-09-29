// Refonte mission, lot 1 : confirmation de l'archivage d'une mission
// (conception, 3.2 : absente aujourd'hui de la Configuration). Le toast de
// succès suit l'écriture ; une erreur est annoncée par le hook de mise à jour
// (useSourcingProjects), et la fenêtre reste ouverte pour réessayer ou annuler.
import { useState } from 'react';
import type React from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useSourcingProjects } from '@/hooks/useSourcingProjects';

interface ArchiveMissionDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ArchiveMissionDialog({ projectId, open, onOpenChange }: ArchiveMissionDialogProps) {
  const { updateProject } = useSourcingProjects();
  const [saving, setSaving] = useState(false);

  const handleConfirm = async (event: React.MouseEvent<HTMLButtonElement>) => {
    // La fenêtre reste ouverte pendant l'écriture : rien n'est annoncé avant la réponse.
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await updateProject({ id: projectId, status: 'archived' });
      toast.success('Mission archivée.');
      onOpenChange(false);
    } catch {
      // Erreur déjà annoncée par useSourcingProjects ; rien d'autre ne change.
    } finally {
      setSaving(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archiver cette mission ?</AlertDialogTitle>
          <AlertDialogDescription>
            Elle quitte vos missions en cours. Ses candidats et ses séquences sont gardés, et vous pourrez la
            réactiver.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Annuler</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={handleConfirm} disabled={saving} aria-busy={saving}>
            {saving ? 'Archivage…' : 'Archiver'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
