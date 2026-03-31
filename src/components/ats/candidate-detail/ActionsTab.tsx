import React, { useState } from 'react';
import { Brain, FileText, Send, Target, Bell, Plus, Trash2, Loader2, Calendar } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { EmptyState as EmptyStateUI } from '@/components/ui/EmptyState';

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
}

export const ActionsTab = React.memo<ActionsTabProps>(({ reminders, onAddReminder, onDeleteReminder, onOpenAgent, candidateLinkedin }) => {
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
    <div className="space-y-6">
      {/* Quick AI actions */}
      <div>
        <h4 className="text-xs font-bold uppercase tracking-wider text-foreground mb-3">Actions IA</h4>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onOpenAgent}
            className="border border-foreground/10 hover:border-foreground/40 p-3 text-left transition-all duration-150 hover:bg-muted/50 active:scale-[0.97] group"
          >
            <Brain className="w-4 h-4 text-muted-foreground group-hover:text-brutal-accent transition-colors" />
            <p className="text-xs font-bold uppercase tracking-wider text-foreground mt-2">Résumé IA</p>
            <p className="text-xs text-muted-foreground mt-0.5">Générer un résumé du candidat</p>
          </button>
          <button
            onClick={onOpenAgent}
            className="border border-foreground/10 hover:border-foreground/40 p-3 text-left transition-all duration-150 hover:bg-muted/50 active:scale-[0.97] group"
          >
            <FileText className="w-4 h-4 text-muted-foreground group-hover:text-brutal-accent transition-colors" />
            <p className="text-xs font-bold uppercase tracking-wider text-foreground mt-2">Brief client</p>
            <p className="text-xs text-muted-foreground mt-0.5">Préparer une présentation</p>
          </button>
          <button
            onClick={() => { window.location.href = '/missions?tab=messages'; }}
            className="border border-foreground/10 hover:border-foreground/40 p-3 text-left transition-all duration-150 hover:bg-muted/50 active:scale-[0.97] group"
          >
            <Send className="w-4 h-4 text-muted-foreground group-hover:text-brutal-accent transition-colors" />
            <p className="text-xs font-bold uppercase tracking-wider text-foreground mt-2">Messagerie</p>
            <p className="text-xs text-muted-foreground mt-0.5">Ouvrir la messagerie</p>
          </button>
          {candidateLinkedin && (
            <button
              onClick={() => { window.location.href = `/missions?tab=search&score=${encodeURIComponent(candidateLinkedin)}`; }}
              className="border border-foreground/10 hover:border-foreground/40 p-3 text-left transition-all duration-150 hover:bg-muted/50 active:scale-[0.97] group"
            >
              <Target className="w-4 h-4 text-muted-foreground group-hover:text-brutal-accent transition-colors" />
              <p className="text-xs font-bold uppercase tracking-wider text-foreground mt-2">Scoring</p>
              <p className="text-xs text-muted-foreground mt-0.5">Analyser le profil</p>
            </button>
          )}
        </div>
      </div>

      {/* Reminders */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">Rappels</h4>
          <button onClick={() => setShowNewReminder(!showNewReminder)}
            className="text-xs font-medium text-foreground hover:text-brutal-accent flex items-center gap-1">
            <Plus className="w-3 h-3" /> Ajouter
          </button>
        </div>

        {showNewReminder && (
          <div className="space-y-2 mb-4 p-3 border border-foreground/15 bg-foreground/[0.02]">
            <Input
              value={newReminderTitle}
              onChange={(e) => setNewReminderTitle(e.target.value)}
              placeholder="Titre du rappel..."
              className="rounded-none border-foreground/30 h-8 text-sm"
            />
            <Input
              type="datetime-local"
              value={newReminderDate}
              onChange={(e) => setNewReminderDate(e.target.value)}
              className="rounded-none border-foreground/30 h-8 text-sm"
            />
            <button onClick={handleAdd} disabled={addingReminder || !newReminderTitle.trim() || !newReminderDate}
              className="w-full h-8 bg-foreground text-background text-xs font-bold uppercase tracking-wider disabled:opacity-50">
              {addingReminder ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : 'Créer le rappel'}
            </button>
          </div>
        )}

        {reminders.length === 0 ? (
          <EmptyStateUI icon={<Bell className="w-7 h-7" />} title="Aucun rappel" description="" compact />
        ) : (
          <div className="space-y-2">
            {reminders.map(r => (
              <div key={r.id} className={cn(
                "group flex items-start gap-3 p-3 border transition-colors",
                r.completed_at ? 'border-foreground/10 opacity-50' : 'border-foreground/20'
              )}>
                <Calendar className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className={cn("text-sm font-medium text-foreground", r.completed_at && 'line-through')}>{r.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {format(parseISO(r.due_at), 'd MMM yyyy à HH:mm', { locale: fr })}
                    {!r.completed_at && (
                      <span className="ml-2 text-brutal-accent font-medium">
                        {formatDistanceToNow(parseISO(r.due_at), { addSuffix: true, locale: fr })}
                      </span>
                    )}
                  </p>
                </div>
                <button onClick={() => onDeleteReminder(r.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-1">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

ActionsTab.displayName = 'ActionsTab';
