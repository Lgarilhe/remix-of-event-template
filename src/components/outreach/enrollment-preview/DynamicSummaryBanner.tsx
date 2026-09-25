import React from 'react';
import { LinkedInProfile } from '@/components/outreach/types';
import { CandidateStatesMap } from './types';
import { Check, MailX, PhoneOff, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface Props {
  profiles: LinkedInProfile[];
  states: CandidateStatesMap;
  /** Candidats qui seront inscrits (hors retirés, passés et déjà contactés). */
  enrollCount: number;
  /** Candidats encore dans la liste dont tous les aperçus sont prêts. */
  readyCount: number;
}

/**
 * Bandeau de la préparation : combien de candidats seront inscrits, qui
 * manque d'un moyen de contact, où en sont les aperçus. Badges du kit, sans
 * mouvement ni dégradé (revue design D-50) ; le coût est annoncé à côté du
 * bouton de génération, avant l'action. Masqué sur téléphone : l'en-tête, la
 * liste et le résumé y portent les mêmes informations.
 */
export function DynamicSummaryBanner({ profiles, states, enrollCount, readyCount }: Props) {
  const removed = Array.from(states.values()).filter(s => s.removed).length;
  const skipped = Array.from(states.values()).filter(s => s.skipped && !s.removed).length;
  const listed = profiles.length - removed;
  const excluded = Math.max(0, listed - skipped - enrollCount);

  const reachable = profiles.filter(p => !states.get(p.id)?.removed && !states.get(p.id)?.skipped);
  const withoutEmail = reachable.filter(p => !p.contact_info?.emails?.length).length;
  const withoutPhone = reachable.filter(p => !p.contact_info?.phones?.length).length;

  const details = [
    removed > 0 && `${removed} ${removed > 1 ? 'retirés' : 'retiré'}`,
    skipped > 0 && `${skipped} ${skipped > 1 ? 'passés' : 'passé'}`,
    excluded > 0 && `${excluded} déjà ${excluded > 1 ? 'contactés' : 'contacté'}`,
  ].filter(Boolean).join(', ');

  const allReady = listed > 0 && readyCount >= listed;

  return (
    <div className="hidden shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 sm:flex sm:px-6">
      <Badge variant="muted" className="tabular-nums">
        <Users className="h-3 w-3" aria-hidden="true" />
        {enrollCount} à inscrire sur {profiles.length}
        {details && <span className="font-normal">({details})</span>}
      </Badge>

      {reachable.length > 0 && withoutEmail > 0 && (
        <Badge variant="warning" className="tabular-nums">
          <MailX className="h-3 w-3" aria-hidden="true" />
          {withoutEmail} sans e-mail
        </Badge>
      )}

      {withoutPhone > 0 && (
        <Badge variant="warning" className="tabular-nums">
          <PhoneOff className="h-3 w-3" aria-hidden="true" />
          {withoutPhone} sans téléphone
        </Badge>
      )}

      <Badge variant={allReady ? 'success' : 'muted'} className="tabular-nums sm:ml-auto">
        {allReady && <Check className="h-3 w-3" aria-hidden="true" />}
        Aperçus prêts : {readyCount} sur {listed}
      </Badge>
    </div>
  );
}
