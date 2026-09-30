import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import type { WritingTone } from './outreach';

/**
 * Ce que l'onboarding écrit sur le profil de l'utilisateur : son prénom (qui
 * signe les messages rédigés par l'IA) et son ton d'écriture (`ai_context.tone`,
 * lu par la rédaction de messages, les séquences et les suggestions de réponse).
 */

/** Prénom sur le profil et sur le compte : `useSenderFirstName` lit l'un puis l'autre. */
export async function saveFirstName(userId: string, firstName: string): Promise<void> {
  const name = firstName.trim();
  if (!name) return;
  const { error } = await supabase.from('profiles').upsert({ user_id: userId, display_name: name }, { onConflict: 'user_id' });
  if (error) throw error;
  // Non bloquant : le profil suffit quand les métadonnées du compte refusent la mise à jour.
  const { error: metaError } = await supabase.auth.updateUser({ data: { first_name: name } });
  if (metaError) console.warn('[onboarding] prénom non écrit sur le compte :', metaError.message);
}

/** Ton d'écriture, fusionné avec le contexte IA existant (jamais écrasé : il peut porter la spécialité et les consignes). */
export async function saveWritingTone(userId: string, tone: WritingTone): Promise<void> {
  const { data, error } = await supabase.from('profiles').select('ai_context').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  const current = data?.ai_context && typeof data.ai_context === 'object' && !Array.isArray(data.ai_context) ? (data.ai_context as Record<string, Json>) : {};
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ ai_context: { ...current, tone } as Json })
    .eq('user_id', userId);
  if (updateError) throw updateError;
}
