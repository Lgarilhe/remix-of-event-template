import React, { useState } from 'react';
import { Brain, FileText, Send, Target, Bell, Plus, Trash2, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/layout/EmptyState';
import { HEADER_ACTION_BORDER } from '@/components/outreach/result-card/headerActions';
import { REVEAL_ON_ROW } from '@/components/missions/v3/cadrage/sectionUi';

interface Reminder {
  id: string;
  title: string;
  description: string | null;
  due_at: string;
  completed_at: string | null;
}

interface ActionsTabProps {
  reminders: Reminder[];
  onAddReminder: (title: string, date: string) => Promise<void>;
  onDeleteReminder: (id: string) => Promise<void>;
  onOpenAgent: () => void;
  candidateLinkedin?: string | null;
  /** Masque les raccourcis Messagerie et Scoring (liens vers d'autres pages). */
  hideNavigationShortcuts?: boolean;
}

/** Une action de l'assistant : une ligne avec son icône, son verbe et ce qu'elle produit. */
const ShortcutRow: React.FC<{
  icon: React.ElementType;
  label: string;
  hint: string;
  onClick: () => void;
}> = ({ icon: Icon, label, hint, onClick }) => (
  <li>
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-11"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-foreground-secondary">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-sm text-muted-foreground">{hint}</span>
      </span>
    </button>
  </li>
);

export const ActionsTab = React.memo<ActionsTabProps>(({ reminders, onAddReminder, onDeleteReminder, onOpenAgent, candidateLinkedin, hideNavigationShortcuts = false }) => {
  const [showNewReminder, setShowNewReminder] = useState(false);
  const [newReminderTitle, setNewReminderTitle] = useState('');
  const [newReminderDate, setNewReminderDate] = useState('');
  const [addingReminder, setAddingReminder] = useState(false);

  const handleAdd = async () => {
    if (!newReminderTitle.trim() || !newReminderDate) return;
    setAddingReminder(true);
    try {
      await onAddReminder(newReminderTitle.trim(), newReminderDate);
      setNewReminderTitle('');
      setNewReminderDate('');
      setShowNewReminder(false);
    } finally {
      setAddingReminder(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Actions de l'assistant */}
      <section aria-labelledby="candidate-actions-ai">
        <h4 id="candidate-actions-ai" className="eyebrow mb-2">Assistant</h4>
        <ul className="-mx-2">
          <ShortcutRow icon={Brain} label="Générer un résumé" hint="Synthèse du candidat par l'assistant" onClick={onOpenAgent} />
          <ShortcutRow icon={FileText} label="Préparer un brief client" hint="Présentation du candidat à envoyer au client" onClick={onOpenAgent} />
          {!hideNavigationShortcuts && (
            <ShortcutRow
              icon={Send}
              label="Ouvrir la messagerie"
              hint="Reprendre la conversation avec ce candidat"
              onClick={() => { window.location.href = '/missions?tab=messages'; }}
            />
          )}
          {!hideNavigationShortcuts && candidateLinkedin && (
            <ShortcutRow
              icon={Target}
              label="Analyser le profil"
              hint="Calculer la note du candidat pour une mission"
              onClick={() => { window.location.href = `/missions?tab=search&score=${encodeURIComponent(candidateLinkedin)}`; }}
            />
          )}
        </ul>
      </section>

      {/* Rappels */}
      <section aria-labelledby="candidate-actions-reminders">
        <div className="mb-2 flex items-center justify-between">
          <h4 id="candidate-actions-reminders" className="eyebrow">Rappels</h4>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowNewReminder(!showNewReminder)}
            aria-expanded={showNewReminder}
            className={HEADER_ACTION_BORDER}
          >
            <Plus aria-hidden="true" />
            Ajouter un rappel
          </Button>
        </div>

        {showNewReminder && (
          <div className="mb-3 space-y-2 rounded-lg bg-muted p-3">
            <Input
              value={newReminderTitle}
              onChange={(e) => setNewReminderTitle(e.target.value)}
              placeholder="Exemple : relancer après l'entretien"
              aria-label="Titre du rappel"
            />
            <Input
              type="datetime-local"
              value={newReminderDate}
              onChange={(e) => setNewReminderDate(e.target.value)}
              aria-label="Date du rappel"
            />
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowNewReminder(false)}>
                Annuler
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleAdd}
                loading={addingReminder}
                disabled={!newReminderTitle.trim() || !newReminderDate}
              >
                Créer le rappel
              </Button>
            </div>
          </div>
        )}

        {reminders.length === 0 ? (
          !showNewReminder && (
            <EmptyState
              className="border-0 py-6"
              variant="compact"
              icon={Bell}
              title="Aucun rappel"
              description="Programmez un rappel pour ne pas laisser ce candidat sans réponse."
            />
          )
        ) : (
          <ul className="divide-y divide-border">
            {reminders.map(r => (
              <li key={r.id} className={cn('group flex items-start gap-3 py-3', r.completed_at && 'opacity-60')}>
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-foreground-secondary">
                  <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm font-medium text-foreground', r.completed_at && 'line-through')}>{r.title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {format(parseISO(r.due_at), "d MMM yyyy 'à' HH:mm", { locale: fr })}
                    {!r.completed_at && (
                      <span className="text-foreground-secondary">
                        {' · '}
                        {formatDistanceToNow(parseISO(r.due_at), { addSuffix: true, locale: fr })}
                      </span>
                    )}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onDeleteReminder(r.id)}
                  aria-label={`Supprimer le rappel « ${r.title} »`}
                  title="Supprimer le rappel"
                  className={cn('shrink-0 text-muted-foreground hover:bg-danger-muted hover:text-danger', REVEAL_ON_ROW)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
});

ActionsTab.displayName = 'ActionsTab';
