// Refonte mission, écran Cadrage : Équipe (conception 5.6). La section suit
// les droits : type d'organisation (team_management) et formule (team). Sans
// droit, elle n'existe pas ; pendant le chargement, un bloc gris garde sa place.
// Réemploie MissionTeamSection (assignation, retrait confirmé, invitations
// existantes), sans son en-tête et avec les rôles en français.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { MissionTeamSection } from '@/components/missions/process/shared';
import { supabase } from '@/integrations/supabase/client';
import { useMissionProcess } from '@/hooks/useMissionProcess';
import { useMissionTeamProfiles } from '@/hooks/useMarketplace';
import { useOrganization, useOrganizationMembers } from '@/hooks/useOrganization';
import { useSubscriptionState } from '@/hooks/useSubscriptionState';
import type { SourcingProject } from '@/hooks/useSourcingProjects';
import { hasFeature, hasPlanFeature } from '@/lib/featureGates';
import { TEAM_ROLE_LABELS } from './cadrageModel';

/**
 * Membres de l'organisation de la mission et leur nom affiché (profiles.display_name),
 * même lecture que l'ancienne page (MissionProcessV2), clé comprise.
 */
export function useOrgMemberNames(organizationId: string | null) {
  const { members, isLoading } = useOrganizationMembers(organizationId);
  const ids = useMemo(() => members.map((m) => m.user_id), [members]);
  const { data: profiles = [] } = useQuery({
    queryKey: ['member-profiles-mission-v2', ids],
    queryFn: async () => {
      if (ids.length === 0) return [];
      const { data } = await supabase
        .from('profiles')
        .select('user_id, display_name, recruiter_headline')
        .in('user_id', ids);
      return data || [];
    },
    enabled: ids.length > 0,
    staleTime: 10 * 60 * 1000,
  });
  /** Nom enregistré du membre ; null tant qu'il n'est pas connu. */
  const knownNameOf = (userId: string): string | null => {
    const profile = (profiles as Array<{ user_id: string; display_name: string | null }>).find((p) => p.user_id === userId);
    return profile?.display_name?.trim() || null;
  };
  /** Nom à afficher : le nom connu, sinon « Membre sans nom ». */
  const nameOf = (userId: string): string => knownNameOf(userId) || 'Membre sans nom';
  return { members, isLoading, nameOf, knownNameOf };
}

export function TeamSection({ project, readOnly }: { project: SourcingProject; readOnly: boolean }) {
  const { orgType, isLoading: orgLoading } = useOrganization();
  const { effectivePlanId, isLoading: planLoading } = useSubscriptionState();
  const { team, loadingTeam, addTeamMember, removeTeamMember } = useMissionProcess(project.id);
  const { members, nameOf } = useOrgMemberNames(project.organization_id ?? null);
  const { profiles: teamProfiles, getName: getTeamMemberName } = useMissionTeamProfiles(project.id);
  const externalIds = useMemo(() => new Set(teamProfiles.filter((p) => p.is_external).map((p) => p.user_id)), [teamProfiles]);

  const loading = orgLoading || planLoading;
  const allowed = !loading && hasFeature(orgType, 'team_management') && hasPlanFeature(effectivePlanId, 'team');
  if (!loading && !allowed) return null;

  return (
    <section id="cadrage-equipe" aria-labelledby="cadrage-equipe-titre" className="flex scroll-mt-4 flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h2 id="cadrage-equipe-titre" className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          Équipe
        </h2>
        <span className="text-xs text-muted-foreground">Les personnes de votre organisation qui travaillent sur la mission.</span>
      </div>
      {loading ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : (
        <div className="rounded-xl border border-border bg-card px-4 py-3.5">
          <MissionTeamSection
            embedded
            roleLabels={TEAM_ROLE_LABELS}
            team={team}
            loadingTeam={loadingTeam}
            readOnly={readOnly}
            getMemberName={nameOf}
            getTeamMemberName={getTeamMemberName}
            isExternalMember={(userId) => externalIds.has(userId)}
            orgMembers={members}
            projectId={project.id}
            projectName={project.name}
            onAdd={addTeamMember as (input: { user_id: string; role: string }) => Promise<unknown>}
            onRemove={removeTeamMember}
          />
        </div>
      )}
    </section>
  );
}
