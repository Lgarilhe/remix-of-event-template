// Réglages de rédaction d'une personne dans une organisation (lot 5e-2) :
// niveaux de l'organisation (organizations.agency_permissions.ai_writing) et
// style de la personne (profiles.ai_context.writing_style). Lecture seule,
// sans règle : la normalisation est dans writing-style.ts.
//
// Une lecture en échec rend { ok: false } : l'appelant refuse la rédaction
// plutôt que de supposer un niveau (un plafond illisible ne s'ouvre pas).

import { normalizeOrgLevels, normalizeWritingStyle, type OrgLevels, type WritingStyle } from './writing-style.ts';

// Les appelants mélangent des clients `esm.sh` et `npm:` aux types internes
// incompatibles : le client est reçu sans type, puis lu par la seule forme
// utilisée ici.
interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}
interface SupabaseLikeClient {
  from(table: string): {
    select(columns: string): { eq(column: string, value: string): { maybeSingle(): PromiseLike<QueryResult> } };
  };
}

export type WritingSettings =
  | ({ ok: true; style: WritingStyle } & OrgLevels)
  | { ok: false };

export async function loadWritingSettings(
  adminClient: unknown,
  params: { organizationId: string; userId: string },
): Promise<WritingSettings> {
  const admin = adminClient as SupabaseLikeClient;
  try {
    const [orgRes, profileRes] = await Promise.all([
      admin.from('organizations').select('agency_permissions').eq('id', params.organizationId).maybeSingle(),
      admin.from('profiles').select('ai_context').eq('user_id', params.userId).maybeSingle(),
    ]);
    if (orgRes.error || profileRes.error) {
      console.error('[writing-settings] lecture des réglages:', orgRes.error?.message ?? profileRes.error?.message);
      return { ok: false };
    }
    const levels = normalizeOrgLevels((orgRes.data as { agency_permissions?: unknown } | null)?.agency_permissions);
    const aiContext = (profileRes.data as { ai_context?: unknown } | null)?.ai_context;
    const context = aiContext && typeof aiContext === 'object' ? aiContext as Record<string, unknown> : {};
    return { ok: true, ...levels, style: normalizeWritingStyle(context.writing_style, context.tone) };
  } catch (err) {
    console.error('[writing-settings] lecture des réglages:', err);
    return { ok: false };
  }
}
