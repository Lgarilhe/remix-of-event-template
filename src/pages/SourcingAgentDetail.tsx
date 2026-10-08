import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { SourcingAgentWorkspace } from '@/components/agent/SourcingAgentDialog';
import { SEOHead } from '@/components/SEOHead';
import { PageLayout, PageHeader, ErrorState } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export default function SourcingAgentDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const { organizationId } = useOrganization();
  const { user } = useAuthReady();
  const validId = Boolean(projectId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId));
  const project = useQuery({
    queryKey: ['sourcing-agent-project', organizationId, user?.id, projectId],
    enabled: Boolean(validId && organizationId && user?.id),
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.from('sourcing_projects').select('id,name,status,organization_id,created_by')
        .eq('id', projectId!).eq('organization_id', organizationId!).eq('kind', 'mission').maybeSingle();
      if (error) throw error;
      if (!data || data.organization_id !== organizationId) return null;
      return data;
    },
  });
  // Never mount the workspace with a previous organization's cached mission.
  const mission = project.data?.organization_id === organizationId ? project.data : null;
  return <PageLayout maxWidth="lg">
    <SEOHead title="Agent de sourcing | Konekt" description="Préparez, calibrez et pilotez l’agent de votre mission." />
    <Button asChild variant="ghost" className="mb-5 min-h-11 -ml-3"><Link to="/agents/sourcing"><ArrowLeft aria-hidden="true" />Tous les agents</Link></Button>
    {!validId ? <ErrorState title="Cette mission est introuvable." description="Choisissez une mission depuis votre espace Agents." /> : project.isPending ? <div aria-label="Chargement de la mission"><Skeleton className="mb-6 h-12 w-64" /><Skeleton className="h-96 w-full rounded-xl" /></div> : project.isError ? <ErrorState className="max-sm:[&_button]:min-h-11" title="La mission n’a pas pu être chargée." onRetry={() => void project.refetch()} retrying={project.isFetching} /> : !mission || !projectId ? <ErrorState title="Cette mission n’est pas accessible dans votre espace." description="Revenez à vos agents ou sélectionnez le bon espace de travail." /> : <>
      <PageHeader title={mission.name} subtitle="Votre agent de sourcing" actions={<><Button asChild variant="ghost" className="min-h-11"><Link to={`/missions/${mission.id}/cadrage`}>Consulter le cadrage</Link></Button><Button asChild variant="outline" className="min-h-11"><Link to={`/missions/${mission.id}/sourcing`}>Ouvrir la mission<ArrowUpRight aria-hidden="true" /></Link></Button></>} />
      <SourcingAgentWorkspace key={`${organizationId}:${user?.id}:${mission.id}`} projectId={mission.id} projectName={mission.name} missionStatus={mission.status} />
    </>}
  </PageLayout>;
}
