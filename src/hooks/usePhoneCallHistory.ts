import { useEffect, useState } from 'react';
import { fetchPhoneCallsForCandidate, type PhoneCall } from '@/lib/phoneCalls';

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
  const [calls, setCalls] = useState<PhoneCall[]>([]);
  const [loading, setLoading] = useState(false);
  const extraKey = extraNumbers.filter(Boolean).join('|');

  useEffect(() => {
    if (!candidateId && !extraKey) {
      setCalls([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchPhoneCallsForCandidate(candidateId, extraKey ? extraKey.split('|') : [])
      .then((rows) => { if (!cancelled) setCalls(rows); })
      .catch((err) => {
        console.error('usePhoneCallHistory error:', err);
        if (!cancelled) setCalls([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [candidateId, extraKey]);

  const totalTalkSeconds = calls.reduce((sum, c) => sum + c.talkSeconds, 0);
  return { calls, loading, totalCalls: calls.length, totalTalkSeconds };
}
