import { useCallback } from 'react';
import { resolveRecruiter, type RecruiterRef } from '@/lib/callRecruiter';
import { useTeamMembers } from '@/hooks/useTeamMembers';

/**
 * Quel recruteur de l'équipe a passé ou reçu un appel (e-mail de l'agent de
 * l'opérateur rapproché de celui des membres). Le résultat est stable tant
 * que la liste des membres ne change pas.
 */
export function useCallRecruiter(): (agentEmail: string | null | undefined, agentName: string | null | undefined) => RecruiterRef | null {
  const { members } = useTeamMembers();
  return useCallback((agentEmail, agentName) => resolveRecruiter(members, agentEmail, agentName), [members]);
}
