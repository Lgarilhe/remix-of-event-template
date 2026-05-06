/**
 * DashboardFocusPanel — "Ce qui demande votre attention aujourd'hui".
 *
 * Coeur du Dashboard SaaS moderne : on agrège tout ce qui est *actionnable* en
 * une grille de cartes color-coded. L'user voit en 1 seconde ce qui réclame
 * son attention et clique pour aller traiter.
 *
 * Pattern Linear/Pipedrive : pas de tableau de chiffres, des CTAs.
 *
 * Cards :
 * - Réponses non lues (Inbox)
 * - Candidats stagnants (Pipeline)
 * - Rappels du jour (Tasks)
 * - Réponses récentes à traiter (Pipeline filtre Répondu)
 *
 * Si TOUT est à zéro, on affiche un message zéro-état "Tout est à jour".
 */

import React from 'react';
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

export interface FocusItem {
  key: string;
  label: string;
  count: number;
  description: string;
  icon: React.ReactNode;
  href: string;
  tone: 'destructive' | 'warning' | 'info' | 'success';
}

interface DashboardFocusPanelProps {
  unreadMessages: number;
  stagnantCandidates: number;
  remindersToday: number;
  pendingResponses: number;
}

const TONE_STYLES: Record<FocusItem['tone'], { bg: string; iconBg: string; iconColor: string; ring: string }> = {
  destructive: {
    bg: 'bg-destructive/[0.04] hover:bg-destructive/[0.08]',
    iconBg: 'bg-destructive/10',
    iconColor: 'text-destructive',
    ring: 'border-destructive/20 hover:border-destructive/40',
  },
  warning: {
    bg: 'bg-warning/[0.04] hover:bg-warning/[0.08]',
    iconBg: 'bg-warning/10',
    iconColor: 'text-warning',
    ring: 'border-warning/20 hover:border-warning/40',
  },
  info: {
    bg: 'bg-info/[0.04] hover:bg-info/[0.08]',
    iconBg: 'bg-info/10',
    iconColor: 'text-info',
    ring: 'border-info/20 hover:border-info/40',
  },
  success: {
    bg: 'bg-success/[0.04] hover:bg-success/[0.08]',
    iconBg: 'bg-success/10',
    iconColor: 'text-success',
    ring: 'border-success/20 hover:border-success/40',
  },
};

export const DashboardFocusPanel: React.FC<DashboardFocusPanelProps> = ({
  unreadMessages,
  stagnantCandidates,
  remindersToday,
  pendingResponses,
}) => {
  const navigate = useNavigate();

  const items: FocusItem[] = [
    {
      key: 'unread',
      label: 'Réponses non lues',
      count: unreadMessages,
      description: unreadMessages > 0 ? 'À traiter dans l\'inbox' : 'Inbox à jour',
      icon: <MessageCircle className="w-4 h-4" />,
      href: '/inbox',
      tone: 'info',
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
      description: remindersToday > 0 ? 'À traiter aujourd\'hui' : 'Aucun rappel',
      icon: <Bell className="w-4 h-4" />,
      href: '/tasks',
      tone: 'success',
    },
  ];

  const totalActionable = items.reduce((s, i) => s + i.count, 0);

  if (totalActionable === 0) {
    return (
      <div className="rounded-xl bg-card border border-border p-6 flex items-center gap-4 mb-6">
        <div className="h-10 w-10 rounded-full bg-success/10 text-success flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h2 className="font-display font-bold text-foreground text-base tracking-tight">
            Tout est à jour
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Pas d'action urgente — bon moment pour sourcer ou peaufiner un brief.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Pour aujourd'hui
        </span>
        <div className="flex-1 h-px bg-border" />
        <span className="inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-full text-[11px] text-foreground bg-foreground/10 font-bold tabular-nums">
          {totalActionable}
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {items.map(item => {
          const styles = TONE_STYLES[item.tone];
          const isActive = item.count > 0;
          return (
            <button
              key={item.key}
              onClick={() => navigate(item.href)}
              className={cn(
                'group rounded-xl border p-4 text-left transition-all',
                isActive
                  ? `${styles.bg} ${styles.ring} hover:shadow-sm`
                  : 'bg-card border-border hover:bg-muted/40',
              )}
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div
                  className={cn(
                    'h-9 w-9 rounded-lg flex items-center justify-center shrink-0',
                    isActive ? `${styles.iconBg} ${styles.iconColor}` : 'bg-foreground/[0.06] text-muted-foreground',
                  )}
                >
                  {item.icon}
                </div>
                <ArrowRight
                  className={cn(
                    'w-4 h-4 shrink-0 transition-all opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0',
                    isActive ? styles.iconColor : 'text-muted-foreground',
                  )}
                  aria-hidden="true"
                />
              </div>

              <div
                className={cn(
                  'font-display text-2xl font-bold tabular-nums leading-none mb-1.5',
                  isActive ? 'text-foreground' : 'text-muted-foreground/60',
                )}
              >
                {item.count}
              </div>
              <div
                className={cn(
                  'text-[13px] font-semibold leading-tight',
                  isActive ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {item.label}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 truncate">
                {item.description}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
