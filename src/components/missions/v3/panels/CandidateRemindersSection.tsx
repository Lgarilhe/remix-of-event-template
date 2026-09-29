// Refonte mission, lot 2 : « Rappels » dans l'Aperçu de la fiche candidat
// (conception 4.4). Rappels du candidat lus et écrits par
// useMissionCandidateDetail (reminders, addReminder, deleteReminder).
import { useId, useState } from 'react';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CandidateReminder } from '@/hooks/useMissionCandidateDetail';
import { cn } from '@/lib/utils';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';

export interface CandidateRemindersSectionProps {
  reminders: readonly CandidateReminder[];
  onAdd: (title: string, date: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function dueText(iso: string): { date: string; relative: string | null } {
  try {
    const d = parseISO(iso);
    if (Number.isNaN(d.getTime())) return { date: iso, relative: null };
    return {
      date: format(d, "d MMM yyyy 'à' HH:mm", { locale: fr }),
      relative: formatDistanceToNow(d, { addSuffix: true, locale: fr }),
    };
  } catch {
    return { date: iso, relative: null };
  }
}

export function CandidateRemindersSection({ reminders, onAdd, onDelete }: CandidateRemindersSectionProps) {
  const headingId = useId();
  const titleId = useId();
  const dateId = useId();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const canSave = title.trim() !== '' && date !== '' && !saving;

  const add = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onAdd(title.trim(), date);
      setTitle('');
      setDate('');
      setOpen(false);
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
        Rappels
      </h3>
      {reminders.length === 0 && !open && <p className="text-xs text-muted-foreground">Aucun rappel pour l'instant.</p>}
      {reminders.length > 0 && (
        <ul className="flex flex-col gap-2">
          {reminders.map((reminder) => {
            const due = dueText(reminder.due_at);
            const done = reminder.completed_at !== null;
            return (
              <li
                key={reminder.id}
                className={cn('flex items-start gap-2 rounded-lg bg-card py-2.5 pl-3 pr-1.5', done && 'opacity-60')}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={cn('break-words text-sm text-foreground', done && 'line-through')}>{reminder.title}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {due.date}
                    {!done && due.relative ? ` · ${due.relative}` : ''}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Supprimer le rappel"
                  title="Supprimer le rappel"
                  disabled={deletingId === reminder.id}
                  onClick={() => setConfirmId(reminder.id)}
                  className="shrink-0 text-muted-foreground opacity-60 hover:text-danger hover:opacity-100 focus-visible:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {open ? (
        <div role="group" aria-label="Nouveau rappel" className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
          <label htmlFor={titleId} className="text-xs text-muted-foreground">
            Objet du rappel
          </label>
          <Input
            id={titleId}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Relancer après l'entretien"
            className="h-8 text-sm md:text-sm"
            autoFocus
          />
          <label htmlFor={dateId} className="text-xs text-muted-foreground">
            Date et heure
          </label>
          <Input
            id={dateId}
            type="datetime-local"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="h-8 text-sm md:text-sm"
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={!canSave} onClick={() => void add()}>
              {saving ? 'Enregistrement…' : 'Créer le rappel'}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            Ajouter un rappel
          </Button>
        </div>
      )}
      <ConfirmDeleteDialog
        open={confirmId !== null}
        title="Supprimer ce rappel ?"
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
