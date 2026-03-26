import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { SEOHead } from '@/components/SEOHead';
import { Loader2, Users, ExternalLink, Clock, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';

interface PortalCandidate {
  id: string;
  candidate_name: string | null;
  candidate_headline: string | null;
  pipeline_stage: string | null;
  score: number | null;
  recommendation: string | null;
  updated_at: string;
  created_at: string;
}

interface PortalProject {
  id: string;
  name: string;
  status: string;
  candidates: PortalCandidate[];
}

interface ClientPortalData {
  client_name: string;
  org_name: string | null;
  org_logo: string | null;
  projects: PortalProject[];
  permissions: {
    can_comment: boolean;
    can_see_names: boolean;
    can_fill_scorecard: boolean;
  };
}

export default function ClientPortal() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ClientPortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [comment, setComment] = useState('');
  const [commentingOn, setCommentingOn] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setNotFound(true); setLoading(false); return; }

    const fetchPortal = async () => {
      try {
        // 1. Get token data
        const { data: tokenRow, error: tokenErr } = await supabase
          .from('client_portal_tokens')
          .select('*')
          .eq('token', token)
          .single();

        if (tokenErr || !tokenRow) { setNotFound(true); setLoading(false); return; }

        // Update last_accessed_at
        supabase.from('client_portal_tokens').update({ last_accessed_at: new Date().toISOString() }).eq('id', tokenRow.id).then(() => {});

        // 2. Get organization info
        const { data: org } = await supabase
          .from('organizations')
          .select('name, logo_url')
          .eq('id', tokenRow.organization_id)
          .single();

        // 3. Get projects
        const projectIds = tokenRow.project_ids as string[] | null;
        let projectsQuery = supabase
          .from('sourcing_projects')
          .select('id, name, status')
          .eq('organization_id', tokenRow.organization_id);

        if (projectIds && projectIds.length > 0) {
          projectsQuery = projectsQuery.in('id', projectIds);
        }

        const { data: projects } = await projectsQuery.order('created_at', { ascending: false });

        // 4. Get candidates for each project
        const portalProjects: PortalProject[] = [];
        for (const proj of (projects || [])) {
          const { data: candidates } = await supabase
            .from('job_candidate_status')
            .select('id, candidate_name, candidate_headline, pipeline_stage, score, recommendation, updated_at, created_at')
            .eq('project_id', proj.id)
            .order('updated_at', { ascending: false })
            .limit(50);

          portalProjects.push({
            id: proj.id,
            name: proj.name,
            status: proj.status,
            candidates: (candidates || []) as PortalCandidate[],
          });
        }

        setData({
          client_name: tokenRow.client_name,
          org_name: org?.name || null,
          org_logo: org?.logo_url || null,
          projects: portalProjects,
          permissions: tokenRow.permissions as any || { can_comment: true, can_see_names: true, can_fill_scorecard: true },
        });
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };
    fetchPortal();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-6 h-6 animate-spin text-foreground" />
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Chargement du portail client...</p>
        </div>
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <SEOHead title="Portail client | Skalr" description="Accès client" />
        <div className="text-center max-w-md">
          <div className="text-4xl mb-4">🔒</div>
          <h1 className="text-sm font-bold uppercase tracking-wider text-foreground mb-2">Lien invalide ou expiré</h1>
          <p className="text-xs text-muted-foreground">
            Ce lien d'accès n'est plus valide. Contactez votre recruteur pour obtenir un nouveau lien.
          </p>
        </div>
      </div>
    );
  }

  const totalCandidates = data.projects.reduce((sum, p) => sum + p.candidates.length, 0);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead title={`Portail client — ${data.client_name} | Skalr`} description="Suivez vos missions de recrutement" />

      {/* Header */}
      <header className="border-b-2 border-foreground bg-background sticky top-0 z-10">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {data.org_logo && (
              <img src={data.org_logo} alt="" className="h-7 w-7 object-contain" />
            )}
            <div>
              <h1 className="text-sm font-bold uppercase tracking-wider text-foreground">
                {data.org_name || 'Portail client'}
              </h1>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Bienvenue, {data.client_name}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground uppercase tracking-wider">
            <span>{data.projects.length} mission{data.projects.length > 1 ? 's' : ''}</span>
            <span>·</span>
            <span>{totalCandidates} candidat{totalCandidates > 1 ? 's' : ''}</span>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        {data.projects.length === 0 ? (
          <div className="border border-dashed border-foreground/20 p-12 text-center">
            <Users className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-sm font-bold uppercase tracking-wider mb-2">Aucune mission en cours</h3>
            <p className="text-xs text-muted-foreground">Votre recruteur n'a pas encore partagé de missions avec vous.</p>
          </div>
        ) : (
          data.projects.map(project => (
            <div key={project.id} className="border border-foreground/20">
              {/* Project header */}
              <div className="px-4 py-3 bg-foreground/5 border-b border-foreground/20 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">{project.name}</h2>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">
                    {project.candidates.length} candidat{project.candidates.length > 1 ? 's' : ''} · {project.status}
                  </p>
                </div>
              </div>

              {/* Candidates */}
              {project.candidates.length === 0 ? (
                <div className="p-6 text-center">
                  <p className="text-xs text-muted-foreground">Aucun candidat pour cette mission.</p>
                </div>
              ) : (
                <div className="divide-y divide-foreground/10">
                  {project.candidates.map(candidate => (
                    <div key={candidate.id} className="px-4 py-3 flex items-center gap-4 hover:bg-muted/20 transition-colors">
                      {/* Avatar placeholder */}
                      <div className="w-8 h-8 bg-foreground/10 flex items-center justify-center shrink-0">
                        <span className="text-[11px] font-bold text-foreground">
                          {data.permissions.can_see_names
                            ? (candidate.candidate_name?.[0] || '?').toUpperCase()
                            : '#'}
                        </span>
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">
                          {data.permissions.can_see_names
                            ? (candidate.candidate_name || 'Candidat')
                            : `Candidat #${candidate.id.slice(0, 6)}`}
                        </p>
                        {candidate.candidate_headline && data.permissions.can_see_names && (
                          <p className="text-[10px] text-muted-foreground truncate">{candidate.candidate_headline}</p>
                        )}
                      </div>

                      {/* Stage */}
                      <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border border-foreground/20 text-foreground shrink-0">
                        {candidate.pipeline_stage || 'Nouveau'}
                      </span>

                      {/* Score */}
                      {candidate.score != null && (
                        <span className={cn(
                          "px-1.5 py-0.5 text-[10px] font-bold shrink-0",
                          candidate.score >= 70 ? "bg-green-600 text-white" :
                          candidate.score >= 40 ? "bg-amber-500 text-white" :
                          "bg-red-600 text-white"
                        )}>
                          {candidate.score}
                        </span>
                      )}

                      {/* Time */}
                      <span className="text-[9px] text-muted-foreground shrink-0 hidden sm:flex items-center gap-0.5">
                        <Clock className="w-2.5 h-2.5" />
                        {formatDistanceToNow(new Date(candidate.updated_at), { addSuffix: true, locale: fr })}
                      </span>

                      {/* Comment button */}
                      {data.permissions.can_comment && (
                        <button
                          onClick={() => setCommentingOn(commentingOn === candidate.id ? null : candidate.id)}
                          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-foreground/10 py-6 text-center">
        <p className="text-[9px] text-muted-foreground uppercase tracking-wider">
          Portail propulsé par Skalr
        </p>
      </footer>
    </div>
  );
}
