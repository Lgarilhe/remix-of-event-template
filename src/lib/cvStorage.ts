/**
 * cvStorage — helpers Supabase Storage + DB pour la gestion des CV PDF.
 *
 * Single source of vérité pour upload/list/delete/setPrimary. Le bucket
 * `candidate-cvs` est privé : tous les accès passent par des signed URLs
 * (TTL 5 min) générées côté client, jamais d'URL publique stockée.
 *
 * Path Storage : "{org_id}/{candidate_id}/{cv_uuid}.pdf"
 *   → permet l'isolation multi-tenant via RLS sur storage.objects
 *     (cf migration 20260506140000_candidate_cvs.sql).
 */

import { supabase } from '@/integrations/supabase/client';

export interface CandidateCV {
  id: string;
  candidateId: string;
  organizationId: string;
  storagePath: string;
  fileName: string;
  fileSizeBytes: number | null;
  contentType: string;
  isPrimary: boolean;
  notes: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
}

export interface CVUploadOptions {
  candidateId: string;
  organizationId: string;
  file: File;
  /** Si true, ce CV devient le primaire (défaut : true si c'est le 1er). */
  makePrimary?: boolean;
  /** Annotation libre (ex: "v2 reçue par mail le 12/04"). */
  notes?: string | null;
}

export const CV_BUCKET = 'candidate-cvs';
export const CV_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const CV_ALLOWED_TYPES = ['application/pdf'];

/**
 * Liste les CVs d'un candidat dans une organisation, triés par date
 * d'upload décroissante (le primaire en premier si flagué).
 */
export async function listCVs(
  candidateId: string,
  organizationId: string,
): Promise<CandidateCV[]> {
  const { data, error } = await supabase
    .from('candidate_cvs')
    .select('*')
    .eq('candidate_id', candidateId)
    .eq('organization_id', organizationId)
    .order('is_primary', { ascending: false })
    .order('uploaded_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(rowToCV);
}

/**
 * Upload un CV PDF.
 *
 * Flow :
 *  1. Validation côté client (taille + MIME)
 *  2. Upload du blob dans le bucket
 *  3. Insert d'une ligne candidate_cvs avec le path
 *  4. Si makePrimary=true → trigger DB met à false les autres primaires
 *
 * Retourne le CV créé. Throw avec message explicite en cas d'erreur.
 */
export async function uploadCV({
  candidateId,
  organizationId,
  file,
  makePrimary,
  notes,
}: CVUploadOptions): Promise<CandidateCV> {
  // Validation
  if (!CV_ALLOWED_TYPES.includes(file.type)) {
    throw new Error(`Type de fichier non supporté : ${file.type}. PDF uniquement.`);
  }
  if (file.size > CV_MAX_SIZE_BYTES) {
    throw new Error(
      `Fichier trop volumineux : ${(file.size / 1024 / 1024).toFixed(1)} MB. Max ${CV_MAX_SIZE_BYTES / 1024 / 1024} MB.`,
    );
  }

  // Auto makePrimary si c'est le 1er CV
  let shouldBePrimary = makePrimary;
  if (shouldBePrimary === undefined) {
    const existing = await listCVs(candidateId, organizationId);
    shouldBePrimary = existing.length === 0;
  }

  // Get current user for uploaded_by
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Non authentifié');

  // Generate unique path
  const cvId = crypto.randomUUID();
  const storagePath = `${organizationId}/${candidateId}/${cvId}.pdf`;

  // Upload to bucket
  const { error: uploadErr } = await supabase.storage
    .from(CV_BUCKET)
    .upload(storagePath, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: 'application/pdf',
    });
  if (uploadErr) {
    throw new Error(`Upload échoué : ${uploadErr.message}`);
  }

  // Insert DB row
  const { data, error: insertErr } = await supabase
    .from('candidate_cvs')
    .insert({
      id: cvId,
      candidate_id: candidateId,
      organization_id: organizationId,
      storage_path: storagePath,
      file_name: file.name,
      file_size_bytes: file.size,
      content_type: 'application/pdf',
      is_primary: shouldBePrimary,
      notes: notes || null,
      uploaded_by: user.id,
    })
    .select()
    .single();

  if (insertErr) {
    // Rollback : delete uploaded file pour pas avoir d'orphan en storage
    await supabase.storage.from(CV_BUCKET).remove([storagePath]).catch(() => {});
    throw new Error(`Erreur DB : ${insertErr.message}`);
  }

  return rowToCV(data);
}

/**
 * Génère une signed URL pour previewer/télécharger un CV.
 * TTL 5 min — assez pour ouvrir l'iframe et streamer le PDF.
 */
export async function getCVSignedUrl(
  storagePath: string,
  ttlSeconds = 300,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(CV_BUCKET)
    .createSignedUrl(storagePath, ttlSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(`URL signée non générée : ${error?.message || 'unknown'}`);
  }
  return data.signedUrl;
}

/**
 * Supprime un CV : storage + DB row.
 * Note : pas de soft-delete pour l'instant. Si on veut en ajouter plus
 * tard, ajouter une colonne `deleted_at`.
 */
export async function deleteCV(cv: CandidateCV): Promise<void> {
  // 1. Delete storage object (best-effort — on continue même si ça fail
  //    pour pouvoir nettoyer les rows DB orphelins après bug)
  await supabase.storage.from(CV_BUCKET).remove([cv.storagePath]).catch(err => {
    console.warn('[cvStorage.deleteCV] storage remove failed:', err);
  });

  // 2. Delete DB row (source de vérité — si ça fail c'est qu'on a un
  //    problème de droits, on doit faire remonter l'erreur à l'user)
  const { error } = await supabase
    .from('candidate_cvs')
    .delete()
    .eq('id', cv.id);
  if (error) throw error;
}

/**
 * Définit ce CV comme primaire (le trigger DB désactive automatiquement
 * les autres primaires pour le même candidat dans la même org).
 */
export async function setPrimaryCV(cvId: string): Promise<void> {
  const { error } = await supabase
    .from('candidate_cvs')
    .update({ is_primary: true })
    .eq('id', cvId);
  if (error) throw error;
}

/**
 * Met à jour les notes d'un CV.
 */
export async function updateCVNotes(cvId: string, notes: string | null): Promise<void> {
  const { error } = await supabase
    .from('candidate_cvs')
    .update({ notes: notes && notes.trim() ? notes.trim() : null })
    .eq('id', cvId);
  if (error) throw error;
}

/** Helper : format taille en human-readable (2.4 MB, 480 KB...) */
export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ─── Internal ─────────────────────────────────────────────────────

function rowToCV(row: any): CandidateCV {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    organizationId: row.organization_id,
    storagePath: row.storage_path,
    fileName: row.file_name,
    fileSizeBytes: row.file_size_bytes,
    contentType: row.content_type,
    isPrimary: row.is_primary,
    notes: row.notes,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at,
  };
}
