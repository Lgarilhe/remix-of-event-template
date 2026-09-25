/**
 * DashboardGreeting — en-tête du tableau de bord.
 *
 * Salutation selon l'heure, date du jour et récapitulatif d'une ligne
 * (« 28 candidats actifs sur 4 missions »), puis les trois actions les plus
 * fréquentes. Pas d'emoji, pas de décor : l'en-tête suit PageHeader comme les
 * autres pages (docs/design/01-direction.md).
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Plus, Search, MessageSquare } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Button } from '@/components/ui/button';

interface DashboardGreetingProps {
  userName: string | null;
  activeCandidatesCount: number;
  activeMissionsCount: number;
}

const greetingFor = (hour: number): string => {
  if (hour < 5 || hour >= 18) return 'Bonsoir';
  if (hour < 12) return 'Bonjour';
  return 'Bon après-midi';
};

/**
 * Prénom pour la salutation :
 * - « Laurent » / « Laurent Garilhe » → « Laurent »
 * - « L. Garilhe » (déduit de l'e-mail) → « L. Garilhe » (« Bonjour L. » serait trop court)
 */
const firstNameOf = (userName: string | null): string | null => {
  if (!userName) return null;
  const tokens = userName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (/^[A-Z]\.?$/.test(tokens[0])) return userName;
  return tokens[0];
};

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

export const DashboardGreeting: React.FC<DashboardGreetingProps> = ({
  userName,
  activeCandidatesCount,
  activeMissionsCount,
}) => {
  const now = new Date();
  const firstName = firstNameOf(userName);
  const title = `${greetingFor(now.getHours())}${firstName ? `, ${firstName}` : ''}`;
  const date = format(now, 'EEEE d MMMM', { locale: fr }).replace(/^./, (c) => c.toUpperCase());

  let summary = date;
  if (activeCandidatesCount > 0) {
    summary += ` · ${plural(activeCandidatesCount, 'candidat')} actif${activeCandidatesCount > 1 ? 's' : ''}`;
    if (activeMissionsCount > 0) summary += ` sur ${plural(activeMissionsCount, 'mission')}`;
  }

  return (
    <PageHeader
      title={title}
      subtitle={summary}
      actions={
        <>
          <Button asChild variant="primary">
            <Link to="/missions?create=brief">
              <Plus aria-hidden="true" />
              Nouvelle mission
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/sourcing">
              <Search aria-hidden="true" />
              Rechercher
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/inbox">
              <MessageSquare aria-hidden="true" />
              Messagerie
            </Link>
          </Button>
        </>
      }
    />
  );
};
