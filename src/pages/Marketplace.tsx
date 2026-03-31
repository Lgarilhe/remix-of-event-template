import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { SEOHead } from '@/components/SEOHead';
import { SEOHead } from '@/components/SEOHead';
import { useOrganization } from '@/hooks/useOrganization';
import { hasFeature, getOrgTypeEmoji, getOrgTypeLabel } from '@/lib/featureGates';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Search, Target, MapPin, DollarSign, Clock, Users, Lock, Calendar, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';

interface HuntMission {
  id: string;
  name: string;
  client_name: string | null;
  job_details: any;
  hunt_bounty_percent: number | null;
  hunt_max_recruiters: number | null;
  hunt_deadline: string | null;
  hunt_status: string;
  created_at: string;
  organization_id: string;
}

export default function Marketplace() {
  const navigate = useNavigate();
  const { orgType, organizationId } = useOrganization();
  const canBrowse = hasFeature(orgType, 'marketplace_browse');

  const [search, setSearch] = useState('');
  const [filterContract, setFilterContract] = useState('');
  const [filterRemote, setFilterRemote] = useState('');

  // Fetch published hunt missions
  const { data: missions = [], isLoading } = useQuery({
    queryKey: ['marketplace-missions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sourcing_projects')
        .select('id, name, client_name, job_details, hunt_bounty_percent, hunt_max_recruiters, hunt_deadline, hunt_status, created_at, organization_id')
        .eq('hunt_mode', true)
        .eq('hunt_status', 'published')
        .neq('organization_id', organizationId || '')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as HuntMission[];
    },
    enabled: canBrowse,
    staleTime: 2 * 60 * 1000,
  });

  // Filter missions
  const filtered = useMemo(() => {
    return missions.filter(m => {
      const jd = m.job_details || {};
      const searchLower = search.toLowerCase();
      const matchesSearch = !search
        || m.name.toLowerCase().includes(searchLower)
        || (m.client_name || '').toLowerCase().includes(searchLower)
        || (jd.title || '').toLowerCase().includes(searchLower)
        || (jd.location || '').toLowerCase().includes(searchLower);
      const matchesContract = !filterContract || jd.contract_type === filterContract;
      const matchesRemote = !filterRemote || jd.remote_policy === filterRemote;
      return matchesSearch && matchesContract && matchesRemote;
    });
  }, [missions, search, filterContract, filterRemote]);

  const [applyingId, setApplyingId] = useState<string | null>(null);

  const handleApply = async (missionId: string) => {
    if (applyingId) return;
    setApplyingId(missionId);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase
        .from('hunt_applications')
        .insert({
          project_id: missionId,
          recruiter_user_id: user.id,
          recruiter_org_id: organizationId,
          status: 'pending',
        });
      if (error) {
        if (error.code === '23505' || error.message?.includes('duplicate') || error.message?.includes('unique')) {
          toast.error('Vous avez déjà postulé à cette mission');
        } else {
          throw error;
        }
        return;
      }
      toast.success('Candidature envoyée !');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur lors de la candidature');
    } finally {
      setApplyingId(null);
    }
  };

  if (!canBrowse) {
    return (
      <div className="min-h-screen bg-background">
        <SEOHead title="Marketplace | Skalr" description="Missions en mode chasse" />

        <div className="py-6 pb-14">
          <div className="max-w-[1600px] mx-auto px-3 sm:px-6 lg:px-8">
            <div className="border border-foreground p-12 text-center">
              <Lock className="w-8 h-8 text-muted-foreground mx-auto mb-4" />
              <h2 className="text-sm font-bold uppercase tracking-wider mb-2">Marketplace réservée</h2>
              <p className="text-xs text-muted-foreground">
                La marketplace est accessible aux cabinets de recrutement et recruteurs freelances.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SEOHead title="Marketplace | Skalr" description="Missions en mode chasse — trouvez des opportunités de recrutement" />

      <div className="py-6 pb-14">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Target className="w-6 h-6 text-foreground" />
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-foreground uppercase tracking-tight">Marketplace</h1>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">
                  {filtered.length} mission{filtered.length > 1 ? 's' : ''} en mode chasse
                </p>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <div className="relative flex-1 min-w-[200px] max-w-[400px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un poste, un client..."
                className="w-full h-[34px] pl-9 pr-3 text-sm border border-foreground/30 bg-background text-foreground focus:border-foreground focus:outline-none transition-colors"
              />
            </div>
            <select
              value={filterContract}
              onChange={(e) => setFilterContract(e.target.value)}
              className="h-[34px] px-3 text-xs font-medium uppercase tracking-wider border border-foreground/30 bg-background text-foreground focus:border-foreground focus:outline-none"
            >
              <option value="">Tous les contrats</option>
              <option value="cdi">CDI</option>
              <option value="cdd">CDD</option>
              <option value="freelance">Freelance</option>
            </select>
            <select
              value={filterRemote}
              onChange={(e) => setFilterRemote(e.target.value)}
              className="h-[34px] px-3 text-xs font-medium uppercase tracking-wider border border-foreground/30 bg-background text-foreground focus:border-foreground focus:outline-none"
            >
              <option value="">Tous les modes</option>
              <option value="onsite">Sur site</option>
              <option value="hybrid">Hybride</option>
              <option value="full_remote">Full remote</option>
            </select>
          </div>

          {/* Mission cards */}
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-5 h-5 border-2 border-foreground/20 border-t-foreground animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="border border-dashed border-foreground/20 p-12 text-center">
              <Target className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <h3 className="text-sm font-bold uppercase tracking-wider mb-2">Aucune mission disponible</h3>
              <p className="text-xs text-muted-foreground">
                {missions.length === 0
                  ? 'Aucune entreprise n\'a publié de mission en mode chasse pour le moment.'
                  : 'Aucune mission ne correspond à vos filtres.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(mission => {
                const jd = mission.job_details || {};
                return (
                  <div
                    key={mission.id}
                    className="border border-foreground/20 bg-background hover:border-foreground hover:shadow-[3px_3px_0px_0px_hsl(var(--foreground))] transition-all"
                  >
                    <div className="p-4 space-y-3">
                      {/* Title + client */}
                      <div>
                        <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
                          {jd.title || mission.name}
                        </h3>
                        {mission.client_name && (
                          <p className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">
                            {mission.client_name}
                          </p>
                        )}
                      </div>

                      {/* Tags */}
                      <div className="flex flex-wrap gap-1.5">
                        {jd.contract_type && (
                          <span className="px-2 py-0.5 text-xs font-bold uppercase tracking-wider border border-foreground/20 text-foreground">
                            {jd.contract_type.toUpperCase()}
                          </span>
                        )}
                        {jd.location && (
                          <span className="flex items-center gap-0.5 px-2 py-0.5 text-xs font-bold uppercase tracking-wider border border-foreground/20 text-muted-foreground">
                            <MapPin className="w-2.5 h-2.5" /> {jd.location}
                          </span>
                        )}
                        {jd.remote_policy && (
                          <span className="px-2 py-0.5 text-xs font-bold uppercase tracking-wider border border-foreground/20 text-muted-foreground">
                            {jd.remote_policy === 'full_remote' ? 'Remote' : jd.remote_policy === 'hybrid' ? 'Hybride' : 'Sur site'}
                          </span>
                        )}
                        {jd.seniority && (
                          <span className="px-2 py-0.5 text-xs font-bold uppercase tracking-wider border border-foreground/20 text-muted-foreground">
                            {jd.seniority}
                          </span>
                        )}
                      </div>

                      {/* Skills */}
                      {(jd.skills_must_have?.length > 0) && (
                        <div className="flex flex-wrap gap-1">
                          {jd.skills_must_have.slice(0, 5).map((skill: string, i: number) => (
                            <span key={i} className="px-1.5 py-0.5 text-xs font-medium bg-red-600 text-white uppercase tracking-wider">
                              {skill}
                            </span>
                          ))}
                          {jd.skills_must_have.length > 5 && (
                            <span className="text-xs text-muted-foreground self-center">+{jd.skills_must_have.length - 5}</span>
                          )}
                        </div>
                      )}

                      {/* Bottom row */}
                      <div className="flex items-center justify-between pt-2 border-t border-foreground/10">
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {mission.hunt_bounty_percent && (
                            <span className="flex items-center gap-0.5">
                              <DollarSign className="w-3 h-3" /> {mission.hunt_bounty_percent}%
                            </span>
                          )}
                          {mission.hunt_max_recruiters && (
                            <span className="flex items-center gap-0.5">
                              <Users className="w-3 h-3" /> max {mission.hunt_max_recruiters}
                            </span>
                          )}
                          <span className="flex items-center gap-0.5">
                            <Clock className="w-3 h-3" /> {formatDistanceToNow(new Date(mission.created_at), { addSuffix: true, locale: fr })}
                          </span>
                          {mission.hunt_deadline && (
                            <span className="flex items-center gap-0.5 text-amber-600">
                              <Calendar className="w-3 h-3" /> Deadline {new Date(mission.hunt_deadline).toLocaleDateString('fr-FR')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Apply button */}
                    <div className="border-t border-foreground/10 p-3">
                      <button
                        onClick={() => handleApply(mission.id)}
                        disabled={applyingId === mission.id}
                        className={cn(
                          "relative overflow-hidden w-full h-[34px] border border-foreground text-xs font-medium uppercase tracking-wider group",
                          applyingId === mission.id
                            ? "bg-muted text-muted-foreground"
                            : "bg-foreground text-background"
                        )}
                      >
                        <span className="relative z-10 flex items-center justify-center gap-1.5">
                          {applyingId === mission.id && <Loader2 className="w-3 h-3 animate-spin" />}
                          {applyingId === mission.id ? 'Envoi...' : 'Postuler'}
                        </span>
                        {applyingId !== mission.id && (
                          <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
