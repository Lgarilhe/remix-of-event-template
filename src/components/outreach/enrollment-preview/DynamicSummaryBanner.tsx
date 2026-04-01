import React from 'react';
import { LinkedInProfile } from '@/components/outreach/types';
import { CandidateStatesMap } from './types';
import { BarChart3, Users, AlertTriangle, Sparkles } from 'lucide-react';

interface Props {
  profiles: LinkedInProfile[];
  states: CandidateStatesMap;
  generatedCount: number;
  totalToGenerate: number;
  estimatedCredits: number;
  hasAiSteps: boolean;
}

export function DynamicSummaryBanner({ profiles, states, generatedCount, totalToGenerate, estimatedCredits, hasAiSteps }: Props) {
  const removed = Array.from(states.values()).filter(s => s.removed).length;
  const skipped = Array.from(states.values()).filter(s => s.skipped).length;
  const active = profiles.length - removed - skipped;

  const withEmail = profiles.filter(p => !states.get(p.id)?.removed && !states.get(p.id)?.skipped && p.contact_info?.emails?.length).length;
  const withoutEmail = active - withEmail;
  const withoutPhone = profiles.filter(p => !states.get(p.id)?.removed && !states.get(p.id)?.skipped && !p.contact_info?.phones?.length).length;

  const activeCredits = hasAiSteps ? active * 2 : 0;

  return (
    <div className="px-4 py-2 border-b border-border bg-muted/20 flex items-center gap-4 flex-wrap text-[11px]">
      <span className="flex items-center gap-1">
        <Users className="w-3.5 h-3.5 text-foreground/70" />
        <strong>{active}</strong> candidat{active > 1 ? 's' : ''} sélectionné{active > 1 ? 's' : ''}
        {removed > 0 && <span className="text-muted-foreground">({removed} retiré{removed > 1 ? 's' : ''})</span>}
        {skipped > 0 && <span className="text-muted-foreground">· {skipped} passé{skipped > 1 ? 's' : ''}</span>}
      </span>

      <span className="text-muted-foreground">|</span>

      <span className="flex items-center gap-1">
        ✅ {withEmail} avec email + LinkedIn
        {withoutEmail > 0 && (
          <span className="flex items-center gap-0.5 text-amber-600">
            <AlertTriangle className="w-3 h-3" /> {withoutEmail} sans email
          </span>
        )}
        {withoutPhone > 0 && (
          <span className="flex items-center gap-0.5 text-amber-600">
            · {withoutPhone} sans tél
          </span>
        )}
      </span>

      {hasAiSteps && (
        <>
          <span className="text-muted-foreground">|</span>
          <span className="flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-amber-500" />
            Previews : {generatedCount}/{totalToGenerate} · ~{activeCredits} crédits
          </span>
        </>
      )}
    </div>
  );
}
