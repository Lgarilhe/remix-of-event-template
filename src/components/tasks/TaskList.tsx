/**
 * TaskList — les listes de la page /tasks (design simplifié, lot T,
 * docs/design/06-simplicite.md).
 *
 * - Une section par échéance, sans cadre : « En retard » en rouge sous le
 *   réveil qui sonne, puis Aujourd'hui, Cette semaine, Plus tard, Terminées ;
 * - Une ligne par tâche : la case, le visage du candidat (sinon les initiales
 *   du client de la mission), le titre, la mission et l'échéance. La corbeille
 *   apparaît au survol de la ligne, et reste visible sur un écran tactile ;
 * - Les suggestions : trois au plus, les autres à la demande.
 *
 * Aucune lecture ici : la page fournit les tâches, les photos et les missions.
 */

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO, isToday, isTomorrow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ListChecks, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { IconTile } from '@/components/ui/IconTile';
import { AlarmIcon } from '@/components/ui/animated-icons';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
import { CandidateAvatar } from '@/components/dashboard/CandidateAvatar';
import { MissionCompanyLogo } from '@/components/dashboard/MissionCompanyLogo';
import { cn } from '@/lib/utils';
import { plural } from '@/lib/plural';
import type { Reminder, ReminderBucket } from '@/hooks/useAllReminders';
import type { AutoTaskSuggestion } from '@/hooks/useAutoTaskSuggestions';

/** Mission d'une tâche, quand on la connaît : de quoi faire le lien, nommer le client et montrer son logo. */
export interface TaskMission {
  id: string;
  client: string | null;
  /** Logo du client enregistré dans le brief (resolve-client-logo), sinon les initiales. */
  logo: string | null;
}

/** « Aujourd'hui à 14:30 », « Demain à 9:00 », « 22 sept. à 11:29 ». */
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

// Corbeille d'une ligne : au survol, au clavier, fenêtre ouverte, et toujours sur un écran tactile.
const REVEAL_ON_HOVER =
  'opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100';

interface TaskSectionProps {
  bucket: ReminderBucket;
  label: string;
  items: Reminder[];
  /** Photo LinkedIn enregistrée, par candidate_id. */
  photos: Map<string, string | null>;
  missionOf: (jobId: string | null) => TaskMission | null;
  onToggle: (r: Reminder) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
}

export function TaskSection({ bucket, label, items, photos, missionOf, onToggle, onDelete }: TaskSectionProps) {
  const overdue = bucket === 'overdue';
  const headingId = `taches-${bucket}`;
  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className={cn('flex items-center gap-2.5 pb-3 text-base font-semibold', overdue ? 'text-danger' : 'text-foreground')}
      >
        {overdue && (
          <IconTile tone="destructive" size="sm">
            <AlarmIcon />
          </IconTile>
        )}
        {label}
        <span className="font-medium text-muted-foreground">{items.length}</span>
      </h2>
      <ul className="divide-y divide-border border-y border-border">
        {items.map((r) => (
          <TaskRow
            key={r.id}
            reminder={r}
            photo={r.candidate_id ? photos.get(r.candidate_id) ?? null : null}
            mission={missionOf(r.job_id)}
            onToggle={onToggle}
            onDelete={onDelete}
          />
        ))}
      </ul>
    </section>
  );
}

const TaskRow = React.memo(function TaskRow({
  reminder: r,
  photo,
  mission,
  onToggle,
  onDelete,
}: {
  reminder: Reminder;
  photo: string | null;
  mission: TaskMission | null;
  onToggle: (r: Reminder) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<'toggle' | 'delete' | null>(null);
  const isCompleted = !!r.completed_at;
  const due = dueLabelOf(r.due_at);

  // Le nom du candidat, sauf s'il est déjà dans le titre (« Relancer Inès Durand »).
  const name =
    r.candidate_name && !r.title.toLocaleLowerCase('fr').includes(r.candidate_name.toLocaleLowerCase('fr'))
      ? r.candidate_name
      : null;
  const missionLabel =
    r.job_title && mission?.client && !r.job_title.includes(mission.client) ? `${r.job_title}, ${mission.client}` : r.job_title;
  const context = [name, missionLabel].filter(Boolean).join(' · ');

  const visual =
    r.candidate_id || r.candidate_name ? (
      <CandidateAvatar name={r.candidate_name || 'Candidat'} avatarUrl={photo} candidateId={r.candidate_id} size={36} />
    ) : r.job_id || r.job_title ? (
      <MissionCompanyLogo company={mission?.client || r.job_title} logoUrl={mission?.logo ?? null} size={36} />
    ) : (
      <IconTile icon={ListChecks} size="md" />
    );

  const href = r.candidate_id ? `/pipeline?candidate=${r.candidate_id}` : mission ? `/missions/${mission.id}` : null;
  const bodyClass =
    'flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0';
  const body = (
    <>
      <span className={cn('block text-pretty text-md text-foreground', isCompleted && 'line-through')}>{r.title}</span>
      {r.description && <span className="block truncate text-sm text-muted-foreground">{r.description}</span>}
      {/* Sur téléphone, l'échéance passe sous le titre et la ligne revient à la ligne au lieu d'être coupée. */}
      <span className={cn('block text-pretty text-sm text-muted-foreground md:truncate', !context && 'md:hidden')}>
        <span className="tabular-nums md:hidden">
          {due}
          {context && ' · '}
        </span>
        {context}
      </span>
    </>
  );

  return (
    <li className={cn('group flex items-center gap-3.5 py-3', isCompleted && 'opacity-60')}>
      {/* Sur téléphone, la case se touche sur 44 px sans déplacer la ligne. */}
      <label className="-m-3.5 flex shrink-0 items-center justify-center p-3.5 md:m-0 md:p-0">
        <Checkbox
          checked={isCompleted}
          onCheckedChange={async () => {
            setBusy('toggle');
            try {
              await onToggle(r);
            } finally {
              setBusy(null);
            }
          }}
          disabled={busy !== null}
          aria-label={isCompleted ? `Rouvrir la tâche « ${r.title} »` : `Marquer la tâche « ${r.title} » comme faite`}
        />
      </label>
      {visual}
      {href ? (
        <Link to={href} className={bodyClass}>
          {body}
        </Link>
      ) : (
        <div className={bodyClass}>{body}</div>
      )}
      <span className="hidden shrink-0 text-sm tabular-nums text-muted-foreground md:block">{due}</span>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn(
              'min-h-11 min-w-11 shrink-0 text-muted-foreground hover:text-danger md:min-h-0 md:min-w-0',
              busy === 'delete' ? 'opacity-100' : REVEAL_ON_HOVER,
            )}
            aria-label={`Supprimer la tâche « ${r.title} »`}
            loading={busy === 'delete'}
          >
            {busy !== 'delete' && <Trash2 aria-hidden="true" />}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer la tâche ?</AlertDialogTitle>
            <AlertDialogDescription>
              « {r.title} » sera définitivement supprimée. Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                setBusy('delete');
                try {
                  await onDelete(r.id);
                } finally {
                  setBusy(null);
                }
              }}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
});

const SUGGESTIONS_SHOWN = 3;

interface TaskSuggestionsProps {
  suggestions: AutoTaskSuggestion[];
  /** Photo LinkedIn enregistrée, par candidate_id. */
  photos: Map<string, string | null>;
  /** Clé de la suggestion en cours de création. */
  creatingKey: string | null;
  onAccept: (s: AutoTaskSuggestion) => void;
  onDismiss: (key: string) => void;
}

/** Tâches proposées d'après l'activité : trois au plus, les autres à la demande. */
export function TaskSuggestions({ suggestions, photos, creatingKey, onAccept, onDismiss }: TaskSuggestionsProps) {
  const [showAll, setShowAll] = useState(false);
  if (suggestions.length === 0) return null;
  const shown = showAll ? suggestions : suggestions.slice(0, SUGGESTIONS_SHOWN);
  const hidden = suggestions.length - SUGGESTIONS_SHOWN;

  return (
    <section aria-labelledby="taches-suggestions">
      <h2 id="taches-suggestions" className="flex items-center gap-2.5 pb-3 text-base font-semibold text-foreground">
        Suggestions
        <span className="font-medium text-muted-foreground">{suggestions.length}</span>
      </h2>
      <ul className="divide-y divide-border border-y border-border">
        {shown.map((s) => (
          <li key={s.key} className="flex items-start gap-3.5 py-3 sm:items-center">
            {s.candidate ? (
              <CandidateAvatar
                name={s.candidate.name}
                avatarUrl={s.candidate.avatarUrl ?? (s.candidate.candidateId ? photos.get(s.candidate.candidateId) ?? null : null)}
                candidateId={s.candidate.candidateId}
                size={36}
              />
            ) : (
              <IconTile icon={ListChecks} size="md" />
            )}
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-6 gap-y-1">
              <div className="min-w-0">
                <p className="text-pretty text-md text-foreground">{s.title}</p>
                <p className="text-pretty text-sm text-muted-foreground">{s.reason}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="min-h-11 px-0 font-semibold md:min-h-0"
                  loading={creatingKey === s.key}
                  onClick={() => onAccept(s)}
                >
                  Créer la tâche
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="min-h-11 min-w-11 text-muted-foreground md:min-h-0 md:min-w-0"
                      onClick={() => onDismiss(s.key)}
                      aria-label={`Ignorer la suggestion « ${s.title} »`}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Ignorer</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="mt-2 min-h-11 px-0 text-muted-foreground md:min-h-0"
          aria-expanded={showAll}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? 'Afficher moins' : `Afficher ${plural(hidden, 'autre suggestion', 'autres suggestions')}`}
        </Button>
      )}
    </section>
  );
}
