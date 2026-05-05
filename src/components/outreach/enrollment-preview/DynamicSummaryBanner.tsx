import React from 'react';
import { LinkedInProfile } from '@/components/outreach/types';
import { CandidateStatesMap } from './types';
import { Users, AlertTriangle, Sparkles, MailWarning, PhoneOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  profiles: LinkedInProfile[];
  states: CandidateStatesMap;
  generatedCount: number;
  totalToGenerate: number;
  estimatedCredits: number;
  hasAiSteps: boolean;
}

/**
 * Bandeau stats du modal d'enrollment.
 *
 * Refonte UX : on est passé d'une rangée de texte avec pipes "|" et emojis
 * mélangés à des pills propres (couleur du token sémantique : muted /
 * warning / brand). Plus lisible, plus scannable, plus d'incohérences
 * de couleurs hardcodées.
 */
export function DynamicSummaryBanner({
  profiles, states, generatedCount, totalToGenerate, estimatedCredits, hasAiSteps,
}: Props) {
  const removed = Array.from(states.values()).filter(s => s.removed).length;
  const skipped = Array.from(states.values()).filter(s => s.skipped).length;
  const active = profiles.length - removed - skipped;

  const withEmail = profiles.filter(p =>
    !states.get(p.id)?.removed
    && !states.get(p.id)?.skipped
    && p.contact_info?.emails?.length
  ).length;
  const withoutEmail = active - withEmail;
  const withoutPhone = profiles.filter(p =>
    !states.get(p.id)?.removed
    && !states.get(p.id)?.skipped
    && !p.contact_info?.phones?.length
  ).length;

  const previewProgress = totalToGenerate > 0 ? generatedCount / totalToGenerate : 0;
  const isComplete = previewProgress >= 1;

  return (
    <div className="px-4 py-2 border-b border-border bg-muted/15 flex items-center gap-2 flex-wrap">
      {/* Pill principale : compteur candidats actifs */}
      <Pill icon={Users} tone="default" emphasis>
        <strong className="tabular-nums">{active}</strong>
        <span className="text-muted-foreground">/ {profiles.length} candidat{profiles.length > 1 ? 's' : ''}</span>
        {(removed > 0 || skipped > 0) && (
          <span className="text-[10px] text-muted-foreground">
            {removed > 0 && `${removed} retiré${removed > 1 ? 's' : ''}`}
            {removed > 0 && skipped > 0 && ' · '}
            {skipped > 0 && `${skipped} passé${skipped > 1 ? 's' : ''}`}
          </span>
        )}
      </Pill>

      {/* Pill email — gris si tout le monde a un email, warning sinon */}
      {active > 0 && (
        <Pill
          icon={MailWarning}
          tone={withoutEmail === 0 ? 'success' : 'warning'}
        >
          {withoutEmail === 0
            ? <>tous avec email</>
            : <><strong className="tabular-nums">{withoutEmail}</strong> sans email</>}
        </Pill>
      )}

      {/* Pill téléphone — n'apparaît que si manque */}
      {withoutPhone > 0 && (
        <Pill icon={PhoneOff} tone="warning">
          <strong className="tabular-nums">{withoutPhone}</strong> sans tél
        </Pill>
      )}

      {/* Pill previews IA — n'apparaît que si la séquence a des étapes IA */}
      {hasAiSteps && (
        <Pill
          icon={Sparkles}
          tone={isComplete ? 'success' : 'brand'}
          className="ml-auto"
        >
          <span className="tabular-nums">{generatedCount}/{totalToGenerate}</span>
          <span className="text-[10px] text-muted-foreground">
            previews · ~{estimatedCredits} cr
          </span>
        </Pill>
      )}
    </div>
  );
}

// ─── Pill primitive ─────────────────────────────────────────────────

interface PillProps {
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'default' | 'success' | 'warning' | 'destructive' | 'brand';
  emphasis?: boolean;
  className?: string;
  children: React.ReactNode;
}

function Pill({ icon: Icon, tone = 'default', emphasis, className, children }: PillProps) {
  const toneClasses: Record<string, string> = {
    default: emphasis
      ? 'bg-foreground/[0.08] border-border text-foreground'
      : 'bg-muted/30 border-border text-foreground',
    success: 'bg-success/10 border-success/30 text-success',
    warning: 'bg-warning/10 border-warning/30 text-warning',
    destructive: 'bg-destructive/10 border-destructive/30 text-destructive',
    brand: 'bg-info/10 border-info/30 text-info',
  };

  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 h-6 px-2 rounded-md border text-[11px] whitespace-nowrap',
      toneClasses[tone],
      className,
    )}>
      <Icon className="w-3 h-3 shrink-0" />
      {children}
    </span>
  );
}
