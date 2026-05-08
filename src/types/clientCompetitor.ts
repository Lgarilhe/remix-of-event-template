/**
 * Liste de concurrents par client (org-scoped). Utilisée pour :
 * - Bonus scoring (un profil ayant bossé chez un concurrent = signal positif)
 * - Mode chirurgical Unipile : recherche restreinte aux profils issus des concurrents
 */
export interface ClientCompetitor {
  id: string;
  organization_id: string;
  client_company_name: string;
  client_company_name_normalized: string;
  competitor_name: string;
  relation_kind: 'direct' | 'adjacent' | 'inspirational';
  reason?: string | null;
  country?: string | null;
  domain?: string | null;
  linkedin_company_id?: string | null;
  enabled: boolean;
  source: 'manual' | 'ai_suggested';
  created_at: string;
  updated_at: string;
}

/** Suggestion AI brute (avant persistance). */
export interface CompetitorSuggestion {
  name: string;
  reason: string;
  country?: string;
  domain?: string;
  relation_kind: 'direct' | 'adjacent' | 'inspirational';
}

export const RELATION_KIND_LABELS: Record<ClientCompetitor['relation_kind'], string> = {
  direct: 'Direct',
  adjacent: 'Adjacent',
  inspirational: 'Inspirational',
};
