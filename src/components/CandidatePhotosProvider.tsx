/**
 * CandidatePhotosProvider : donne à PersonAvatar (prop `candidateId`) les copies
 * privées des photos des candidats (design simplifié, lot P, src/lib/candidatePhotos.ts).
 *
 * - Lecture de candidate_photos (copies « stored ») sous la RLS de l'appelant :
 *   seulement les copies des organisations dont il est membre.
 * - Adresses signées du bucket privé candidate-photos, valables une heure.
 * - Une réserve par personne connectée : un changement de compte repart de zéro,
 *   aucune adresse signée pour l'un n'est montrée à l'autre. Sans session, rien.
 */

import * as React from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from '@/hooks/useAuthReady';
import {
  CandidatePhotoContext,
  PHOTO_BUCKET,
  PHOTO_URL_TTL_S,
  createCandidatePhotoStore,
  type SignedPhoto,
} from '@/lib/candidatePhotos';

async function loadCandidatePhotos(candidateIds: string[]): Promise<Map<string, SignedPhoto>> {
  const { data, error } = await supabase
    .from('candidate_photos')
    .select('candidate_id, storage_path')
    .in('candidate_id', candidateIds)
    .eq('status', 'stored');
  if (error) throw new Error(error.message);

  // Membre de plusieurs organisations : une copie suffit.
  const pathOf = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.storage_path && !pathOf.has(row.candidate_id)) pathOf.set(row.candidate_id, row.storage_path);
  }
  const photos = new Map<string, SignedPhoto>();
  if (pathOf.size === 0) return photos;

  const { data: signed, error: signError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls([...new Set(pathOf.values())], PHOTO_URL_TTL_S);
  if (signError) throw new Error(signError.message);

  const expiresAt = Date.now() + PHOTO_URL_TTL_S * 1000;
  const urlOf = new Map<string, string>();
  for (const item of signed ?? []) {
    if (item.path && item.signedUrl && !item.error) urlOf.set(item.path, item.signedUrl);
  }
  for (const [candidateId, path] of pathOf) {
    const url = urlOf.get(path);
    if (url) photos.set(candidateId, { url, expiresAt });
  }
  return photos;
}

export function CandidatePhotosProvider({ children }: { children: React.ReactNode }) {
  const userId = useAuthReady().user?.id ?? null;
  const store = React.useMemo(() => (userId ? createCandidatePhotoStore(loadCandidatePhotos) : null), [userId]);
  return <CandidatePhotoContext.Provider value={store}>{children}</CandidatePhotoContext.Provider>;
}
