/**
 * DashboardGreeting — header personnalisé du Dashboard.
 *
 * Pattern Linear / Notion : on accueille l'user avec un greeting contextuel
 * (matin/après-midi/soir + emoji), la date du jour, et un récap "1 ligne"
 * de l'activité ("12 candidats actifs sur 3 missions"). À droite, 2-3 CTAs
 * pour les actions rapides les plus fréquentes.
 *
 * On évite le piège du wall-of-stats : l'objectif est qu'en 1 seconde l'user
 * sente "je suis bien, je sais ce qui m'attend", pas "qu'est-ce que je fais
 * de tout ça ?".
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Plus, Search, ArrowRight, Sparkles } from 'lucide-react';

interface DashboardGreetingProps {
  userName: string | null;
  activeCandidatesCount: number;
  activeMissionsCount: number;
}

const greetingFor = (hour: number): { greeting: string; emoji: string } => {
  if (hour < 5) return { greeting: 'Bonsoir', emoji: '🌙' };
  if (hour < 12) return { greeting: 'Bonjour', emoji: '☀️' };
  if (hour < 18) return { greeting: 'Bon après-midi', emoji: '👋' };
  return { greeting: 'Bonsoir', emoji: '🌆' };
};

export const DashboardGreeting: React.FC<DashboardGreetingProps> = ({
  userName,
  activeCandidatesCount,
  activeMissionsCount,
}) => {
  const navigate = useNavigate();
  const now = new Date();
  const { greeting, emoji } = greetingFor(now.getHours());
  const firstName = userName?.split(' ')[0] || null;

  return (
    <header className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
      <div className="min-w-0">
        <h1 className="font-display font-bold text-foreground text-2xl sm:text-3xl tracking-tight leading-tight">
          {greeting}{firstName ? `, ${firstName}` : ''} <span aria-hidden="true">{emoji}</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          {format(now, "EEEE d MMMM", { locale: fr }).replace(/^./, c => c.toUpperCase())}
          {activeCandidatesCount > 0 && (
            <>
              {' · '}
              <span className="text-foreground font-medium">{activeCandidatesCount}</span> candidat
              {activeCandidatesCount > 1 ? 's' : ''} actif{activeCandidatesCount > 1 ? 's' : ''}
              {activeMissionsCount > 0 && (
                <>
                  {' sur '}
                  <span className="text-foreground font-medium">{activeMissionsCount}</span> mission
                  {activeMissionsCount > 1 ? 's' : ''}
                </>
              )}
            </>
          )}
        </p>
      </div>

      {/* Quick action pills */}
      <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
        <button
          onClick={() => navigate('/missions?new=1')}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-foreground text-background text-[12px] font-medium hover:opacity-90 transition-opacity"
        >
          <Plus className="w-3.5 h-3.5" />
          Nouvelle mission
        </button>
        <button
          onClick={() => navigate('/missions')}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border border-border bg-background hover:bg-accent text-[12px] font-medium text-foreground transition-colors"
        >
          <Search className="w-3.5 h-3.5" />
          Rechercher
        </button>
        <button
          onClick={() => navigate('/inbox')}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border border-border bg-background hover:bg-accent text-[12px] font-medium text-foreground transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Inbox
          <ArrowRight className="w-3 h-3 opacity-60" />
        </button>
      </div>
    </header>
  );
};
