import { useQuery } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization, useOrganizationMembers } from '@/hooks/useOrganization';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TeamManagement } from '@/components/settings/TeamManagement';
import { PendingInvitations } from '@/components/settings/PendingInvitations';
import { InviteMemberForm } from '@/components/settings/InviteMemberForm';
import { hasFeature } from '@/lib/featureGates';

/**
 * Mon organisation › Équipe : membres, puis invitations.
 * Code déplacé depuis l'ancien onglet « Équipe » de Settings.tsx, conditions comprises.
 * La coquille (sectionAccess) filtre déjà l'accès ; ces conditions restent en défense
 * en profondeur. Le canal temps réel des invitations et les requêtes des membres ne
 * tournent plus que sur cette rubrique.
 */
export function TeamSection() {
  const { organizationId, isOwner, isAdmin, isCollaborator, orgType } = useOrganization();
  // Droits par type d'organisation (src/lib/featureGates.ts) : un freelance
  // n'a pas d'équipe à gérer.
  const canManageTeam = !isCollaborator && hasFeature(orgType, 'team_management');
  const { members, isLoading, pendingInvitations, inviteMember, isInviting, resendInvitation, isResendingInvitation, cancelInvitation, updateRole, removeMember } = useOrganizationMembers(organizationId);

  const { data: memberProfiles = [] } = useQuery({
    queryKey: ['member-profiles', members.map(m => m.user_id)],
    queryFn: async () => {
      if (!members.length) return [];
      const userIds = members.map(m => m.user_id);
      const { data } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', userIds);
      return data || [];
    },
    enabled: members.length > 0,
  });

  // L'e-mail des membres vit dans auth.users (profiles n'a pas de colonne email) :
  // lu par get_org_member_emails, réservée aux membres internes de l'organisation.
  // Échec (fonction pas encore déployée, réseau) : repli sur le nom seul.
  const { data: memberEmails = [] } = useQuery({
    queryKey: ['org-member-emails', organizationId, members.map(m => m.user_id)],
    queryFn: async (): Promise<Array<{ user_id: string; email: string }>> => {
      const { data, error } = await supabase.rpc('get_org_member_emails', { p_organization_id: organizationId! });
      if (error) { console.warn('[Settings] member emails:', error); return []; }
      return data ?? [];
    },
    enabled: !!organizationId && canManageTeam && members.length > 0,
    staleTime: 5 * 60 * 1000,
  });
  const getMemberEmail = (userId: string) =>
    memberEmails.find(e => e.user_id === userId)?.email || null;

  // Plus de repli sur 8 caractères d'identifiant : nom, sinon e-mail.
  const getDisplayName = (userId: string) => {
    const profile = memberProfiles.find(p => p.user_id === userId);
    return profile?.display_name?.trim() || getMemberEmail(userId) || 'Membre sans nom';
  };

  return (
    <>
      <TeamManagement
        members={members}
        getDisplayName={getDisplayName}
        getEmail={getMemberEmail}
        isAdmin={isAdmin}
        isOwner={isOwner}
        isLoading={isLoading}
        onUpdateRole={updateRole}
        onRemove={removeMember}
      />

      {isAdmin && !isCollaborator && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
              <UserPlus className="w-4 h-4" />
              Invitations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PendingInvitations
              invitations={pendingInvitations}
              onCancel={cancelInvitation}
              onResend={async (email, role) => { await resendInvitation({ email, role }); }}
              canManage={isAdmin}
              isResending={isResendingInvitation}
            />
            <InviteMemberForm
              onInvite={async (email, role) => { await inviteMember({ email, role }); }}
              isLoading={isInviting}
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}
