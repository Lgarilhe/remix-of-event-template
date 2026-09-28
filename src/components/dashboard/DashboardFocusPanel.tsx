/**
 * DashboardFocusPanel — « Pour aujourd'hui » : ce qui demande une action.
 *
 * Quatre tuiles neutres qui mènent chacune à l'écran où l'on agit. Un chiffre
 * nul reste discret, un chiffre non nul passe en texte principal avec un point
 * d'accent : l'accent signale ce qui attend, pas la catégorie
 * (docs/design/01-direction.md, § 2). Un compteur inconnu s'écrit « – ».
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, MessageCircle, Bell, UserCheck, CheckCircle2, type LucideIcon } from 'lucide-react';
import { IconTile } from '@/components/ui/IconTile';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface FocusItem {
  key: string;
  label: string;
  /** null : inconnu (chargement ou lecture en échec), affiché « – ». */
  count: number | null;
  description: string;
  icon: LucideIcon;
  href: string;
}

interface DashboardFocusPanelProps {
  /** Réponses de candidats comptées par la barre latérale ; null tant qu'inconnu. */
  unreadMessages: number | null;
  /** Lecture des réponses en échec ou hors ligne, sans donnée : « Indisponible » au lieu de « Chargement ». */
  unreadMessagesUnavailable?: boolean;
  /** null : lecture des candidats en échec. */
  stagnantCandidates: number | null;
  /** null : lecture des tâches en échec. */
  remindersToday: number | null;
  /** null : lecture des candidats en échec. */
  pendingResponses: number | null;
  isLoading?: boolean;
}

const FocusTile: React.FC<{ item: FocusItem }> = ({ item }) => {
  const pending = (item.count ?? 0) > 0;
  const Icon = item.icon;
  return (
    <Link
      to={item.href}
      className="interactive-card flex flex-col rounded-xl border border-border bg-card p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{item.label}</span>
        {pending && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />}
      </span>
      <span
        className={cn(
          'mt-3 text-2xl font-semibold tabular-nums leading-none',
          pending ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {item.count === null ? '–' : item.count}
      </span>
      <span className="mt-1.5 truncate text-xs text-muted-foreground">{item.description}</span>
    </Link>
  );
};

export const DashboardFocusPanel: React.FC<DashboardFocusPanelProps> = ({
  unreadMessages,
  unreadMessagesUnavailable = false,
  stagnantCandidates,
  remindersToday,
  pendingResponses,
  isLoading,
}) => {
  const items: FocusItem[] = [
    {
      key: 'unread',
      label: 'Réponses non lues',
      count: unreadMessages,
      description:
        unreadMessages === null
          ? unreadMessagesUnavailable ? 'Indisponible' : 'Chargement'
          : unreadMessages > 0 ? 'À lire dans la messagerie' : 'Messagerie à jour',
      icon: MessageCircle,
      href: '/inbox',
    },
    {
      key: 'pending',
      label: 'Candidats à relancer',
      count: pendingResponses,
      description:
        pendingResponses === null ? 'Indisponible'
          : pendingResponses > 0 ? 'Ont répondu, en attente de votre retour' : 'Aucune relance en attente',
      icon: UserCheck,
      href: '/pipeline',
    },
    {
      key: 'stagnant',
      label: 'Candidats stagnants',
      count: stagnantCandidates,
      description:
        stagnantCandidates === null ? 'Indisponible'
          : stagnantCandidates > 0 ? 'Au-delà du délai prévu pour leur étape' : 'Aucun candidat en retard',
      icon: AlertTriangle,
      href: '/pipeline?view=analytics',
    },
    {
      key: 'reminders',
      label: 'Tâches du jour',
      count: remindersToday,
      description:
        remindersToday === null ? 'Indisponible'
          : remindersToday > 0 ? "À faire aujourd'hui ou en retard" : "Aucune tâche pour aujourd'hui",
      icon: Bell,
      href: '/tasks',
    },
  ];

  const heading = (
    <h2 id="dashboard-focus" className="eyebrow mb-3">
      Pour aujourd'hui
    </h2>
  );

  if (isLoading) {
    return (
      <section aria-labelledby="dashboard-focus">
        {heading}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="status" aria-label="Chargement">
          {items.map((item) => (
            <Skeleton key={item.key} className="h-28 rounded-xl" />
          ))}
        </div>
      </section>
    );
  }

  const total = items.reduce((s, i) => s + (i.count ?? 0), 0);

  // Un compteur inconnu ne permet pas d'annoncer « Tout est à jour ».
  if (total === 0 && items.every((i) => i.count !== null)) {
    return (
      <section aria-labelledby="dashboard-focus">
        {heading}
        <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
          <IconTile icon={CheckCircle2} tone="success" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Tout est à jour</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Aucune réponse, relance ni tâche en attente : un bon moment pour sourcer ou affiner un brief.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="dashboard-focus">
      {heading}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {items.map((item) => (
          <FocusTile key={item.key} item={item} />
        ))}
      </div>
    </section>
  );
};
