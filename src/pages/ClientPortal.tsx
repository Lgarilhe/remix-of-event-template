import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { SEOHead } from '@/components/SEOHead';
import { Users, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { PortalCandidateScoring } from '@/components/portal/PortalCandidateScoring';

interface PortalCandidate {
  id: string;
  candidate_name: string | null;
  candidate_headline: string | null;
  pipeline_stage: string | null;
  score: number | null;
  updated_at: string;
  created_at: string;
  project_id: string;
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
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    if (!token) { setNotFound(true); setLoading(false); return; }

    const fetchPortal = async () => {
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const res = await fetch(
          `${supabaseUrl}/functions/v1/client-portal-data?token=${encodeURIComponent(token)}`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${anonKey}`,
              'apikey': anonKey,
            },
          }
        );

        if (!res.ok) {
          setNotFound(true);
          setLoading(false);
          return;
        }

        const portalData: ClientPortalData = await res.json();
        if (!portalData.client_name) {
          setNotFound(true);
          setLoading(false);
          return;
        }

        setData(portalData);
      } catch (err) {
        console.error('Portal fetch error:', err);
        setFetchError(true);
      } finally {
        setLoading(false);
      }
    };
    fetchPortal().catch(() => {
      setFetchError(true);
      setLoading(false);
    });
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-6 h-6 border border-border border-t-foreground animate-spin" />
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Chargement du portail client...</p>
        </div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <SEOHead title="Portail client | Skalr" description="Accès client" />
        <div className="text-center max-w-md">
          <div className="text-4xl mb-4">⚠️</div>
          <h1 className="text-sm font-bold uppercase tracking-wider text-foreground mb-2">Erreur de chargement</h1>
          <p className="text-xs text-muted-foreground">
            Impossible de charger le portail client. Veuillez réessayer plus tard ou contacter votre recruteur.
          </p>
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
      <header className="border-b-2 border-border bg-background sticky top-0 z-10">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {data.org_logo && (
              <img src={data.org_logo} alt={data.org_name || 'Logo organisation'} className="h-7 w-7 object-contain" />
            )}
            <div>
              <h1 className="text-sm font-bold uppercase tracking-wider text-foreground">
                {data.org_name || 'Portail client'}
              </h1>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                Bienvenue, {data.client_name}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground uppercase tracking-wider">
            <span>{data.projects.length} mission{data.projects.length > 1 ? 's' : ''}</span>
            <span>·</span>
            <span>{totalCandidates} candidat{totalCandidates > 1 ? 's' : ''}</span>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        {data.projects.length === 0 ? (
          <div className="border border-dashed border-border p-12 text-center">
            <Users className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-sm font-bold uppercase tracking-wider mb-2">Aucune mission en cours</h3>
            <p className="text-xs text-muted-foreground">Votre recruteur n'a pas encore partagé de missions avec vous.</p>
          </div>
        ) : (
          data.projects.map(project => (
            <div key={project.id} className="border border-border">
              {/* Project header */}
              <div className="px-4 py-3 bg-accent/50 border-b border-border flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">{project.name}</h2>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">
                    {project.candidates.length} candidat{project.candidates.length > 1 ? 's' : ''}
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
                    <React.Fragment key={candidate.id}>
                      <div className="px-4 py-3 flex items-center gap-4 hover:bg-muted/20 transition-colors">
                        {/* Avatar placeholder */}
                        <div className="w-8 h-8 bg-foreground/10 flex items-center justify-center shrink-0">
                          <span className="text-xs font-bold text-foreground">
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
                            <p className="text-xs text-muted-foreground truncate">{candidate.candidate_headline}</p>
                          )}
                        </div>

                        {/* Stage */}
                        <span className="px-2 py-0.5 text-xs font-bold uppercase tracking-wider border border-border text-foreground shrink-0">
                          {candidate.pipeline_stage || 'Nouveau'}
                        </span>

                        {/* Score */}
                        {candidate.score != null && (
                          <span className={cn(
                            "px-1.5 py-0.5 text-xs font-bold shrink-0",
                            candidate.score >= 70 ? "bg-foreground text-background" :
                            candidate.score >= 40 ? "bg-foreground/60 text-background" :
                            "bg-foreground/30 text-foreground"
                          )}>
                            {candidate.score}
                          </span>
                        )}

                        {/* Time */}
                        <span className="text-xs text-muted-foreground shrink-0 hidden sm:flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          {formatDistanceToNow(new Date(candidate.updated_at), { addSuffix: true, locale: fr })}
                        </span>
                      </div>
                      {/* Inline scoring */}
                      {data.permissions.can_fill_scorecard && (
                        <PortalCandidateScoring
                          candidate={candidate}
                          projectId={project.id}
                          clientName={data.client_name}
                          canFillScorecard={data.permissions.can_fill_scorecard}
                          portalToken={token!}
                        />
                      )}
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-6 text-center">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">
          Portail propulsé par Skalr
        </p>
      </footer>
    </div>
  );
}
