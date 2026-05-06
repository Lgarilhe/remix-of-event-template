/**
 * Tasks — page globale des rappels/tâches.
 *
 * Agrège tous les `candidate_reminders` en une vue centralisée. Regroupe par
 * urgence (En retard / Aujourd'hui / Cette semaine / Plus tard / Terminés).
 * Permet de cocher, supprimer et cliquer pour aller au candidat lié.
 *
 * V2 (mai 2026) : refonte design — passage du brutalism (border-border sharp,
 * font-mono uppercase, bg-foreground active) au V2 (rounded-xl, font-display,
 * icon-tiles vert clair, segmented control rounded-full).
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { SEOHead } from '@/components/SEOHead';
import { useAllReminders, type Reminder, type ReminderBucket } from '@/hooks/useAllReminders';
import { Checkbox } from '@/components/ui/checkbox';
import {
  CheckSquare,
  Bell,
  Clock,
  CheckCircle2,
  AlertCircle,
  CalendarDays,
  RefreshCw,
  Trash2,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { PageLayout } from '@/components/layout';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useCountUp } from '@/hooks/useCountUp';

const BUCKET_META: Record<ReminderBucket, {
  label: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  hint: string;
}> = {
  overdue: {
    label: 'En retard',
    icon: AlertCircle,
    iconColor: 'text-destructive',
    iconBg: 'bg-destructive/10',
    hint: 'À traiter en priorité',
  },
  today: {
    label: "Aujourd'hui",
    icon: Clock,
    iconColor: 'text-warning',
    iconBg: 'bg-warning/10',
    hint: 'À traiter aujourd\'hui',
  },
  week: {
    label: 'Cette semaine',
    icon: CalendarDays,
    iconColor: 'text-info',
    iconBg: 'bg-info/10',
    hint: 'Dans les 7 jours',
  },
  later: {
    label: 'Plus tard',
    icon: Bell,
    iconColor: 'text-foreground',
    iconBg: 'bg-emerald-500/15',
    hint: 'Au-delà de cette semaine',
  },
  done: {
    label: 'Terminées',
    icon: CheckCircle2,
    iconColor: 'text-success',
    iconBg: 'bg-success/10',
    hint: 'Tâches archivées',
  },
};

const KPICard: React.FC<{
  bucket: ReminderBucket;
  count: number;
  index: number;
}> = ({ bucket, count, index }) => {
  const meta = BUCKET_META[bucket];
  const Icon = meta.icon;
  const animVal = useCountUp(count, { duration: 700 });
  const isAlert = bucket === 'overdue' && count > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut', delay: index * 0.05 }}
      className={cn(
        'rounded-xl border p-4 transition-colors',
        isAlert
          ? 'bg-destructive/[0.04] border-destructive/20'
          : 'bg-card border-border',
      )}
    >
      <div className="flex items-center gap-3 mb-3">
        <div
          className={cn(
            'h-9 w-9 rounded-lg flex items-center justify-center shrink-0',
            count > 0 ? meta.iconBg : 'bg-emerald-500/15',
          )}
        >
          <Icon
            className={cn('w-4 h-4', count > 0 ? meta.iconColor : 'text-foreground')}
            aria-hidden="true"
          />
        </div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          {meta.label}
        </span>
      </div>
      <div className="font-display text-2xl font-bold text-foreground tabular-nums tracking-tight leading-none">
        {animVal}
      </div>
      <div className="text-xs text-muted-foreground mt-1.5">{meta.hint}</div>
    </motion.div>
  );
};

export default function TasksPage() {
  const navigate = useNavigate();
  const { grouped, counts, isLoading, refetch, toggleComplete, deleteReminder } = useAllReminders();
  const [view, setView] = useState<'active' | 'all'>('active');

  const visibleBuckets: ReminderBucket[] = view === 'active'
    ? ['overdue', 'today', 'week', 'later']
    : ['overdue', 'today', 'week', 'later', 'done'];

  const isEmpty = counts.active === 0 && (view === 'active' || counts.done === 0);

  return (
    <PageLayout maxWidth="lg">
      <SEOHead
        title="Tâches | Konekt"
        description="Vos rappels et tâches en cours"
      />

      {/* Header */}
      <motion.header
        className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-emerald-500/15 text-foreground flex items-center justify-center shrink-0">
            <CheckSquare className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-display font-bold text-foreground text-2xl sm:text-3xl tracking-tight leading-tight">
              Tâches
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {counts.active > 0
                ? `${counts.active} en cours · ${counts.done} terminée${counts.done > 1 ? 's' : ''}`
                : 'Aucune tâche en cours'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Segmented control Actives / Toutes */}
          <div className="inline-flex items-center bg-muted/40 p-0.5 rounded-full border border-border">
            {[
              { key: 'active' as const, label: `Actives (${counts.active})` },
              { key: 'all' as const, label: 'Toutes' },
            ].map((opt) => {
              const isActive = view === opt.key;
              return (
                <button
                  key={opt.key}
                  onClick={() => setView(opt.key)}
                  className={cn(
                    'inline-flex items-center h-8 px-3 rounded-full text-[11.5px] font-medium transition-all shrink-0',
                    isActive
                      ? 'bg-foreground text-background shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-border bg-background hover:bg-accent text-[11.5px] font-medium text-foreground transition-colors"
            aria-label="Actualiser les tâches"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Actualiser</span>
          </button>
        </div>
      </motion.header>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {(['overdue', 'today', 'week', 'later', 'done'] as const).map((bucket, i) => (
          <KPICard key={bucket} bucket={bucket} count={counts[bucket]} index={i} />
        ))}
      </div>

      {/* Loading / Empty / Content */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : isEmpty ? (
        <motion.div
          className="rounded-xl bg-card border border-border p-10 text-center"
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
        >
          <div className="h-12 w-12 rounded-full bg-success/10 text-success flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <p className="font-display font-bold text-foreground text-base">
            Zéro tâche en cours
          </p>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto">
            Les rappels créés sur un candidat apparaîtront ici. Tu peux en ajouter
            depuis le modal de détail d'un candidat.
          </p>
        </motion.div>
      ) : (
        <motion.div
          className="space-y-4"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.05, delayChildren: 0.1 } },
          }}
        >
          {visibleBuckets.map((bucket) => {
            const items = grouped[bucket];
            const meta = BUCKET_META[bucket];
            if (items.length === 0) return null;
            return (
              <BucketSection
                key={bucket}
                bucket={bucket}
                items={items}
                meta={meta}
                onToggle={toggleComplete}
                onDelete={deleteReminder}
                onNavigate={(candidateId) => navigate(`/pipeline?candidate=${candidateId}`)}
              />
            );
          })}
        </motion.div>
      )}
    </PageLayout>
  );
}

function BucketSection({
  bucket,
  items,
  meta,
  onToggle,
  onDelete,
  onNavigate,
}: {
  bucket: ReminderBucket;
  items: Reminder[];
  meta: typeof BUCKET_META[ReminderBucket];
  onToggle: (r: Reminder) => void;
  onDelete: (id: string) => void;
  onNavigate: (candidateId: string) => void;
}) {
  const Icon = meta.icon;
  return (
    <motion.section
      variants={{
        hidden: { opacity: 0, y: 10 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } },
      }}
      className="rounded-xl bg-card border border-border overflow-hidden"
    >
      {/* Section header */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border bg-muted/20">
        <div
          className={cn(
            'h-8 w-8 rounded-lg flex items-center justify-center shrink-0',
            meta.iconBg,
          )}
        >
          <Icon className={cn('w-4 h-4', meta.iconColor)} aria-hidden="true" />
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="font-display font-bold text-foreground text-[14px] tracking-tight leading-none">
            {meta.label}
          </h2>
          <span className="inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-full text-[11px] text-foreground bg-foreground/10 font-bold tabular-nums">
            {items.length}
          </span>
        </div>
      </div>

      {/* Task list */}
      <ul className="divide-y divide-border">
        <AnimatePresence>
          {items.map((r) => (
            <TaskRow
              key={r.id}
              reminder={r}
              onToggle={onToggle}
              onDelete={onDelete}
              onNavigate={onNavigate}
            />
          ))}
        </AnimatePresence>
      </ul>
    </motion.section>
  );
}

const TaskRow = React.memo(function TaskRow({
  reminder,
  onToggle,
  onDelete,
  onNavigate,
}: {
  reminder: Reminder;
  onToggle: (r: Reminder) => void;
  onDelete: (id: string) => void;
  onNavigate: (candidateId: string) => void;
}) {
  const [loading, setLoading] = useState<'toggle' | 'delete' | null>(null);
  const isCompleted = !!reminder.completed_at;
  const dueLabel = (() => {
    try {
      return format(parseISO(reminder.due_at), "d MMM yyyy 'à' HH:mm", { locale: fr });
    } catch {
      return '—';
    }
  })();

  return (
    <motion.li
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-muted/30',
        isCompleted && 'opacity-60',
      )}
    >
      <Checkbox
        checked={isCompleted}
        onCheckedChange={async () => {
          setLoading('toggle');
          try {
            await onToggle(reminder);
          } finally {
            setLoading(null);
          }
        }}
        disabled={loading !== null}
        className="mt-1 shrink-0"
        aria-label={isCompleted ? 'Marquer comme non terminée' : 'Marquer comme terminée'}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <p
            className={cn(
              'text-sm font-display font-semibold text-foreground tracking-tight leading-tight',
              isCompleted && 'line-through text-muted-foreground',
            )}
          >
            {reminder.title}
          </p>
          {reminder.job_title && (
            <span className="inline-flex items-center text-[10px] px-2 py-0.5 rounded-full border border-border bg-foreground/[0.04] text-muted-foreground uppercase tracking-wider font-semibold">
              {reminder.job_title}
            </span>
          )}
        </div>
        {reminder.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{reminder.description}</p>
        )}
        <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Clock className="w-3 h-3" aria-hidden="true" />
            {dueLabel}
          </span>
          {reminder.candidate_name && (
            <button
              onClick={() => onNavigate(reminder.candidate_id)}
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
              {reminder.candidate_name}
            </button>
          )}
        </div>
      </div>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            type="button"
            className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/[0.06] transition-colors shrink-0"
            aria-label="Supprimer la tâche"
            disabled={loading !== null}
          >
            {loading === 'delete' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            )}
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer la tâche ?</AlertDialogTitle>
            <AlertDialogDescription>
              "{reminder.title}" sera définitivement supprimée. Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                setLoading('delete');
                try {
                  await onDelete(reminder.id);
                } finally {
                  setLoading(null);
                }
              }}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.li>
  );
});
