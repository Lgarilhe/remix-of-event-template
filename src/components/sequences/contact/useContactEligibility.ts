// Refonte mission, lot 5f-2c : ce que le panneau Contacter sait de chaque candidat avant l'inscription.
//
// Trois lectures, les mêmes que les fenêtres d'inscription d'aujourd'hui :
//   - déjà dans la séquence, ou déjà passé par elle (findBlockingSequenceEnrollments) ;
//   - contacté par un membre de l'organisation ces 90 derniers jours
//     (findRecentEnrollments, avec le libellé « Déjà contacté par Marie le 03/10/2026 ») ;
//   - incompatible avec la séquence d'après la distance de réseau (checkProfilesCompat) :
//     hors réseau et « une invitation seule déjà en relation » excluent (dérogation
//     possible), « invitation sautée » et « InMail inutile » avertissent seulement.
// Seuls les candidats avec un lien LinkedIn sont vérifiés. Les profils effacés ne
// viennent pas d'ici : ils viennent de l'aperçu (ContactFlow).
//
// Une lecture en échec est 'error' : l'inscription est alors refusée par le
// panneau, jamais d'inscription sans l'anti-doublon. `recentMap` est la carte brute
// de l'anti-doublon, que enrollCandidates reprend sans la relire.

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { LinkedInProfile } from '@/components/outreach/types';
import {
  classifyExistingEnrollment,
  findBlockingSequenceEnrollments,
} from '@/components/outreach/enrollment-preview/enrollmentHelpers';
import { findRecentEnrollments, formatRecentContactLabel, type RecentEnrollment } from '@/lib/enrollmentDuplicates';
import { checkProfilesCompat } from '@/lib/sequenceCompatibility';
import type { ContactEligibility } from '@/lib/contactFlowGroups';
import type { FlowCandidate } from './types';
import type { SequenceStepRow } from './useSequenceSteps';

export type ContactEligibilityStatus = 'loading' | 'error' | 'ready';

/** Ce que ce hook lit : tout sauf les profils effacés. */
export type PartialEligibility = Omit<ContactEligibility, 'erased'>;

export interface ContactEligibilityState extends PartialEligibility {
  /** Carte brute de l'anti-doublon (candidat vers dernier contact), null tant qu'elle n'est pas lue. */
  recentMap: Map<string, RecentEnrollment> | null;
  status: ContactEligibilityStatus;
  retry: () => void;
}

interface ContactEligibilityOptions {
  sequenceId: string | null;
  /** Lignes brutes de la séquence choisie, null tant qu'elles ne sont pas lues. */
  rawSteps: readonly SequenceStepRow[] | null;
  candidates: readonly FlowCandidate[];
  organizationId: string | null;
}

export const CONTACT_ELIGIBILITY_KEY = 'contact-flow-eligibility';

interface RemoteEligibility {
  blocking: Map<string, 'in_sequence' | 'passed'>;
  recent: Map<string, RecentEnrollment>;
}

const NO_RECENT: Map<string, RecentEnrollment> = new Map();

export function useContactEligibility({
  sequenceId,
  rawSteps,
  candidates,
  organizationId,
}: ContactEligibilityOptions): ContactEligibilityState {
  // Seuls les candidats avec un lien LinkedIn sont vérifiés (les autres sont « à compléter »).
  const profiles = useMemo<LinkedInProfile[]>(
    () => candidates.filter((candidate) => candidate.hasLinkedIn).map((candidate) => candidate.profile),
    [candidates],
  );
  const signature = useMemo(() => profiles.map((profile) => profile.id).join('\u0001'), [profiles]);

  const query = useQuery({
    queryKey: [CONTACT_ELIGIBILITY_KEY, organizationId, sequenceId, signature],
    queryFn: async (): Promise<RemoteEligibility> => {
      const [matches, recent] = await Promise.all([
        findBlockingSequenceEnrollments(supabase, sequenceId as string, profiles),
        findRecentEnrollments(supabase, organizationId as string, profiles),
      ]);
      const blocking = new Map<string, 'in_sequence' | 'passed'>();
      matches.blocking.forEach((entry, id) => blocking.set(id, classifyExistingEnrollment(entry.status)));
      return { blocking, recent };
    },
    enabled: !!sequenceId && !!organizationId && profiles.length > 0,
    // Toujours relu : un contact d'un collègue, une inscription faite depuis un autre onglet.
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const { refetch: refetchQuery } = query;
  const retry = useCallback(() => {
    void refetchQuery();
  }, [refetchQuery]);

  const remote = query.data;
  const recentMap = profiles.length === 0 ? NO_RECENT : remote?.recent ?? null;

  const recent = useMemo(() => {
    const labels = new Map<string, string>();
    remote?.recent.forEach((entry, id) => labels.set(id, formatRecentContactLabel(entry)));
    return labels;
  }, [remote]);

  const compat = useMemo(() => {
    const incompatible = new Map<string, 'too_far' | 'connection_only_already_connected'>();
    const warnings = new Map<string, 'connection_already_connected' | 'inmail_wasted'>();
    if (!rawSteps) return { incompatible, warnings };
    const result = checkProfilesCompat(profiles, [...rawSteps]);
    for (const blocker of result.blockers) {
      if (blocker.issue === 'too_far' || blocker.issue === 'connection_only_already_connected') {
        incompatible.set(blocker.profile.id, blocker.issue);
      }
    }
    for (const warning of result.warnings) {
      if (warning.issue === 'connection_already_connected' || warning.issue === 'inmail_wasted') {
        warnings.set(warning.profile.id, warning.issue);
      }
    }
    return { incompatible, warnings };
  }, [profiles, rawSteps]);

  const blocking = useMemo(() => remote?.blocking ?? new Map<string, 'in_sequence' | 'passed'>(), [remote]);

  let status: ContactEligibilityStatus;
  if (!sequenceId || !organizationId || !rawSteps) status = 'loading';
  else if (profiles.length === 0 || remote !== undefined) status = 'ready';
  // Hors ligne la lecture reste en attente : « Réessayer » plutôt qu'un chargement sans fin.
  else if (query.isError || query.fetchStatus === 'paused') status = 'error';
  else status = 'loading';

  return {
    blocking,
    recent,
    incompatible: compat.incompatible,
    warnings: compat.warnings,
    recentMap,
    status,
    retry,
  };
}
