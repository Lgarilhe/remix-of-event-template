/**
 * useCandidateEnrichment — Hook pour démarrer + poller un enrichment de contact.
 *
 * Workflow :
 *   1. enrich({ linkedinUrl, firstName, lastName, company }) → POST enrich-candidate-contact
 *   2. Si cached : retour direct avec contact
 *   3. Si pending : démarre polling sur get-enrichment-status toutes les 5s
 *   4. Quand terminated : retour avec contact (email + phone + provider)
 *   5. Toast d'erreur si BC échoue
 *
 * Usage :
 *   const { enrich, status, contact, error, isLoading } = useCandidateEnrichment();
 *   await enrich({ linkedinUrl: '...', firstName: 'Fabien', lastName: 'Poussin' });
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';

export interface EnrichmentContact {
  email: string | null;
  email_status: string | null;
  phone: string | null;
  phone_type: string | null;
  email_provider_source: string | null;
  phone_provider_source: string | null;
}

export interface EnrichmentInput {
  linkedinUrl: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  companyDomain?: string;
  /** Demander l'email pro (default true). 1 crédit BC si trouvé. */
  withEmail?: boolean;
  /** Demander le téléphone mobile (default false — coûte 10 crédits BC). */
  withPhone?: boolean;
  /**
   * Hint contact_info Unipile (si déjà connu côté front, ex: depuis le LinkedInProfile).
   * Permet au backend de skip l'appel BC si l'email/phone est déjà dans Unipile.
   */
  contactInfoHint?: { emails?: string[] | null; phones?: string[] | null } | null;
}

type Status = 'idle' | 'pending' | 'terminated' | 'error';

interface StartResponse {
  success: boolean;
  cached?: boolean;
  request_id?: string;
  status?: string;
  contact?: EnrichmentContact | null;
  error?: string;
  message?: string;
}

interface PollResponse {
  success: boolean;
  status?: string;
  contact?: EnrichmentContact | null;
  credits_consumed?: number;
  error?: string;
}

const POLL_INTERVAL_MS = 5000;
const POLL_MAX_DURATION_MS = 5 * 60 * 1000; // 5 min max

export function useCandidateEnrichment() {
  const [status, setStatus] = useState<Status>('idle');
  const [contact, setContact] = useState<EnrichmentContact | null>(null);
  const [creditsConsumed, setCreditsConsumed] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartedAtRef = useRef<number>(0);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // Cleanup à l'unmount
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const reset = useCallback(() => {
    stopPolling();
    setStatus('idle');
    setContact(null);
    setError(null);
    setCreditsConsumed(0);
  }, [stopPolling]);

  /**
   * Démarre l'enrichment. Si cached → retour direct.
   * Sinon → démarre polling.
   */
  const enrich = useCallback(async (input: EnrichmentInput): Promise<EnrichmentContact | null> => {
    if (!input.linkedinUrl) {
      toast.error('URL LinkedIn manquante pour cet enrichment');
      return null;
    }

    reset();
    setStatus('pending');

    const { data, error: edgeError } = await invokeEdgeFunction<StartResponse>('enrich-candidate-contact', {
      linkedin_url: input.linkedinUrl,
      first_name: input.firstName,
      last_name: input.lastName,
      company: input.company,
      company_domain: input.companyDomain,
      with_email: input.withEmail !== false,         // default true
      with_phone: input.withPhone === true,          // default false (coût 10×)
      contact_info_hint: input.contactInfoHint || null,
    });

    if (edgeError) {
      const msg = edgeError.message || 'Erreur lors du démarrage de l\'enrichment';
      setError(msg);
      setStatus('error');
      toast.error(msg);
      return null;
    }

    if (!data?.success) {
      const msg = data?.error || 'Erreur lors du démarrage de l\'enrichment';
      setError(msg);
      setStatus('error');
      toast.error(msg);
      return null;
    }

    // Cached → retour direct
    if (data.cached && data.contact) {
      setContact(data.contact);
      setStatus('terminated');
      toast.success('Contact récupéré (déjà enrichi)');
      return data.contact;
    }

    // Pending → démarrer polling
    const requestId = data.request_id;
    if (!requestId) {
      setError('Pas de request_id retourné');
      setStatus('error');
      return null;
    }

    pollStartedAtRef.current = Date.now();

    return new Promise((resolve) => {
      pollIntervalRef.current = setInterval(async () => {
        // Timeout 5 min
        if (Date.now() - pollStartedAtRef.current > POLL_MAX_DURATION_MS) {
          stopPolling();
          setError('Délai d\'enrichment dépassé (5 min)');
          setStatus('error');
          toast.error('Délai d\'enrichment dépassé');
          resolve(null);
          return;
        }

        const { data: pollData, error: pollError } = await invokeEdgeFunction<PollResponse>('get-enrichment-status', {
          request_id: requestId,
        });

        if (pollError || !pollData?.success) {
          // Erreur transitoire : on continue de poller (peut-être 429 momentané)
          // Si vraie erreur (status='error') on stop
          if (pollData?.status === 'error') {
            stopPolling();
            const msg = pollData.error || 'Erreur lors de la vérification';
            setError(msg);
            setStatus('error');
            toast.error(msg);
            resolve(null);
          }
          return;
        }

        if (pollData.status === 'terminated' && pollData.contact) {
          stopPolling();
          setContact(pollData.contact);
          setCreditsConsumed(pollData.credits_consumed || 0);
          setStatus('terminated');

          if (pollData.contact.email || pollData.contact.phone) {
            const parts = [];
            if (pollData.contact.email) parts.push('email');
            if (pollData.contact.phone) parts.push('téléphone');
            toast.success(`${parts.join(' + ')} récupéré${parts.length > 1 ? 's' : ''}`);
          } else {
            toast.info('Aucun contact trouvé pour ce profil');
          }

          resolve(pollData.contact);
        }
        // sinon : pending → on continue
      }, POLL_INTERVAL_MS);
    });
  }, [reset, stopPolling]);

  return {
    enrich,
    status,
    contact,
    error,
    creditsConsumed,
    isLoading: status === 'pending',
    isTerminated: status === 'terminated',
    reset,
  };
}
