/**
 * useCurrentProfile — fetch profile data for the current user.
 *
 * Nom affiché de l'utilisateur courant (barre latérale, salutation du tableau
 * de bord). profiles.display_name est posé à l'inscription par handle_new_user,
 * qui y met le préfixe d'e-mail faute de nom fourni.
 *
 * Cascade de fallback dans `displayName` :
 * 1. profile.display_name (Supabase profiles table) — passé au prettifier.
 *    handle_new_user y stocke l'email prefix brut ("l.garilhe") quand
 *    l'inscription ne fournit pas de nom : ce préfixe ne passe pas devant les
 *    métadonnées (il est ignoré ici et retrouvé à l'étape 4).
 * 2. user.user_metadata.full_name (auth metadata)
 * 3. user.user_metadata.first_name + last_name
 * 4. email parsé "intelligemment" : "l.garilhe@konekt.fr" → "L. Garilhe"
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from '@/hooks/useAuthReady';

// Colonnes réelles de profiles seulement : l'e-mail vient de la session auth,
// et aucun avatar n'est stocké.
export interface CurrentProfile {
  user_id: string;
  display_name: string | null;
}

/**
 * Prettifie un "nom" qui peut être soit un vrai nom ("Laurent Garilhe"),
 * soit un handle/email-prefix mal capitalisé ("l.garilhe", "laurent_g").
 *
 * - Si la chaîne contient déjà un espace OU au moins une lettre uppercase :
 *   c'est probablement un vrai nom → on garde tel quel.
 * - Sinon : on split sur `.`, `_`, `-` et on capitalise chaque token.
 *   Cas "p.nom" (initiale + nom) : on garde l'initiale comme "P." séparée.
 */
const prettifyName = (raw: string | null): string | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Vrai nom déjà bien formé : contient espace OU au moins une majuscule
  const hasSpace = /\s/.test(trimmed);
  const hasUpper = /[A-ZÀ-Ý]/.test(trimmed);
  if (hasSpace || hasUpper) {
    return trimmed;
  }

  // Sinon = handle ugly type "l.garilhe" → on prettifie
  const tokens = trimmed.split(/[._-]+/).filter(Boolean);
  if (tokens.length === 0) return trimmed;

  return tokens
    .map((t, i) => {
      if (i === 0 && t.length === 1) return t.toUpperCase() + '.';
      return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
    })
    .join(' ');
};

const parseEmailToName = (email: string | null): string | null => {
  if (!email) return null;
  const localPart = email.split('@')[0];
  return prettifyName(localPart || null);
};

export function useCurrentProfile() {
  const { isReady, user } = useAuthReady();

  const { data: profile, isLoading } = useQuery<CurrentProfile | null>({
    queryKey: ['current-profile', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) {
        console.warn('[useCurrentProfile] fetch error:', error);
        return null;
      }
      return data;
    },
    enabled: isReady && !!user,
    staleTime: 5 * 60 * 1000, // 5min
  });

  // Cascade de fallback pour displayName + firstName.
  // On fait passer chaque source au prettifier — handle_new_user stocke
  // l'email-prefix brut ("l.garilhe") dans profile.display_name, et ce préfixe
  // ne passe pas devant les métadonnées.
  const fallbackFromMetadata =
    user?.user_metadata?.full_name ||
    [user?.user_metadata?.first_name, user?.user_metadata?.last_name].filter(Boolean).join(' ').trim() ||
    null;

  const emailLocalPart = user?.email?.split('@')[0]?.toLowerCase() || null;
  const storedName = profile?.display_name?.trim() || null;
  // handle_new_user remplit display_name avec le préfixe d'e-mail quand
  // l'inscription ne fournit pas de nom (toujours le cas aujourd'hui) : ce
  // préfixe ne doit pas masquer le nom complet des métadonnées (connexion Google).
  const storedNameIsEmailPrefix = !!storedName && storedName.toLowerCase() === emailLocalPart;

  const displayName =
    (storedNameIsEmailPrefix ? null : prettifyName(storedName)) ||
    prettifyName(fallbackFromMetadata) ||
    parseEmailToName(user?.email || null) ||
    null;

  const firstName = displayName?.split(' ')[0]?.replace(/\.$/, '') || null;

  return {
    profile,
    displayName,
    firstName,
    // E-mail de la session auth (profiles n'a pas de colonne email).
    email: user?.email ?? null,
    isLoading: !isReady || isLoading,
  };
}
