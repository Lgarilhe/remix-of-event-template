/**
 * DashboardFocusPanel — "Ce qui demande votre attention aujourd'hui".
 *
 * Coeur du Dashboard SaaS moderne : on agrège tout ce qui est *actionnable* en
 * une grille de cartes color-coded. L'user voit en 1 seconde ce qui réclame
 * son attention et clique pour aller traiter.
 *
 * V2 anim : staggered card entrance, counter animation sur les chiffres,
 * pulse subtil sur les cards critiques (count > 0), hover lift + chevron
 * slide-in.
 */

import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  MessageCircle,
  Bell,
  UserCheck,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCountUp } from '@/hooks/useCountUp';
import { LivePulse } from './LivePulse';

export interface FocusItem {
  key: string;
  label: string;
  count: number;
  description: string;
  icon: React.ReactNode;
  href: string;
  tone: 'destructive' | 'warning' | 'info' | 'success';
  /** Si true, on affiche un LivePulse pour signaler "temps réel". */
  live?: boolean;
}

interface DashboardFocusPanelProps {
  unreadMessages: number;
  stagnantCandidates: number;
  remindersToday: number;
  pendingResponses: number;
}

const TONE_STYLES: Record<
  FocusItem['tone'],
  { bg: string; iconBg: string; iconColor: string; ring: string; glow: string }
> = {
  destructive: {
    bg: 'bg-destructive/[0.04] hover:bg-destructive/[0.08]',
    iconBg: 'bg-destructive/10',
    iconColor: 'text-destructive',
    ring: 'border-destructive/20 hover:border-destructive/40',
    glow: 'before:bg-destructive/20',
  },
  warning: {
    bg: 'bg-warning/[0.04] hover:bg-warning/[0.08]',
    iconBg: 'bg-warning/10',
    iconColor: 'text-warning',
    ring: 'border-warning/20 hover:border-warning/40',
    glow: 'before:bg-warning/20',
  },
  info: {
    bg: 'bg-info/[0.04] hover:bg-info/[0.08]',
    iconBg: 'bg-info/10',
    iconColor: 'text-info',
    ring: 'border-info/20 hover:border-info/40',
    glow: 'before:bg-info/20',
  },
  success: {
    bg: 'bg-success/[0.04] hover:bg-success/[0.08]',
    iconBg: 'bg-success/10',
    iconColor: 'text-success',
    ring: 'border-success/20 hover:border-success/40',
    glow: 'before:bg-success/20',
  },
};

const FocusCard: React.FC<{ item: FocusItem; index: number }> = ({ item, index }) => {
  const navigate = useNavigate();
  const styles = TONE_STYLES[item.tone];
  const isActive = item.count > 0;
  const animatedCount = useCountUp(item.count, { duration: 900 });

  return (
    <motion.button
      onClick={() => navigate(item.href)}
      variants={{
        hidden: { opacity: 0, y: 10 },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.4, ease: 'easeOut', delay: index * 0.06 },
        },
      }}
      whileHover={{ y: -2, transition: { duration: 0.15 } }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        'group relative rounded-xl border p-4 text-left transition-colors overflow-hidden',
        isActive
          ? `${styles.bg} ${styles.ring}`
          : 'bg-card border-border hover:bg-muted/40',
      )}
    >
      {/* Pulsing glow halo on active cards (very subtle) */}
      {isActive && (
        <motion.div
          aria-hidden="true"
          className={cn('absolute -top-12 -right-12 h-32 w-32 rounded-full blur-2xl pointer-events-none', styles.iconBg)}
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      <div className="relative flex items-start justify-between gap-2 mb-3">
        <div
          className={cn(
            'h-9 w-9 rounded-lg flex items-center justify-center shrink-0',
            isActive ? `${styles.iconBg} ${styles.iconColor}` : 'bg-emerald-500/15 text-foreground',
          )}
        >
          {item.icon}
        </div>
        <div className="flex items-center gap-2">
          {isActive && item.live && <LivePulse tone={item.tone === 'success' ? 'success' : item.tone === 'destructive' ? 'destructive' : 'info'} />}
          <ArrowRight
            className={cn(
              'w-4 h-4 shrink-0 transition-all opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0',
              isActive ? styles.iconColor : 'text-muted-foreground',
            )}
            aria-hidden="true"
          />
        </div>
      </div>

      <div
        className={cn(
          'relative font-display text-2xl font-bold tabular-nums leading-none mb-1.5',
          isActive ? 'text-foreground' : 'text-muted-foreground/60',
        )}
      >
        {animatedCount}
      </div>
      <div
        className={cn(
          'relative text-[13px] font-semibold leading-tight',
          isActive ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {item.label}
      </div>
      <div className="relative text-xs text-muted-foreground mt-0.5 truncate">
        {item.description}
      </div>
    </motion.button>
  );
};

export const DashboardFocusPanel: React.FC<DashboardFocusPanelProps> = ({
  unreadMessages,
  stagnantCandidates,
  remindersToday,
  pendingResponses,
}) => {
  const items: FocusItem[] = [
    {
      key: 'unread',
      label: 'Réponses non lues',
      count: unreadMessages,
      description: unreadMessages > 0 ? "À traiter dans l'inbox" : 'Inbox à jour',
      icon: <MessageCircle className="w-4 h-4" />,
      href: '/inbox',
      tone: 'info',
      live: true,
    },
    {
      key: 'pending',
      label: 'Candidats à relancer',
      count: pendingResponses,
      description: pendingResponses > 0 ? 'Ont répondu, en attente' : 'Aucune relance urgente',
      icon: <UserCheck className="w-4 h-4" />,
      href: '/pipeline',
      tone: 'warning',
    },
    {
      key: 'stagnant',
      label: 'Candidats stagnants',
      count: stagnantCandidates,
      description: stagnantCandidates > 0 ? 'Au-delà du temps cible' : 'Pipeline fluide',
      icon: <AlertTriangle className="w-4 h-4" />,
      href: '/pipeline?view=analytics',
      tone: 'destructive',
    },
    {
      key: 'reminders',
      label: 'Rappels du jour',
      count: remindersToday,
      description: remindersToday > 0 ? "À traiter aujourd'hui" : 'Aucun rappel',
      icon: <Bell className="w-4 h-4" />,
      href: '/tasks',
      tone: 'success',
    },
  ];

  const totalActionable = items.reduce((s, i) => s + i.count, 0);

  if (totalActionable === 0) {
    return (
      <motion.div
        className="rounded-xl bg-card border border-border p-6 flex items-center gap-4 mb-6 relative overflow-hidden"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <motion.div
          aria-hidden="true"
          className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-success/10 blur-3xl pointer-events-none"
          animate={{ opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="h-10 w-10 rounded-full bg-success/10 text-success flex items-center justify-center shrink-0 relative"
          initial={{ scale: 0.7 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 220, delay: 0.2 }}
        >
          <CheckCircle2 className="w-5 h-5" />
        </motion.div>
        <div className="min-w-0 relative">
          <h2 className="font-display font-bold text-foreground text-base tracking-tight">
            Tout est à jour
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Pas d'action urgente — bon moment pour sourcer ou peaufiner un brief.
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="mb-6">
      <motion.div
        className="flex items-center gap-2 mb-3"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
      >
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Pour aujourd'hui
        </span>
        <div className="flex-1 h-px bg-border" />
        <span className="inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-full text-[11px] text-foreground bg-foreground/10 font-bold tabular-nums">
          {totalActionable}
        </span>
      </motion.div>

      <motion.div
        className="grid grid-cols-2 lg:grid-cols-4 gap-3"
        initial="hidden"
        animate="visible"
        variants={{
          hidden: {},
          visible: { transition: { staggerChildren: 0.06 } },
        }}
      >
        {items.map((item, i) => (
          <FocusCard key={item.key} item={item} index={i} />
        ))}
      </motion.div>
    </div>
  );
};
