/**
 * CopilotRail — Panneau droit persistant qui guide l'utilisateur.
 *
 * Remplace `MissionCopilot` (bottom bar dismissable) par un rail latéral
 * toujours visible. Adresse la friction C : "Je ne sais pas quoi faire
 * ensuite".
 *
 * Mode collapsé : 40px, pulse dot animé pour signaler une action dispo.
 * Mode étendu : 320px, contenu contextualisé selon la phase courante.
 *
 * Le contenu est passé en children — chaque phase peut afficher ce qu'elle
 * veut (next-step card, insights IA, raccourcis…).
 */

import React, { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CopilotRailProps {
  /** Phase courante (affiche dans le sous-titre). */
  phase: 1 | 2 | 3;
  /** Si true, affiche un état "thinking" avec dots animés au lieu de la phase. */
  thinking?: boolean;
  /** Persiste l'état d'expansion en localStorage avec cette clé. */
  storageKey?: string;
  /** Contenu du rail (cards, insights, etc.). Rendu uniquement en mode étendu. */
  children?: React.ReactNode;
}

function loadInitialExpanded(storageKey: string | undefined): boolean {
  if (!storageKey || typeof window === 'undefined') return true;
  try {
    const v = localStorage.getItem(storageKey);
    if (v === null) return true;
    return v === 'true' || v === '1';
  } catch {
    return true;
  }
}

function persistExpanded(storageKey: string | undefined, value: boolean) {
  if (!storageKey || typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey, value ? 'true' : 'false');
  } catch {
    /* silent */
  }
}

export const CopilotRail: React.FC<CopilotRailProps> = ({
  phase,
  thinking = false,
  storageKey = 'konekt:copilotRail:expanded',
  children,
}) => {
  const [expanded, setExpanded] = useState<boolean>(() => loadInitialExpanded(storageKey));

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    persistExpanded(storageKey, next);
  };

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={toggle}
        className="w-10 border-l border-border flex flex-col items-center pt-3 gap-2 hover:bg-accent/50 transition-colors flex-shrink-0"
        title="Ouvrir le Copilot"
      >
        <div
          className="h-7 w-7 rounded-lg grid place-items-center"
          style={{
            background: 'linear-gradient(135deg, hsl(271 81% 56%), hsl(330 81% 60%), hsl(217 91% 60%))',
            backgroundSize: '200% 200%',
            animation: 'konektBgPan 8s ease-in-out infinite',
          }}
        >
          <Sparkles className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
        </div>
        <span
          className="h-2 w-2 rounded-full"
          style={{
            background: 'hsl(var(--status-success))',
            animation: 'konektPulseDot 1.6s ease-in-out infinite',
          }}
        />
      </button>
    );
  }

  return (
    <aside
      className="border-l border-border bg-background flex-shrink-0 flex flex-col"
      style={{ width: 320 }}
    >
      {/* Header */}
      <div className="px-4 h-14 border-b border-border flex items-center gap-2 flex-shrink-0">
        <div
          className="relative h-7 w-7 rounded-lg grid place-items-center"
          style={{
            background: 'linear-gradient(135deg, hsl(271 81% 56%), hsl(330 81% 60%), hsl(217 91% 60%))',
            backgroundSize: '200% 200%',
            animation: 'konektBgPan 8s ease-in-out infinite',
          }}
        >
          <Sparkles className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold leading-tight">Copilot</p>
          <p className="text-[10px] text-muted-foreground leading-tight">
            {thinking ? (
              <span className="inline-flex items-center gap-0.5">
                Analyse en cours
                <span className={cn('inline-block w-1 h-1 rounded-full bg-current ml-1')} style={{ animation: 'konektPulseDot 1.6s 0s infinite' }} />
                <span className={cn('inline-block w-1 h-1 rounded-full bg-current')} style={{ animation: 'konektPulseDot 1.6s 0.2s infinite' }} />
                <span className={cn('inline-block w-1 h-1 rounded-full bg-current')} style={{ animation: 'konektPulseDot 1.6s 0.4s infinite' }} />
              </span>
            ) : (
              <>Phase {phase} · actif</>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          className="h-7 w-7 grid place-items-center rounded hover:bg-accent text-muted-foreground transition-colors"
          title="Réduire le Copilot"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Body — children scrollable */}
      <div className="flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
};
