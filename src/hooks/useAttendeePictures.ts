import { useCallback, useRef, useState } from 'react';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';

/**
 * Où lire la photo d'un interlocuteur : la conversation (et son compte) d'abord,
 * sinon la personne elle-même (`attendeeId` est son identifiant LinkedIn).
 */
export interface AttendeePictureSource {
  chatId?: string | null;
  accountId?: string | null;
}

export interface AttendeePictureRequest extends AttendeePictureSource {
  attendeeId: string;
}

/**
 * Hook managing a session-level cache for attendee profile pictures.
 * Fetches pictures lazily from the get_attendee_picture edge function action,
 * which answers an address (picture_url), never the image itself.
 */
export function useAttendeePictures(organizationId: string | null) {
  // Cache: attendeeId -> url string | null (null = photo non disponible, réponse du serveur)
  const cacheRef = useRef<Map<string, string | null>>(new Map());
  // Pending fetches to avoid duplicate requests
  const pendingRef = useRef<Set<string>>(new Set());
  // Bump state to trigger re-renders when cache updates
  const [, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);

  const getPicture = useCallback(
    (attendeeId: string): string | null => {
      return cacheRef.current.get(attendeeId) ?? null;
    },
    []
  );

  const fetchPicture = useCallback(
    async (attendeeId: string, source: AttendeePictureSource = {}): Promise<string | null> => {
      // Already cached
      if (cacheRef.current.has(attendeeId)) {
        return cacheRef.current.get(attendeeId) ?? null;
      }
      // Already fetching
      if (pendingRef.current.has(attendeeId)) return null;
      if (!organizationId) return null;

      pendingRef.current.add(attendeeId);

      try {
        const { data, error } = await invokeEdgeFunction<{
          picture_url?: string;
        }>('unipile-accounts', {
          action: 'get_attendee_picture',
          user_id: attendeeId,
          ...(source.chatId ? { chat_id: source.chatId } : {}),
          ...(source.accountId ? { account_id: source.accountId } : {}),
          organization_id: organizationId,
        });

        // Panne passagère (réseau, délai, 429, 5xx) : rien n'est mémorisé, la photo sera redemandée.
        // Seule une réponse du serveur (photo trouvée, ou « Photo non disponible ») est gardée.
        if (error && (error.status === undefined || error.status === 429 || error.status >= 500)) return null;
        const url = data?.success ? data.picture_url || null : null;
        cacheRef.current.set(attendeeId, url);
        bump();
        return url;
      } catch {
        return null;
      } finally {
        pendingRef.current.delete(attendeeId);
      }
    },
    [organizationId]
  );

  const preloadPictures = useCallback(
    (requests: AttendeePictureRequest[]) => {
      const toFetch = requests.filter(
        (r) => !cacheRef.current.has(r.attendeeId) && !pendingRef.current.has(r.attendeeId)
      );
      if (toFetch.length === 0) return;

      // Fetch in batches of 3 to avoid overwhelming the API
      let idx = 0;
      const next = () => {
        const batch = toFetch.slice(idx, idx + 3);
        if (batch.length === 0) return;
        idx += 3;
        Promise.all(batch.map((r) => fetchPicture(r.attendeeId, r))).then(next);
      };
      next();
    },
    [fetchPicture]
  );

  return { getPicture, fetchPicture, preloadPictures };
}
