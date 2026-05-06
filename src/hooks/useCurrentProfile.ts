/**
 * useCurrentProfile — fetch profile data for the current user.
 *
 * Source de vérité pour le `display_name` (rempli pendant l'onboarding).
 * Utilisé pour les greetings, les avatars, les @mentions, etc.
 *
 * Cascade de fallback dans `displayName` :
 * 1. profile.display_name (Supabase profiles table) — passé au prettifier
 *    car certains onboardings legacy y ont stocké l'email prefix brut
 *    ("l.garilhe") au lieu d'un vrai nom.
 * 2. user.user_metadata.full_name (auth metadata)
 * 3. user.user_metadata.first_name + last_name
 * 4. email parsé "intelligemment" : "l.garilhe@konekt.fr" → "L. Garilhe"
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from '@/hooks/useAuthReady';

export interface CurrentProfile {
  user_id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
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
        .select('user_id, display_name, email, avatar_url')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) {
        console.warn('[useCurrentProfile] fetch error:', error);
        return null;
      }
      return data as CurrentProfile | null;
    },
    enabled: isReady && !!user,
    staleTime: 5 * 60 * 1000, // 5min
  });

  // Cascade de fallback pour displayName + firstName.
  // On fait passer chaque source au prettifier — un onboarding legacy a pu
  // stocker l'email-prefix brut ("l.garilhe") dans profile.display_name.
  const fallbackFromMetadata =
    user?.user_metadata?.full_name ||
    [user?.user_metadata?.first_name, user?.user_metadata?.last_name].filter(Boolean).join(' ').trim() ||
    null;

  const displayName =
    prettifyName(profile?.display_name ?? null) ||
    prettifyName(fallbackFromMetadata) ||
    parseEmailToName(user?.email || null) ||
    null;

  const firstName = displayName?.split(' ')[0]?.replace(/\.$/, '') || null;

  return {
    profile,
    displayName,
    firstName,
    avatarUrl: profile?.avatar_url || null,
    isLoading: !isReady || isLoading,
  };
}
