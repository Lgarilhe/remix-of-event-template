/**
 * useCandidateEnrichment — Hook pour démarrer + poller un enrichissement de contact.
 *
 * Workflow :
 *   1. enrich({ linkedinUrl, firstName, lastName, company }) → POST enrich-candidate-contact
 *   2. Si cached : retour direct avec contact
 *   3. Si pending : démarre polling sur get-enrichment-status toutes les 5s
 *   4. Quand terminated : retour avec contact (email + phone + provider)
 *   5. Toast d'erreur si le service échoue ; le polling s'arrête dès qu'une
 *      réponse non-2xx (403, 404, 500) est reçue, sans attendre le délai max.
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
  /** Demander l'email pro (default true). 1 crédit hors forfait si trouvé. */
  withEmail?: boolean;
  /** Demander le téléphone mobile (default false — 10 crédits hors forfait si trouvé). */
  withPhone?: boolean;
  /**
   * Hint contact_info Unipile (si déjà connu côté front, ex: depuis le LinkedInProfile).
   * Permet au backend de skip l'appel payant si l'email/phone est déjà dans Unipile.
   */
  contactInfoHint?: { emails?: string[] | null; phones?: string[] | null } | null;
  /**
   * Identifiant pipeline (job_candidate_status.candidate_id) quand le profil
   * vient du pipeline : le résultat est alors gardé sur la fiche candidat.
   */
  candidateId?: string;
}

type Status = 'idle' | 'pending' | 'terminated' | 'error';

interface StartResponse {
  success: boolean;
  cached?: boolean;
  request_id?: string | null;
  status?: string;
  contact?: EnrichmentContact | null;
  included?: boolean;
  included_remaining?: number;
  error?: string;
  error_code?: string;
  message?: string;
}

interface PollResponse {
  success: boolean;
  status?: string;
  contact?: EnrichmentContact | null;
  included?: boolean;
  credits_consumed?: number;
  error?: string;
  error_code?: string;
}

const POLL_INTERVAL_MS = 5000;
const POLL_MAX_DURATION_MS = 5 * 60 * 1000; // 5 min max

/** Message clair pour une réponse non-2xx du suivi (403, 404, 500...). */
function pollFailureMessage(httpStatus: number, errorCode: string | undefined, fallback: string): string {
  if (httpStatus === 404 || errorCode === 'ENRICHMENT_NOT_FOUND') {
    return "Demande d'enrichissement de contact introuvable. Relancez la recherche.";
  }
  if (httpStatus === 403) {
    return "Accès refusé à cette demande d'enrichissement de contact.";
  }
  if (httpStatus >= 500) {
    return "La vérification de l'enrichissement de contact a échoué. Réessayez dans quelques instants.";
  }
  return fallback || "La vérification de l'enrichissement de contact a échoué.";
}

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
   * Démarre l'enrichissement. Si cached → retour direct.
   * Sinon → démarre polling.
   */
  const enrich = useCallback(async (input: EnrichmentInput): Promise<EnrichmentContact | null> => {
    if (!input.linkedinUrl) {
      toast.error("URL LinkedIn manquante pour cet enrichissement de contact");
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
      ...(input.candidateId ? { candidate_id: input.candidateId } : {}),
    });

    if (edgeError || !data?.success) {
      const msg = data?.error || edgeError?.message || "Erreur lors du démarrage de l'enrichissement de contact";
      setError(msg);
      setStatus('error');
      const code = data?.error_code || edgeError?.code;
      toast.error(msg, {
        description: code === 'PLAN_REQUIRED'
          ? 'Choisissez un forfait dans Paramètres > Abonnement.'
          : undefined,
      });
      return null;
    }

    // Cached → retour direct (contact déjà connu, aucun crédit débité)
    if (data.cached) {
      const found = data.contact ?? null;
      setContact(found);
      setStatus('terminated');
      if (found?.email || found?.phone) {
        toast.success('Contact récupéré (déjà connu)');
      } else {
        toast.info('Aucun contact trouvé pour ce profil');
      }
      return found;
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
          setError("Délai de l'enrichissement de contact dépassé (5 min)");
          setStatus('error');
          toast.error("Délai de l'enrichissement de contact dépassé");
          resolve(null);
          return;
        }

        const { data: pollData, error: pollError } = await invokeEdgeFunction<PollResponse>('get-enrichment-status', {
          request_id: requestId,
          ...(input.candidateId ? { candidate_id: input.candidateId } : {}),
        });

        if (pollError) {
          // Réponse non-2xx (403, 404, 500...) : inutile d'attendre 5 min, on
          // arrête tout de suite. Une erreur réseau (pas de statut HTTP) ou un
          // 429 est transitoire : on réessaie au prochain tick.
          const httpStatus = pollError.status;
          if (httpStatus && httpStatus !== 429) {
            stopPolling();
            const msg = pollFailureMessage(httpStatus, pollData?.error_code || pollError.code, pollError.message);
            setError(msg);
            setStatus('error');
            toast.error(msg);
            resolve(null);
          }
          return;
        }

        if (!pollData?.success) {
          // 200 avec status='error' : le service a échoué sur cette demande
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

        if (pollData.status === 'terminated') {
          stopPolling();
          const found = pollData.contact ?? null;
          setContact(found);
          setCreditsConsumed(pollData.credits_consumed || 0);
          setStatus('terminated');

          if (found?.email || found?.phone) {
            const parts = [];
            if (found.email) parts.push('email');
            if (found.phone) parts.push('téléphone');
            toast.success(`Contact récupéré : ${parts.join(' + ')}`);
          } else {
            toast.info('Aucun contact trouvé pour ce profil');
          }

          resolve(found);
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
