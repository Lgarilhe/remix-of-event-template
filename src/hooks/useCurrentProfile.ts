/**
 * useCurrentProfile — fetch profile data for the current user.
 *
 * Source de vérité pour le `display_name` (rempli pendant l'onboarding).
 * Utilisé pour les greetings, les avatars, les @mentions, etc.
 *
 * Cascade de fallback dans `displayName` :
 * 1. profile.display_name (Supabase profiles table)
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

const parseEmailToName = (email: string | null): string | null => {
  if (!email) return null;
  const localPart = email.split('@')[0];
  if (!localPart) return null;
  // Split on `.`, `_`, `-` and capitalize each token. Garde l'initiale si
  // le 1er token est court (c'est typiquement "p.nom" → "P. Nom").
  const tokens = localPart.split(/[._-]/).filter(Boolean);
  if (tokens.length === 0) return null;
  return tokens
    .map((t, i) => {
      if (i === 0 && t.length === 1) return t.toUpperCase() + '.';
      return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
    })
    .join(' ');
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

  // Cascade de fallback pour displayName + firstName
  const fallbackFromMetadata =
    user?.user_metadata?.full_name ||
    [user?.user_metadata?.first_name, user?.user_metadata?.last_name].filter(Boolean).join(' ').trim() ||
    null;

  const displayName =
    profile?.display_name ||
    fallbackFromMetadata ||
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
