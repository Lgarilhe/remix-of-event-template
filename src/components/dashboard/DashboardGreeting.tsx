/**
 * DashboardGreeting — header personnalisé du Dashboard.
 *
 * Pattern Linear / Notion : on accueille l'user avec un greeting contextuel
 * (matin/après-midi/soir + emoji), la date du jour, et un récap "1 ligne"
 * de l'activité ("12 candidats actifs sur 3 missions"). À droite, 2-3 CTAs
 * pour les actions rapides les plus fréquentes.
 *
 * V2 anim : staggered entrance (title → subtitle → CTAs), gradient subtle
 * en background pour donner du peps sans être bling-bling, counter animation
 * sur les chiffres clés.
 */

import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Plus, Search, ArrowRight, Sparkles } from 'lucide-react';
import { useCountUp } from '@/hooks/useCountUp';

interface DashboardGreetingProps {
  userName: string | null;
  /** Avatar LinkedIn (ou autre) — si fourni, affiché dans le hero. */
  avatarUrl?: string | null;
  activeCandidatesCount: number;
  activeMissionsCount: number;
}

/** Génère les initiales pour le fallback avatar (ex: "Laurent Garilhe" → "LG"). */
const getInitials = (name: string | null): string => {
  if (!name) return '?';
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '?';
  if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
  return (tokens[0][0] + tokens[tokens.length - 1][0]).toUpperCase();
};

const greetingFor = (hour: number): { greeting: string; emoji: string } => {
  if (hour < 5) return { greeting: 'Bonsoir', emoji: '🌙' };
  if (hour < 12) return { greeting: 'Bonjour', emoji: '☀️' };
  if (hour < 18) return { greeting: 'Bon après-midi', emoji: '👋' };
  return { greeting: 'Bonsoir', emoji: '🌙' };
};

export const DashboardGreeting: React.FC<DashboardGreetingProps> = ({
  userName,
  avatarUrl,
  activeCandidatesCount,
  activeMissionsCount,
}) => {
  const navigate = useNavigate();
  const now = new Date();
  const { greeting, emoji } = greetingFor(now.getHours());

  // Pour le greeting :
  // - "Laurent" / "Laurent Garilhe"      → "Laurent"
  // - "L. Garilhe" (parsé d'email)       → "L. Garilhe" (on garde le full,
  //                                       "Bonjour L." seul serait trop court)
  // - "Garilhe"                           → "Garilhe"
  const firstName = (() => {
    if (!userName) return null;
    const tokens = userName.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return null;
    const first = tokens[0];
    // Initiale type "L." → on garde le nom complet (ne pas tronquer à "L.")
    if (/^[A-Z]\.?$/.test(first)) return userName;
    return first;
  })();

  const candidatesAnim = useCountUp(activeCandidatesCount, { duration: 900 });
  const missionsAnim = useCountUp(activeMissionsCount, { duration: 900 });

  return (
    <motion.header
      className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-foreground/[0.04] via-card to-card mb-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      {/* Subtle decorative blob top-right */}
      <motion.div
        aria-hidden="true"
        className="absolute -top-24 -right-16 h-64 w-64 rounded-full bg-foreground/[0.04] blur-3xl pointer-events-none"
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.2, ease: 'easeOut', delay: 0.1 }}
      />

      <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 px-6 py-6 sm:py-7">
        <div className="flex items-center gap-4 min-w-0">
          {/* Avatar — photo LinkedIn si dispo, sinon initiales sur tile */}
          <motion.div
            className="relative shrink-0"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: 'easeOut', delay: 0.1, type: 'spring', stiffness: 200 }}
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                aria-hidden="true"
                className="h-12 w-12 sm:h-14 sm:w-14 rounded-full object-cover ring-2 ring-card shadow-sm"
                onError={(e) => {
                  // Si le lien casse (token expiré côté Unipile), on bascule sur les initiales
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                  const fallback = (e.currentTarget.nextElementSibling as HTMLElement | null);
                  if (fallback) fallback.style.display = 'flex';
                }}
              />
            ) : null}
            <div
              className="h-12 w-12 sm:h-14 sm:w-14 rounded-full bg-foreground/[0.06] flex items-center justify-center font-display font-bold text-foreground text-base sm:text-lg ring-2 ring-card shadow-sm"
              style={{ display: avatarUrl ? 'none' : 'flex' }}
              aria-hidden="true"
            >
              {getInitials(userName)}
            </div>
            {/* Live dot — signal "session active" */}
            <span className="absolute bottom-0 right-0 flex h-3 w-3">
              <motion.span
                className="absolute inset-0 rounded-full bg-success"
                initial={{ opacity: 0.6, scale: 1 }}
                animate={{ opacity: 0, scale: 2.4 }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
              />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-success ring-2 ring-card" />
            </span>
          </motion.div>

          <div className="min-w-0">
          <motion.h1
            className="font-display font-bold text-foreground text-2xl sm:text-3xl tracking-tight leading-tight"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut', delay: 0.05 }}
          >
            {greeting}
            {firstName ? `, ${firstName}` : ''}{' '}
            <motion.span
              aria-hidden="true"
              className="inline-block"
              initial={{ rotate: -25, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              transition={{ duration: 0.6, ease: 'easeOut', delay: 0.4, type: 'spring', stiffness: 220 }}
            >
              {emoji}
            </motion.span>
          </motion.h1>
          <motion.p
            className="text-sm text-muted-foreground mt-1.5"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut', delay: 0.15 }}
          >
            {format(now, 'EEEE d MMMM', { locale: fr }).replace(/^./, (c) => c.toUpperCase())}
            {activeCandidatesCount > 0 && (
              <>
                {' · '}
                <span className="text-foreground font-medium tabular-nums">{candidatesAnim}</span>{' '}
                candidat{activeCandidatesCount > 1 ? 's' : ''} actif
                {activeCandidatesCount > 1 ? 's' : ''}
                {activeMissionsCount > 0 && (
                  <>
                    {' sur '}
                    <span className="text-foreground font-medium tabular-nums">{missionsAnim}</span>{' '}
                    mission{activeMissionsCount > 1 ? 's' : ''}
                  </>
                )}
              </>
            )}
          </motion.p>
          </div>
        </div>

        {/* Quick action pills */}
        <motion.div
          className="flex items-center gap-1.5 shrink-0 flex-wrap"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.07, delayChildren: 0.25 } },
          }}
        >
          {[
            {
              key: 'create',
              icon: <Plus className="w-3.5 h-3.5" />,
              label: 'Nouvelle mission',
              primary: true,
              onClick: () => navigate('/missions?new=1'),
            },
            {
              key: 'search',
              icon: <Search className="w-3.5 h-3.5" />,
              label: 'Rechercher',
              primary: false,
              onClick: () => navigate('/missions'),
            },
            {
              key: 'inbox',
              icon: <Sparkles className="w-3.5 h-3.5" />,
              label: 'Inbox',
              primary: false,
              suffix: <ArrowRight className="w-3 h-3 opacity-60" />,
              onClick: () => navigate('/inbox'),
            },
          ].map((action) => (
            <motion.button
              key={action.key}
              onClick={action.onClick}
              variants={{
                hidden: { opacity: 0, y: 6 },
                visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } },
              }}
              whileHover={{ scale: 1.03, transition: { duration: 0.15 } }}
              whileTap={{ scale: 0.97 }}
              className={
                action.primary
                  ? 'inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-foreground text-background text-[12px] font-medium hover:opacity-90 transition-opacity shadow-sm'
                  : 'inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border border-border bg-background hover:bg-accent text-[12px] font-medium text-foreground transition-colors'
              }
            >
              {action.icon}
              {action.label}
              {action.suffix}
            </motion.button>
          ))}
        </motion.div>
      </div>
    </motion.header>
  );
};
