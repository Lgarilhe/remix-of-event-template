// Refonte mission, lot 2 : « Vos notes » dans l'Aperçu de la fiche candidat
// (conception 4.4, maquette FicheCandidat). Notes du candidat lues et écrites
// par useMissionCandidateDetail (notes, addNote, deleteNote), sans autre accès.
import { useId, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import type { CandidateNote } from '@/hooks/useMissionCandidateDetail';
import { shortDate } from './candidateAdapters';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';

export interface CandidateNotesSectionProps {
  notes: readonly CandidateNote[];
  loading: boolean;
  onAdd: (content: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function CandidateNotesSection({ notes, loading, onAdd, onDelete }: CandidateNotesSectionProps) {
  const headingId = useId();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const add = async () => {
    const content = draft.trim();
    if (!content || saving) return;
    setSaving(true);
    try {
      await onAdd(content);
      setDraft('');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setDeletingId(id);
    try {
      await onDelete(id);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
      <h3 id={headingId} className="text-md font-semibold text-foreground">
        Vos notes
      </h3>
      <Textarea
        aria-label="Nouvelle note"
        rows={2}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void add();
          }
        }}
        placeholder="Ajouter une note sur ce candidat"
        className="min-h-0 resize-none bg-card text-sm md:text-sm"
      />
      {draft.trim() !== '' && (
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => void add()}>
            {saving ? 'Enregistrement…' : 'Ajouter la note'}
          </Button>
        </div>
      )}
      {loading ? (
        <Skeleton className="h-14 w-full" aria-label="Chargement des notes" />
      ) : notes.length === 0 ? (
        <p className="text-xs text-muted-foreground">Aucune note pour l'instant.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notes.map((note) => (
            <li key={note.id} className="group flex items-start gap-2 rounded-lg bg-card py-2.5 pl-3 pr-1.5">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-xs tabular-nums text-muted-foreground">{shortDate(note.created_at)}</span>
                <span className="whitespace-pre-wrap break-words text-sm text-foreground">{note.content}</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Supprimer la note"
                title="Supprimer la note"
                disabled={deletingId === note.id}
                onClick={() => setConfirmId(note.id)}
                className="shrink-0 text-muted-foreground hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDeleteDialog
        open={confirmId !== null}
        title="Supprimer cette note ?"
        onCancel={() => setConfirmId(null)}
        onConfirm={() => {
          const id = confirmId;
          setConfirmId(null);
          if (id) void remove(id);
        }}
      />
    </section>
  );
}
