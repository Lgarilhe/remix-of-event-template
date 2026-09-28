import React from 'react';
import { LinkedInProfile } from '@/components/outreach/types';
import { CandidateStatesMap } from './types';
import { Check, MailX, PhoneOff, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface Props {
  profiles: LinkedInProfile[];
  states: CandidateStatesMap;
  /**
   * Candidats qui seront réellement inscrits (hors retirés, passés, déjà
   * contactés et incompatibles). Sans lui, seuls les retirés et passés sont
   * déduits.
   */
  activeProfiles?: LinkedInProfile[];
  /** Exclus car déjà contactés par l'organisation (détail du compteur). */
  duplicateExcludedCount?: number;
  /** Exclus car incompatibles avec la séquence (détail du compteur). */
  incompatibleExcludedCount?: number;
  /** Candidats qui seront inscrits dont tous les aperçus sont prêts. */
  readyCount: number;
}

/**
 * Bandeau de la préparation : combien de candidats seront inscrits, qui
 * manque d'un moyen de contact, où en sont les aperçus. Badges du kit, sans
 * mouvement ni dégradé (revue design D-50) ; le coût est annoncé à côté du
 * bouton de génération, avant l'action. Masqué sur téléphone : l'en-tête, la
 * liste et le résumé y portent les mêmes informations.
 */
export function DynamicSummaryBanner({
  profiles, states, activeProfiles, duplicateExcludedCount, incompatibleExcludedCount, readyCount,
}: Props) {
  const removed = profiles.filter(p => states.get(p.id)?.removed).length;
  const skipped = profiles.filter(p => !states.get(p.id)?.removed && states.get(p.id)?.skipped).length;
  const pool = activeProfiles
    ?? profiles.filter(p => !states.get(p.id)?.removed && !states.get(p.id)?.skipped);
  const active = pool.length;
  // Déjà contactés ou incompatibles avec la séquence : exclus de l'inscription.
  const excluded = Math.max(0, profiles.length - removed - skipped - active);
  const duplicates = duplicateExcludedCount ?? 0;
  const incompatible = incompatibleExcludedCount ?? 0;
  // Exclus sans raison détaillée par l'appelant (compatibilité ascendante).
  const otherExcluded = Math.max(0, excluded - duplicates - incompatible);

  const withoutEmail = pool.filter(p => !p.contact_info?.emails?.length).length;
  const withoutPhone = pool.filter(p => !p.contact_info?.phones?.length).length;

  const details = [
    duplicates > 0 && `${duplicates} déjà contacté${duplicates > 1 ? 's' : ''}`,
    incompatible > 0 && `${incompatible} incompatible${incompatible > 1 ? 's' : ''}`,
    otherExcluded > 0 && `${otherExcluded} exclu${otherExcluded > 1 ? 's' : ''}`,
    removed > 0 && `${removed} retiré${removed > 1 ? 's' : ''}`,
    skipped > 0 && `${skipped} passé${skipped > 1 ? 's' : ''}`,
  ].filter(Boolean).join(', ');

  const allReady = active > 0 && readyCount >= active;

  return (
    <div className="hidden shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 sm:flex sm:px-6">
      <Badge variant="muted" className="tabular-nums">
        <Users className="h-3 w-3" aria-hidden="true" />
        {active} sur {profiles.length} {active > 1 ? 'seront inscrits' : 'sera inscrit'}
        {details && <span className="font-normal">({details})</span>}
      </Badge>

      {active > 0 && withoutEmail > 0 && (
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
        Aperçus prêts : {readyCount} sur {active}
      </Badge>
    </div>
  );
}
