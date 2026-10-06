/**
 * DashboardGreeting — en-tête du tableau de bord.
 *
 * Salutation selon l'heure, date du jour et récapitulatif d'une ligne
 * (« 28 candidats actifs sur 4 missions »), puis un seul bouton plein :
 * « Nouvelle mission » (design simplifié, docs/design/06-simplicite.md).
 * La recherche et la messagerie restent dans la barre latérale.
 *
 * Carte colorée en permanence (décision du propriétaire du 05/10/2026,
 * docs/design/01-direction.md, § 7) : la zone texturée toujours visible de
 * l'accueil, bleue ; le bandeau de blocage LinkedIn s'y ajoute en dessous.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { texturedCard } from '@/components/layout/texturedCard';
import { Button } from '@/components/ui/button';
import { plural } from '@/lib/plural';

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
    // Sur téléphone la carte rogne la largeur du titre : il passe sur deux lignes au lieu de se couper (PageHeader le tronque).
    <div className={texturedCard('teal', 'mb-6 rounded-xl px-4 py-4 sm:px-7 sm:py-6 max-sm:[&_h1]:whitespace-normal max-sm:[&_h1]:[text-overflow:clip]')}>
      <PageHeader
        className="mb-0"
        title={title}
        subtitle={summary}
        actions={
          <Button asChild variant="primary" size="lg" className="min-h-11 md:min-h-0">
            <Link to="/missions?create=brief">
              <Plus aria-hidden="true" />
              Nouvelle mission
            </Link>
          </Button>
        }
      />
    </div>
  );
};
