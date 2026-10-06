/**
 * DashboardFocusPanel — le haut de « À faire » : ce qui attend une action.
 *
 * Une ligne par signal, seulement s'il demande quelque chose (design simplifié,
 * docs/design/06-simplicite.md) : compte LinkedIn à reconnecter, réponses à
 * lire, candidats qui attendent votre réponse, candidats qui n'avancent plus.
 * Chaque ligne : une pastille d'icône (qui bouge quand quelque chose attend),
 * une phrase, les visages des personnes concernées, et un bouton discret où l'on agit.
 * Les lignes sont posées sur une carte ; la panne LinkedIn, qui arrête les envois,
 * a son propre bandeau texturé (texturedCard) et son bouton plein.
 *
 * Un compteur inconnu (number | null) ne disparaît pas : sa ligne dit
 * « Chargement » ou « Indisponible », jamais un zéro inventé.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconTile } from '@/components/ui/IconTile';
import { AvatarStack } from '@/components/ui/person-avatar';
import { HourglassIcon, TypingIcon } from '@/components/ui/animated-icons';
import { Skeleton } from '@/components/ui/skeleton';
import { texturedCard } from '@/components/layout/texturedCard';
import { plural } from '@/lib/plural';

export interface FocusPerson {
  name: string;
  src?: string | null;
  /** Identifiant du candidat : sa copie privée de photo passe avant `src`. */
  candidateId?: string | null;
}

interface DashboardFocusPanelProps {
  /** Compte LinkedIn de l'utilisateur en erreur : les envois sont en pause. */
  linkedinIssue?: boolean;
  /** Réponses de candidats comptées par la barre latérale ; null tant qu'inconnu. */
  unreadMessages: number | null;
  /** Lecture des réponses en échec ou hors ligne, sans donnée : « Indisponible » au lieu de « Chargement ». */
  unreadMessagesUnavailable?: boolean;
  unreadPeople?: FocusPerson[];
  /** null : lecture des candidats en échec. */
  pendingResponses: number | null;
  pendingPeople?: FocusPerson[];
  /** null : lecture des candidats en échec. */
  stagnantCandidates: number | null;
  stagnantPeople?: FocusPerson[];
  isLoading?: boolean;
}

interface SignalRowProps {
  tile: React.ReactNode;
  title: string;
  description: string;
  people?: FocusPerson[];
  total?: number;
  action?: { label: string; href: string };
  /** Bandeau texturé chaud (blocage) à la place d'une ligne de liste : l'accueil en porte un seul à la fois. */
  texture?: 'warm';
}

// Sur téléphone, les visages et le lien passent sous la phrase, alignés sur elle.
const SignalRow: React.FC<SignalRowProps> = ({ tile, title, description, people, total, action, texture }) => {
  const Root = texture ? 'div' : 'li';
  return (
    <Root className={texture ? texturedCard(texture, 'flex items-start gap-3.5 rounded-xl px-4 py-4 sm:items-center sm:px-5') : 'flex items-start gap-3.5 py-4 sm:items-center'}>
      {tile}
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="text-md font-medium text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {(people?.length || action) && (
          <div className="flex items-center gap-4">
            {people && people.length > 0 && <AvatarStack people={people} total={total} size={30} ringClassName="ring-card" />}
            {action && (
              <Button
                asChild
                variant={texture ? 'primary' : 'secondary'}
                size="sm"
                className={texture ? 'min-h-11 md:min-h-0' : 'min-h-11 min-w-11 md:min-h-0 md:min-w-0'}
              >
                <Link to={action.href}>{action.label}</Link>
              </Button>
            )}
          </div>
        )}
      </div>
    </Root>
  );
};

/** Ligne d'un compteur inconnu : jamais de chiffre, l'état de la lecture. */
const UnknownRow: React.FC<{ title: string; unavailable: boolean }> = ({ title, unavailable }) => (
  <li className="flex items-center justify-between gap-6 py-4">
    <p className="text-md text-muted-foreground">{title}</p>
    <p className="text-sm text-muted-foreground">{unavailable ? 'Indisponible' : 'Chargement'}</p>
  </li>
);

export const DashboardFocusPanel: React.FC<DashboardFocusPanelProps> = ({
  linkedinIssue = false,
  unreadMessages,
  unreadMessagesUnavailable = false,
  unreadPeople,
  pendingResponses,
  pendingPeople,
  stagnantCandidates,
  stagnantPeople,
  isLoading,
}) => {
  if (isLoading) {
    return (
      <div className="space-y-3 py-4" role="status" aria-label="Chargement">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
      </div>
    );
  }

  const rows: React.ReactNode[] = [];

  // Un blocage des envois est la chose à faire avant toutes les autres : bandeau texturé, au-dessus de la liste.
  const linkedinBanner = linkedinIssue ? (
    <SignalRow
      tile={<IconTile icon={Unplug} tone="default" size="lg" />}
      title="Compte LinkedIn à reconnecter"
      description="Les envois sont en pause jusqu'à la reconnexion."
      action={{ label: 'Reconnecter', href: '/settings/account/connections' }}
      texture="warm"
    />
  ) : null;

  // La bulle qui écrit va à la première ligne de conversation, pas aux deux.
  let typingUsed = false;
  const conversationTile = () => {
    const tile = typingUsed ? (
      <IconTile icon={MessageCircle} tone="brand" size="lg" />
    ) : (
      <IconTile tone="brand" size="lg">
        <TypingIcon />
      </IconTile>
    );
    typingUsed = true;
    return tile;
  };

  if (unreadMessages === null) {
    rows.push(<UnknownRow key="unread" title="Réponses de candidats" unavailable={unreadMessagesUnavailable} />);
  } else if (unreadMessages > 0) {
    rows.push(
      <SignalRow
        key="unread"
        tile={conversationTile()}
        title={`${plural(unreadMessages, 'réponse')} à lire`}
        description={unreadMessages > 1 ? 'Des candidats vous ont écrit.' : 'Un candidat vous a écrit.'}
        people={unreadPeople}
        total={unreadMessages}
        action={{ label: 'Lire', href: '/inbox' }}
      />,
    );
  }

  if (pendingResponses === null) {
    rows.push(<UnknownRow key="pending" title="Candidats qui attendent votre réponse" unavailable />);
  } else if (pendingResponses > 0) {
    const many = pendingResponses > 1;
    rows.push(
      <SignalRow
        key="pending"
        tile={conversationTile()}
        title={`${plural(pendingResponses, 'candidat')} ${many ? 'attendent' : 'attend'} votre réponse`}
        description={many ? 'Ils vous ont répondu, sans suite depuis un jour ou plus.' : 'Il vous a répondu, sans suite depuis un jour ou plus.'}
        people={pendingPeople}
        total={pendingResponses}
        action={{ label: 'Répondre', href: '/inbox' }}
      />,
    );
  }

  if (stagnantCandidates === null) {
    rows.push(<UnknownRow key="stagnant" title="Candidats qui n'avancent plus" unavailable />);
  } else if (stagnantCandidates > 0) {
    const many = stagnantCandidates > 1;
    rows.push(
      <SignalRow
        key="stagnant"
        tile={
          <IconTile tone="warning" size="lg">
            <HourglassIcon />
          </IconTile>
        }
        title={`${plural(stagnantCandidates, 'candidat')} ${many ? "n'avancent" : "n'avance"} plus`}
        description="Au-delà du délai prévu pour leur étape."
        people={stagnantPeople}
        total={stagnantCandidates}
        action={{ label: 'Voir', href: '/pipeline?view=analytics' }}
      />,
    );
  }

  if (rows.length === 0 && !linkedinBanner) return null;
  return (
    <div className="space-y-3 pt-3">
      {linkedinBanner}
      {rows.length > 0 && (
        <Card>
          <ul className="divide-y divide-border px-5">{rows}</ul>
        </Card>
      )}
    </div>
  );
};
