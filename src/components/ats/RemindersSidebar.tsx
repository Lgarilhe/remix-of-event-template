/**
 * Panneau « Rappels » du pipeline global : un panneau latéral (Sheet), plein
 * écran sous 768 px, au lieu d'une colonne insérée à côté des colonnes
 * (revue design E-21). Une lecture en échec s'affiche comme une erreur avec
 * « Réessayer », jamais comme une liste vide (E-44).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, isPast, isToday, isTomorrow, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Bell, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { EmptyState, ErrorState } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface Reminder {
  id: string;
  candidate_id: string;
  candidate_name: string | null;
  job_id: string | null;
  job_title: string | null;
  title: string;
  description: string | null;
  due_at: string;
  completed_at: string | null;
  created_at: string;
}

interface RemindersSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReminderClick: (candidateId: string) => void;
}

/** « Aujourd'hui à 14:30 », « Demain à 9:00 », « 22 sept. à 11:29 » (comme la page Tâches). */
function dueLabelOf(dueAt: string): string {
  try {
    const d = parseISO(dueAt);
    const time = format(d, 'HH:mm');
    if (isToday(d)) return `Aujourd'hui à ${time}`;
    if (isTomorrow(d)) return `Demain à ${time}`;
    return format(d, "d MMM 'à' HH:mm", { locale: fr });
  } catch {
    return 'Date inconnue';
  }
}

export const RemindersSidebar: React.FC<RemindersSidebarProps> = ({ open, onOpenChange, onReminderClick }) => {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);

  const fetchReminders = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      let query = supabase
        .from('candidate_reminders')
        .select('*')
        .order('due_at', { ascending: true });

      if (!showCompleted) {
        query = query.is('completed_at', null);
      }

      const { data, error } = await query;

      if (error) throw error;
      setReminders(data || []);
    } catch (error) {
      console.error('Error fetching reminders:', error);
      setLoadError(error instanceof Error ? error.message : 'Lecture des rappels impossible');
    } finally {
      setLoading(false);
    }
  }, [showCompleted]);

  useEffect(() => {
    if (open) void fetchReminders();
  }, [open, fetchReminders]);

  const toggleComplete = async (reminder: Reminder) => {
    try {
      const newCompletedAt = reminder.completed_at ? null : new Date().toISOString();

      const { error } = await supabase
        .from('candidate_reminders')
        .update({ completed_at: newCompletedAt })
        .eq('id', reminder.id);

      if (error) throw error;

      setReminders(prev => prev.map(r =>
        r.id === reminder.id ? { ...r, completed_at: newCompletedAt } : r
      ));

      toast.success(
        newCompletedAt
          ? `Rappel «\u00a0${reminder.title}\u00a0» marqué comme fait`
          : `Rappel «\u00a0${reminder.title}\u00a0» rouvert`,
      );
    } catch (error) {
      console.error('Error updating reminder:', error);
      toast.error("Le rappel n'a pas pu être mis à jour. Réessayez.");
    }
  };

  const completedId = 'reminders-show-completed';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full max-w-none flex-col gap-0 p-0 md:max-w-sm">
        <SheetHeader className="space-y-1 border-b border-border px-5 py-4 pr-14 text-left">
          <SheetTitle>Rappels</SheetTitle>
          <SheetDescription>Les rappels posés sur vos candidats, par échéance.</SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <Checkbox
            id={completedId}
            checked={showCompleted}
            onCheckedChange={(checked) => setShowCompleted(checked === true)}
          />
          <label htmlFor={completedId} className="cursor-pointer text-sm text-foreground-secondary">
            Afficher les rappels terminés
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="space-y-2" role="status" aria-label="Chargement des rappels">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex gap-3 rounded-lg border border-border p-3">
                  <Skeleton className="h-4 w-4 shrink-0 rounded-sm" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4 rounded-sm" />
                    <Skeleton className="h-3 w-1/2 rounded-sm" />
                    <Skeleton className="h-3 w-1/3 rounded-sm" />
                  </div>
                </div>
              ))}
            </div>
          ) : loadError ? (
            <ErrorState
              variant="compact"
              title="Impossible de charger les rappels"
              description="Vérifiez votre connexion, puis réessayez. Vos rappels ne sont pas perdus."
              detail={loadError}
              onRetry={() => void fetchReminders()}
            />
          ) : reminders.length === 0 ? (
            <EmptyState
              variant="compact"
              icon={Bell}
              title={showCompleted ? 'Aucun rappel' : 'Aucun rappel en attente'}
              description={"Posez un rappel depuis la fiche d'un candidat\u00a0: il apparaîtra ici et dans vos tâches."}
              action={
                <Button asChild variant="outline" size="sm">
                  <Link to="/tasks">Ouvrir les tâches</Link>
                </Button>
              }
            />
          ) : (
            <ul className="space-y-2">
              {reminders.map(reminder => {
                const isCompleted = !!reminder.completed_at;
                const due = parseISO(reminder.due_at);
                const overdue = !isCompleted && isPast(due) && !isToday(due);
                return (
                  <li key={reminder.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
                    <Checkbox
                      checked={isCompleted}
                      onCheckedChange={() => toggleComplete(reminder)}
                      aria-label={isCompleted ? `Rouvrir le rappel « ${reminder.title} »` : `Marquer le rappel « ${reminder.title} » comme fait`}
                      className="mt-0.5 after:absolute after:-inset-3.5 relative"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onReminderClick(reminder.candidate_id)}
                      className="block h-auto min-w-0 flex-1 whitespace-normal rounded-md p-0 text-left font-normal hover:bg-transparent active:scale-100 [&_svg]:size-3"
                    >
                      <span className={cn('block text-sm font-medium', isCompleted ? 'text-muted-foreground line-through' : 'text-foreground')}>
                        {reminder.title}
                      </span>
                      {(reminder.candidate_name || reminder.job_title) && (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {[reminder.candidate_name, reminder.job_title].filter(Boolean).join(' · ')}
                        </span>
                      )}
                      <span
                        className={cn(
                          'mt-1.5 inline-flex items-center gap-1 text-xs tabular-nums',
                          overdue ? 'font-medium text-danger' : 'text-muted-foreground',
                        )}
                      >
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        {overdue && 'En retard · '}
                        {dueLabelOf(reminder.due_at)}
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
