/**
 * useTeamMembers — liste enrichie des membres de l'organisation courante.
 *
 * Joint `organization_members` + `profiles` pour avoir display_name + email
 * pour chaque user. Utilisé pour le sélecteur de manager dans CreateEventModal,
 * pour les @mentions, etc.
 *
 * Inclut le user courant (Laurent voit son propre nom dans la liste).
 *
 * Cache React Query 5min (stable, change rarement).
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';

export interface TeamMember {
  userId: string;
  displayName: string | null;
  email: string | null;
  role: 'owner' | 'admin' | 'member' | 'collaborator' | string;
  /** Avatar custom upload — null si non fourni */
  avatarUrl: string | null;
}

const ROLE_ORDER: Record<string, number> = {
  owner: 0,
  admin: 1,
  member: 2,
  collaborator: 3,
};

const fetchTeamMembers = async (orgId: string): Promise<TeamMember[]> => {
  // 1. Récupère les memberships
  const { data: members, error: membersErr } = await supabase
    .from('organization_members')
    .select('user_id, role, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true });

  if (membersErr || !members || members.length === 0) {
    if (membersErr) console.warn('[useTeamMembers] members error:', membersErr);
    return [];
  }

  const userIds = members.map((m: any) => m.user_id);

  // 2. Récupère les profiles correspondants
  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, display_name, email, avatar_url')
    .in('user_id', userIds);

  const profileMap = new Map<string, any>(
    (profiles || []).map((p: any) => [p.user_id, p]),
  );

  // 3. Merge
  return members.map((m: any) => {
    const p = profileMap.get(m.user_id);
    return {
      userId: m.user_id,
      displayName: p?.display_name ?? null,
      email: p?.email ?? null,
      role: m.role,
      avatarUrl: p?.avatar_url ?? null,
    };
  }).sort((a, b) => {
    // Tri : owners > admins > members > collaborators, puis par display_name
    const roleA = ROLE_ORDER[a.role] ?? 99;
    const roleB = ROLE_ORDER[b.role] ?? 99;
    if (roleA !== roleB) return roleA - roleB;
    return (a.displayName || '').localeCompare(b.displayName || '');
  });
};

export function useTeamMembers() {
  const { organizationId } = useOrganization();

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['team-members', organizationId],
    queryFn: () => fetchTeamMembers(organizationId!),
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000, // 5min
  });

  return { members, isLoading };
}
