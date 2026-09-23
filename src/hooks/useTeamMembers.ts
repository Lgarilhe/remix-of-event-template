/**
 * useTeamMembers — liste enrichie des membres de l'organisation courante.
 *
 * Joint `organization_members` + `profiles` (display_name) et
 * get_org_member_emails (e-mail, membres internes seulement) pour chaque user.
 * Utilisé pour le sélecteur de manager dans CreateEventModal, pour les
 * @mentions, etc.
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

  // 2. Récupère les profiles (colonnes réelles seulement : pas d'e-mail ni
  // d'avatar dans profiles) et les e-mails, qui vivent dans auth.users et
  // passent par get_org_member_emails. Collaborateur externe : aucun e-mail,
  // sans erreur. Un échec de l'une des deux lectures laisse l'autre s'afficher.
  const [{ data: profiles, error: profilesErr }, { data: emails, error: emailsErr }] = await Promise.all([
    supabase.from('profiles').select('user_id, display_name').in('user_id', userIds),
    supabase.rpc('get_org_member_emails', { p_organization_id: orgId }),
  ]);
  if (profilesErr) console.warn('[useTeamMembers] profiles error:', profilesErr);
  if (emailsErr) console.warn('[useTeamMembers] emails error:', emailsErr);

  const profileMap = new Map<string, any>(
    (profiles || []).map((p: any) => [p.user_id, p]),
  );
  const emailMap = new Map((emails ?? []).map(e => [e.user_id, e.email]));

  // 3. Merge
  return members.map((m: any) => {
    const p = profileMap.get(m.user_id);
    return {
      userId: m.user_id,
      displayName: p?.display_name ?? null,
      email: emailMap.get(m.user_id) ?? null,
      role: m.role,
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
