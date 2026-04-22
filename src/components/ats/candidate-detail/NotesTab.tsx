import React, { useState } from 'react';
import { StickyNote, Plus, Trash2, Loader2 } from 'lucide-react';
import { AiTextarea } from '@/components/ai/AiTextarea';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { EmptyState as EmptyStateUI } from '@/components/ui/EmptyState';
import { CandidateCommentsTab } from '../CandidateCommentsTab';
import { CenteredLoader } from './shared';

interface Note {
  id: string;
  content: string;
  created_at: string;
  created_by: string;
}

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
  const [noteMode, setNoteMode] = useState<'team' | 'personal'>('team');
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
    <div className="space-y-4">
      {/* Toggle team / personal */}
      <div className="flex gap-0">
        <button
          onClick={() => setNoteMode('team')}
          className={cn(
            "flex-1 py-2 text-xs font-bold uppercase tracking-wider border border-border transition-colors",
            noteMode === 'team' ? 'bg-foreground text-background' : 'text-foreground hover:bg-accent/50'
          )}
        >
          💬 Équipe
        </button>
        <button
          onClick={() => setNoteMode('personal')}
          className={cn(
            "flex-1 py-2 text-xs font-bold uppercase tracking-wider border border-border -ml-px transition-colors",
            noteMode === 'personal' ? 'bg-foreground text-background' : 'text-foreground hover:bg-accent/50'
          )}
        >
          📝 Perso
        </button>
      </div>

      {noteMode === 'team' ? (
        <CandidateCommentsTab
          candidateId={candidateId}
          candidateName={candidateName}
          jobId={jobId}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex gap-0">
            <AiTextarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Ajouter une note personnelle... (tape /ai pour les commandes IA)"
              className="flex-1 min-h-[60px] rounded-lg border-border text-sm resize-none pr-10"
              context={{
                purpose: 'note candidat',
                data: { candidate_name: candidateName, candidate_id: candidateId, job_id: jobId },
                tone: 'concise',
              }}
            />
            <button onClick={handleAdd} disabled={addingNote || !newNote.trim()}
              className="h-auto px-4 border border-border -ml-px bg-foreground text-background text-xs font-medium uppercase tracking-wider disabled:opacity-50">
              {addingNote ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            </button>
          </div>
          {loading ? (
            <CenteredLoader />
          ) : notes.length === 0 ? (
            <EmptyStateUI icon={<StickyNote className="w-7 h-7" />} title="Aucune note personnelle" description="" compact />
          ) : (
            <div className="space-y-2">
              {notes.map(note => (
                <div key={note.id} className="group p-3 border border-border bg-foreground/[0.02]">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-foreground whitespace-pre-wrap flex-1">{note.content}</p>
                    <button onClick={() => onDeleteNote(note.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-1">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {formatDistanceToNow(parseISO(note.created_at), { addSuffix: true, locale: fr })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

NotesTab.displayName = 'NotesTab';
