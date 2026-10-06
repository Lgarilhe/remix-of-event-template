import React, { useState } from 'react';
import { StickyNote, Plus, Trash2 } from 'lucide-react';
import { AiTextarea } from '@/components/ai/AiTextarea';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/layout/EmptyState';
import { REVEAL_ON_ROW } from '@/components/missions/v3/cadrage/sectionUi';
import { CandidateCommentsTab } from '../CandidateCommentsTab';
import { CenteredLoader } from './shared';

interface Note {
  id: string;
  content: string;
  created_at: string;
  created_by: string;
}

type NoteMode = 'team' | 'personal';

interface NotesTabProps {
  candidateId: string;
  candidateName: string;
  jobId: string | null;
  notes: Note[];
  loading: boolean;
  onAddNote: (content: string) => Promise<void>;
  onDeleteNote: (id: string) => Promise<void>;
}

export const NotesTab = React.memo<NotesTabProps>(({ candidateId, candidateName, jobId, notes, loading, onAddNote, onDeleteNote }) => {
  const [noteMode, setNoteMode] = useState<NoteMode>('team');
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  const handleAdd = async () => {
    if (!newNote.trim()) return;
    setAddingNote(true);
    try {
      await onAddNote(newNote.trim());
      setNewNote('');
    } finally {
      setAddingNote(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Commentaires d'équipe ou notes personnelles */}
      <SegmentedControl<NoteMode>
        aria-label="Visibilité des notes"
        value={noteMode}
        onValueChange={setNoteMode}
        options={[
          { value: 'team', label: 'Équipe', title: 'Commentaires de l\'équipe' },
          { value: 'personal', label: 'Perso', title: 'Notes personnelles' },
        ]}
      />

      {noteMode === 'team' ? (
        <CandidateCommentsTab
          candidateId={candidateId}
          candidateName={candidateName}
          jobId={jobId}
        />
      ) : (
        <div className="space-y-5">
          <div>
            <AiTextarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Écrire une note (tapez /ai pour les commandes de l'assistant)"
              aria-label="Nouvelle note personnelle"
              className="min-h-[72px] resize-none text-sm"
              context={{
                purpose: 'note candidat',
                data: { candidate_name: candidateName, candidate_id: candidateId, job_id: jobId },
                tone: 'concise',
              }}
            />
            <div className="mt-2 flex justify-end">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleAdd}
                loading={addingNote}
                disabled={!newNote.trim()}
              >
                {!addingNote && <Plus aria-hidden="true" />}
                Ajouter la note
              </Button>
            </div>
          </div>
          {loading ? (
            <CenteredLoader />
          ) : notes.length === 0 ? (
            <EmptyState
              className="border-0 py-6"
              variant="compact"
              icon={StickyNote}
              title="Aucune note personnelle"
              description="Ajoutez une note pour garder une trace de ce candidat."
            />
          ) : (
            <ul className="divide-y divide-border">
              {notes.map(note => (
                <li key={note.id} className="group flex items-start justify-between gap-2 py-3 first:pt-0">
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{note.content}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDistanceToNow(parseISO(note.created_at), { addSuffix: true, locale: fr })}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onDeleteNote(note.id)}
                    aria-label="Supprimer la note"
                    title="Supprimer la note"
                    className={cn('shrink-0 text-muted-foreground hover:bg-danger-muted hover:text-danger', REVEAL_ON_ROW)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
});

NotesTab.displayName = 'NotesTab';
