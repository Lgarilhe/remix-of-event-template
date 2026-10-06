// Une ligne du tableau des séquences de l'organisation (lot 5c-2).
//
// Interrupteur (mise en pause immédiate de la séquence, avec « Annuler » dans
// le toast, lot 5b ; « Réactiver cette séquence ? » garde sa fenêtre), nom et
// mission, ligne d'alerte par cause, expéditeurs, répartition des inscrits,
// taux d'acceptation et de réponse à partir de 5 contactés. Un clic sur la
// ligne ouvre la page de la séquence ; le menu « ... » apparaît au survol, au
// focus et au toucher.
//
// Sous 768 px, les colonnes chiffrées passent sous le nom.
import type React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Copy, FileText, Lock, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { REVEAL_ON_ROW } from '@/components/missions/v3/cadrage/sectionUi';
import { cn } from '@/lib/utils';
import { sequencePath } from '@/lib/sequencesBeta';
import type { SequenceWithStats } from '@/lib/sequenceActions';
import {
  progressSegments,
  sequenceAlerts,
  isDraftSequence,
  type SequenceAlert,
  type SequenceRates,
} from '@/lib/sequenceTableStats';
import { EnrollmentProgressBar } from './EnrollmentProgressBar';
import { SenderAvatars } from './SenderAvatars';

export type RowFigures = { status: 'loading' } | { status: 'error' } | { status: 'ready'; rates: SequenceRates };

export interface SequenceRowProps {
  seq: SequenceWithStats;
  /** « Directeur financier · Groupe Hélios · Guillaume Martin » */
  subtitle: string;
  senders: string[];
  figures: RowFigures;
  /** Compteurs d'inscriptions illisibles : « - ». */
  countsUnavailable: boolean;
  canEdit: boolean;
  canManage: boolean;
  readOnlyHint: string;
  toggleDisabled: boolean;
  /** Mise en pause réservée (collaborateur) : l'interrupteur dit pourquoi au clic. */
  toggleLocked: boolean;
  toggleTitle?: string;
  /** Offre sans envoi : l'interrupteur renvoie au bandeau de l'offre. */
  activationNoticeId?: string;
  duplicating: boolean;
  duplicateDisabled: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onSaveTemplate: () => void;
  onDelete: () => void;
}

const UNAVAILABLE = 'Indisponible';
const NOT_ENOUGH_CONTACTED = 'Pas encore assez de candidats contactés (moins de 5).';

/** « 26 % », ou « - » avec son infobulle. */
function RateCell({ figures, pick, className }: { figures: RowFigures; pick: (r: SequenceRates) => number | null; className?: string }) {
  if (figures.status === 'loading') return <Skeleton className="h-3 w-8 rounded-sm" />;
  if (figures.status === 'error') return <span title={UNAVAILABLE} className="text-muted-foreground">-</span>;
  const value = pick(figures.rates);
  if (value === null) return <span title={NOT_ENOUGH_CONTACTED} className="text-muted-foreground">-</span>;
  return <span className={cn('tabular-nums', className)}>{value}&nbsp;%</span>;
}

function alertTarget(alert: SequenceAlert, sequenceId: string): string {
  if (alert.action === 'reconnect') return '/settings/account/connections';
  if (alert.action === 'pricing') return '/pricing';
  return `${sequencePath(sequenceId)}?onglet=candidats&statut=en-echec`;
}

/** Clic sur la ligne : la page de la séquence, sauf depuis un contrôle de la ligne. */
const INTERACTIVE = 'a,button,input,label,[role="switch"],[role="menuitem"],[role="menu"]';

export function SequenceRow(props: SequenceRowProps) {
  const {
    seq, subtitle, senders, figures, countsUnavailable, canEdit, canManage, readOnlyHint,
    toggleDisabled, toggleLocked, toggleTitle, activationNoticeId, duplicating, duplicateDisabled,
    onToggle, onEdit, onDuplicate, onSaveTemplate, onDelete,
  } = props;
  const navigate = useNavigate();
  const stats = seq.enrollments;
  const draft = !countsUnavailable && isDraftSequence(stats);
  const segments = progressSegments(stats);
  const alerts = countsUnavailable ? [] : sequenceAlerts(stats);
  const href = sequencePath(seq.id);

  const openRow = (event: React.MouseEvent<HTMLTableRowElement>) => {
    if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
    navigate(href);
  };

  const candidates = countsUnavailable ? (
    <span title={UNAVAILABLE} className="text-muted-foreground">-</span>
  ) : draft ? (
    <span className="text-xs text-muted-foreground">aucun candidat inscrit</span>
  ) : (
    <span className="flex min-w-0 items-center gap-2">
      <EnrollmentProgressBar segments={segments} />
      <span className="shrink-0 text-sm tabular-nums text-foreground">{stats.total}</span>
    </span>
  );

  return (
    <tr onClick={openRow} className="group cursor-pointer border-b border-border align-top transition-colors duration-150 last:border-b-0 hover:bg-accent/40">
      <td className="w-16 py-3 pl-3 pr-2">
        <div className="flex h-6 items-center">
          {/* Brouillon (aucune inscription) : pas d'interrupteur, comme la maquette ; il s'active depuis sa page. */}
          {draft && canEdit ? null : canEdit ? (
            <Switch
              checked={seq.is_active}
              disabled={toggleDisabled}
              aria-disabled={toggleLocked || undefined}
              title={toggleTitle}
              onCheckedChange={onToggle}
              className={cn(toggleLocked && 'opacity-60')}
              aria-label={seq.is_active ? `Mettre en pause la séquence ${seq.name}` : `Réactiver la séquence ${seq.name}`}
              aria-describedby={activationNoticeId}
            />
          ) : (
            <span title={readOnlyHint} className="inline-flex">
              <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">{readOnlyHint}</span>
            </span>
          )}
        </div>
      </td>

      <td className="min-w-0 py-3 pr-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Link to={href} className="min-w-0 break-words text-md font-semibold text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
            {seq.name}
          </Link>
          {!seq.project_id && <Badge variant="muted">Partagée entre missions</Badge>}
          {draft && <Badge variant="outline">Brouillon</Badge>}
        </div>
        {subtitle && <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>}
        {alerts.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {alerts.map((alert) => (
              <li key={alert.key} className="flex flex-wrap items-center gap-x-1.5 text-xs text-warning">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{alert.text}</span>
                <span aria-hidden="true">·</span>
                <Link to={alertTarget(alert, seq.id)} className="font-medium underline-offset-4 hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center">
                  {alert.actionLabel}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {/* Téléphone et tablette étroite : les chiffres sous le nom. */}
        <div className="mt-2 space-y-1 md:hidden">
          {candidates}
          {figures.status === 'ready' && (figures.rates.acceptRate !== null || figures.rates.replyRate !== null) && (
            <p className="text-xs text-muted-foreground">
              {figures.rates.acceptRate !== null && <>Accept. <span className="tabular-nums text-foreground">{figures.rates.acceptRate}&nbsp;%</span></>}
              {figures.rates.acceptRate !== null && figures.rates.replyRate !== null && ' · '}
              {figures.rates.replyRate !== null && <>Rép. <span className="tabular-nums text-brand">{figures.rates.replyRate}&nbsp;%</span></>}
            </p>
          )}
        </div>
      </td>

      <td className="hidden w-24 py-3 pr-3 lg:table-cell">
        <SenderAvatars names={senders} />
      </td>
      <td className="hidden w-48 py-3 pr-4 md:table-cell">{candidates}</td>
      <td className="hidden w-20 py-3 pr-3 text-sm md:table-cell">
        <RateCell figures={figures} pick={(r) => r.acceptRate} className="text-foreground" />
      </td>
      <td className="hidden w-20 py-3 pr-3 text-sm md:table-cell">
        <RateCell figures={figures} pick={(r) => r.replyRate} className="text-brand" />
      </td>

      <td className="w-12 py-2 pr-2 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions de la séquence ${seq.name}`}
              className={cn(REVEAL_ON_ROW, 'data-[state=open]:opacity-100 max-md:h-11 max-md:w-11')}
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canEdit && (
              <DropdownMenuItem onSelect={onEdit} className="gap-2 max-md:min-h-11">
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Modifier les étapes
              </DropdownMenuItem>
            )}
            {canManage && (
              <DropdownMenuItem disabled={duplicateDisabled} onSelect={onDuplicate} className="gap-2 max-md:min-h-11">
                <Copy className="h-4 w-4" aria-hidden="true" />
                {duplicating ? 'Duplication…' : 'Dupliquer'}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={onSaveTemplate} className="gap-2 max-md:min-h-11">
              <FileText className="h-4 w-4" aria-hidden="true" />
              Enregistrer comme modèle
            </DropdownMenuItem>
            {canEdit && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onDelete} className="gap-2 text-destructive focus:text-destructive max-md:min-h-11">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Supprimer
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}
