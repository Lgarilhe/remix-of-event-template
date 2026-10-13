import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fetchPhoneCallsForCandidate, type PhoneCall } from '@/lib/phoneCalls';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';

interface UsePhoneCallHistoryResult {
  calls: PhoneCall[];
  loading: boolean;
  totalCalls: number;
  /** Somme des durées de conversation, en secondes. */
  totalTalkSeconds: number;
}

/**
 * Historique des appels d'un candidat (opérateur relié par l'organisation).
 * `extraNumbers` : numéros déjà lus ailleurs sur la fiche, en plus de ceux
 * enregistrés pour le candidat.
 */
export function usePhoneCallHistory(
  candidateId: string | null | undefined,
  extraNumbers: ReadonlyArray<string | null | undefined> = [],
): UsePhoneCallHistoryResult {
  const { organizationId } = useOrganization();
  const { user, isReady } = useAuthReady();
  const userId = user?.id;
  const [calls, setCalls] = useState<PhoneCall[]>([]);
  const [loading, setLoading] = useState(false);
  const extraKey = extraNumbers.filter(Boolean).join('|');
  const scopeKey = JSON.stringify([userId, organizationId, candidateId, extraKey]);
  const currentScope = useRef({ key: scopeKey });
  if (currentScope.current.key !== scopeKey) currentScope.current = { key: scopeKey };
  const scope = currentScope.current;

  useLayoutEffect(() => { setCalls([]); setLoading(false); }, [scopeKey]);

  useEffect(() => {
    if (!isReady || !userId || !organizationId || (!candidateId && !extraKey)) {
      setCalls([]);
      return;
    }
    let cancelled = false;
    const isCurrent = () => !cancelled && currentScope.current === scope;
    setLoading(true);
    fetchPhoneCallsForCandidate(candidateId, extraKey ? extraKey.split('|') : [], organizationId)
      .then((rows) => { if (isCurrent()) setCalls(rows); })
      .catch((err) => {
        console.error('usePhoneCallHistory error:', err);
        if (isCurrent()) setCalls([]);
      })
      .finally(() => { if (isCurrent()) setLoading(false); });
    return () => { cancelled = true; };
  }, [candidateId, extraKey, organizationId, userId, isReady, scope]);

  const totalTalkSeconds = calls.reduce((sum, c) => sum + c.talkSeconds, 0);
  return { calls, loading, totalCalls: calls.length, totalTalkSeconds };
}
