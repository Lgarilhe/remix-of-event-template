import { useCallback, useRef, useState } from 'react';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';

/**
 * Hook managing a session-level cache for attendee profile pictures.
 * Fetches pictures lazily from the get_attendee_picture edge function action.
 */
export function useAttendeePictures(organizationId: string | null) {
  // Cache: attendeeId -> url string | null (null = not found / error)
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
    async (attendeeId: string): Promise<string | null> => {
      // Already cached
      if (cacheRef.current.has(attendeeId)) {
        return cacheRef.current.get(attendeeId) ?? null;
      }
      // Already fetching
      if (pendingRef.current.has(attendeeId)) return null;
      if (!organizationId) return null;

      pendingRef.current.add(attendeeId);

      try {
        const { data } = await invokeEdgeFunction<{
          data_url?: string;
          picture_url?: string;
        }>('unipile-accounts', {
          action: 'get_attendee_picture',
          attendee_id: attendeeId,
          organization_id: organizationId,
        });

        const url = data?.data_url || data?.picture_url || null;
        cacheRef.current.set(attendeeId, url);
        bump();
        return url;
      } catch {
        cacheRef.current.set(attendeeId, null);
        bump();
        return null;
      } finally {
        pendingRef.current.delete(attendeeId);
      }
    },
    [organizationId]
  );

  const preloadPictures = useCallback(
    (attendeeIds: string[]) => {
      const toFetch = attendeeIds.filter(
        (id) => !cacheRef.current.has(id) && !pendingRef.current.has(id)
      );
      if (toFetch.length === 0) return;

      // Fetch in batches of 3 to avoid overwhelming the API
      let idx = 0;
      const next = () => {
        const batch = toFetch.slice(idx, idx + 3);
        if (batch.length === 0) return;
        idx += 3;
        Promise.all(batch.map((id) => fetchPicture(id))).then(next).catch(() => {});
      };
      next();
    },
    [fetchPicture]
  );

  return { getPicture, fetchPicture, preloadPictures };
}
