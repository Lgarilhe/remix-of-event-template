// Menu « ... » de la page d'une séquence (lot 5c-2) : « Dupliquer » (copie
// nommée « Copie de … »), « Enregistrer comme modèle », « Envoyer les actions
// du jour » pour cette séquence (confirmation actuelle), « Diagnostic des
// envois » (carte « État de l'envoi » du Journal), « Raccourcis clavier » et
// « Supprimer » derrière « Supprimer cette séquence ? ». Les gestes sont ceux
// de la liste des séquences (src/lib/sequenceActions.ts).
import { useState } from 'react';
import { Activity, Copy, FastForward, FileText, Keyboard, MoreHorizontal, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { KeyboardShortcutsDialog } from '@/components/sidebar/KeyboardShortcutsDialog';
import { SaveAsTemplateModal } from '@/components/outreach/SaveAsTemplateModal';
import { plural } from '@/lib/plural';
import type { SequenceWithStats } from '@/lib/sequenceActions';

interface SequenceMenuProps {
  sequence: SequenceWithStats;
  canManage: boolean;
  canEdit: boolean;
  /** Compteurs d'inscriptions illisibles : la fenêtre de suppression ne cite pas de nombre. */
  countsUnavailable: boolean;
  duplicating: boolean;
  nudging: boolean;
  onDuplicate: () => void;
  onNudge: () => void;
  onShowDiagnostic: () => void;
  onDelete: () => void;
}

const NUDGE_HELP = 'Avance à maintenant les actions prévues plus tard aujourd’hui, sauf les invitations LinkedIn. Elles partent progressivement pendant vos heures d’envoi.';

export function SequenceMenu({
  sequence, canManage, canEdit, countsUnavailable, duplicating, nudging,
  onDuplicate, onNudge, onShowDiagnostic, onDelete,
}: SequenceMenuProps) {
  const [templateOpen, setTemplateOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [nudgeOpen, setNudgeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const total = sequence.enrollments.total;
  const canNudge = canManage && sequence.is_active;

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Plus d’actions sur la séquence" className="text-muted-foreground hover:text-foreground max-md:h-11 max-md:w-11">
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Plus d’actions</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-64">
          {canManage && (
            <DropdownMenuItem disabled={duplicating} onSelect={onDuplicate} className="gap-2 max-md:min-h-11">
              <Copy className="h-4 w-4" aria-hidden="true" />
              {duplicating ? 'Duplication…' : 'Dupliquer'}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setTemplateOpen(true)} className="gap-2 max-md:min-h-11">
            <FileText className="h-4 w-4" aria-hidden="true" />
            Enregistrer comme modèle
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canNudge || nudging}
            onSelect={() => setNudgeOpen(true)}
            className="items-start gap-2 max-md:min-h-11"
          >
            <FastForward className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex min-w-0 flex-col">
              <span>{nudging ? 'En cours…' : 'Envoyer les actions du jour'}</span>
              {!sequence.is_active && <span className="whitespace-normal text-xs text-muted-foreground">Séquence en pause : rien à avancer.</span>}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onShowDiagnostic} className="gap-2 max-md:min-h-11">
            <Activity className="h-4 w-4" aria-hidden="true" />
            Diagnostic des envois
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setShortcutsOpen(true)} className="gap-2 max-md:min-h-11">
            <Keyboard className="h-4 w-4" aria-hidden="true" />
            Raccourcis clavier
          </DropdownMenuItem>
          {canEdit && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setDeleteOpen(true)} className="gap-2 text-destructive focus:text-destructive max-md:min-h-11">
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Supprimer
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {templateOpen && (
        <SaveAsTemplateModal
          isOpen={templateOpen}
          onClose={() => setTemplateOpen(false)}
          sequenceId={sequence.id}
          sequenceName={sequence.name}
          steps={sequence.steps}
        />
      )}

      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      {/* « Envoyer les actions du jour » déclenche des envois : confirmation actuelle. */}
      <AlertDialog open={nudgeOpen} onOpenChange={setNudgeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Envoyer maintenant les actions du jour ?</AlertDialogTitle>
            <AlertDialogDescription>
              {NUDGE_HELP} Seulement pour cette séquence ; les relances des jours suivants gardent leur date.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={onNudge}>Envoyer maintenant</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Suppression : nombre d'inscrits touchés et perte de l'anti-doublon de 90 jours. */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette séquence ?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {!countsUnavailable && total > 0 ? (
                  <p>
                    {plural(total, 'candidat y est inscrit', 'candidats y sont inscrits')}. Leurs envois à venir
                    sont annulés, et Konekt ne pourra plus s’en servir pour éviter de les recontacter dans les 90 jours.
                  </p>
                ) : (
                  <p>Ses étapes et son historique d’envoi sont supprimés.</p>
                )}
                {!sequence.project_id && (
                  <p className="font-medium text-foreground">Cette séquence est partagée entre toutes vos missions : elle disparaîtra partout.</p>
                )}
                <p>Cette action est irréversible. Préférez la mise en pause de la séquence pour garder cette protection.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} className="bg-destructive hover:bg-destructive/90">
              Supprimer définitivement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
