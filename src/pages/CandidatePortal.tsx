import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { SEOHead } from '@/components/SEOHead';
import { CheckCircle2, Clock, Send, Users, FileText, Briefcase, Calendar, ArrowRight, Loader2, ShieldX } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PortalData {
  candidate_name: string | null;
  job_title: string | null;
  company_name: string | null;
  pipeline_stage: string | null;
  next_steps: string | null;
  updated_at: string;
}

const STAGE_PROGRESS: Record<string, { order: number; icon: typeof Send; label: string; description: string }> = {
  'Nouveau': { order: 0, icon: Users, label: 'Candidature reçue', description: 'Votre candidature a bien été reçue et est en cours de revue.' },
  'Contacté': { order: 1, icon: Send, label: 'Premier contact', description: 'Nous avons pris contact avec vous.' },
  'Répondu': { order: 2, icon: CheckCircle2, label: 'Échange en cours', description: 'Nous sommes en discussion.' },
  'Pré-qualif': { order: 3, icon: Clock, label: 'Pré-qualification', description: 'Un entretien de pré-qualification est prévu.' },
  'CV envoyé': { order: 4, icon: FileText, label: 'Dossier transmis', description: 'Votre dossier a été transmis à notre client.' },
  'ITW en cours': { order: 5, icon: Calendar, label: 'Entretiens', description: 'Les entretiens sont en cours.' },
  'Offre': { order: 6, icon: Briefcase, label: 'Proposition', description: 'Une proposition est en cours de finalisation.' },
  'Gagné': { order: 7, icon: CheckCircle2, label: 'Finalisé', description: 'Le processus est finalisé. Félicitations !' },
};

export default function CandidatePortal() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!token) { setNotFound(true); setLoading(false); return; }

    const fetchPortal = async () => {
      const { data: result, error } = await supabase
        .from('candidate_portal_tokens')
        .select('candidate_name, job_title, company_name, pipeline_stage, next_steps, updated_at')
        .eq('token', token)
        .eq('is_active', true)
        .single();

      if (error || !result) {
        setNotFound(true);
      } else {
        setData(result);
      }
      setLoading(false);
    };
    fetchPortal();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-foreground" />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <SEOHead title="Portail candidat" description="Suivez l'avancement de votre candidature" />
        <div className="text-center max-w-md">
          <ShieldX className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-xl font-bold text-foreground mb-2">Lien invalide ou expiré</h1>
          <p className="text-sm text-muted-foreground">
            Ce lien de suivi n'est plus actif. Contactez votre recruteur pour obtenir un nouveau lien.
          </p>
        </div>
      </div>
    );
  }

  const currentStage = data.pipeline_stage || 'Nouveau';
  const currentOrder = STAGE_PROGRESS[currentStage]?.order ?? 0;
  const visibleStages = Object.entries(STAGE_PROGRESS)
    .filter(([key]) => key !== 'Gagné' || currentStage === 'Gagné')
    .sort((a, b) => a[1].order - b[1].order);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title={`Suivi candidature — ${data.job_title || 'Poste'}`}
        description="Suivez l'avancement de votre candidature en temps réel"
      />

      <div className="max-w-2xl mx-auto px-4 py-12 sm:py-20">
        {/* Header */}
        <div className="border border-foreground bg-background p-6 mb-8">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-8 w-8 bg-foreground text-background flex items-center justify-center">
              <Briefcase className="w-4 h-4" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Portail candidat
            </span>
          </div>
          
          {data.candidate_name && (
            <p className="text-sm text-muted-foreground mb-1">
              Bonjour <span className="font-semibold text-foreground">{data.candidate_name}</span>,
            </p>
          )}
          
          <h1 className="text-2xl sm:text-3xl font-black text-foreground uppercase tracking-tight mb-1">
            {data.job_title || 'Votre candidature'}
          </h1>
          
          {data.company_name && (
            <p className="text-sm text-muted-foreground">
              {data.company_name}
            </p>
          )}
        </div>

        {/* Progress Timeline */}
        <div className="border border-foreground bg-background mb-8">
          <div className="px-4 py-2.5 border-b border-foreground">
            <span className="text-[11px] font-bold uppercase tracking-wider">
              Avancement du processus
            </span>
          </div>
          
          <div className="p-4 space-y-0">
            {visibleStages.map(([key, stage], index) => {
              const isPast = stage.order < currentOrder;
              const isCurrent = stage.order === currentOrder;
              const isFuture = stage.order > currentOrder;
              const Icon = stage.icon;
              const isLast = index === visibleStages.length - 1;

              return (
                <div key={key} className="flex gap-4">
                  {/* Timeline line + dot */}
                  <div className="flex flex-col items-center">
                    <div className={cn(
                      "w-8 h-8 flex items-center justify-center border-2 shrink-0",
                      isPast && "bg-foreground border-foreground text-background",
                      isCurrent && "bg-brutal-accent border-foreground text-foreground",
                      isFuture && "bg-muted/30 border-border text-muted-foreground"
                    )}>
                      <Icon className="w-4 h-4" />
                    </div>
                    {!isLast && (
                      <div className={cn(
                        "w-0.5 h-8",
                        isPast ? "bg-foreground" : "bg-border"
                      )} />
                    )}
                  </div>

                  {/* Content */}
                  <div className={cn("pb-6", isLast && "pb-0")}>
                    <span className={cn(
                      "text-sm font-bold",
                      isFuture ? "text-muted-foreground" : "text-foreground"
                    )}>
                      {stage.label}
                    </span>
                    {isCurrent && (
                      <span className="ml-2 text-[8px] px-1.5 py-0.5 bg-brutal-accent border border-foreground font-bold uppercase tracking-wider">
                        En cours
                      </span>
                    )}
                    {isPast && (
                      <span className="ml-2 text-[8px] px-1.5 py-0.5 bg-foreground text-background font-bold uppercase tracking-wider">
                        ✓
                      </span>
                    )}
                    <p className={cn(
                      "text-[11px] mt-0.5",
                      isFuture ? "text-muted-foreground/50" : "text-muted-foreground"
                    )}>
                      {stage.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Next Steps */}
        {data.next_steps && (
          <div className="border border-foreground bg-background p-4 mb-8">
            <div className="flex items-center gap-2 mb-2">
              <ArrowRight className="w-4 h-4 text-foreground" />
              <span className="text-[11px] font-bold uppercase tracking-wider">Prochaines étapes</span>
            </div>
            <p className="text-sm text-foreground whitespace-pre-wrap">{data.next_steps}</p>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-[10px] text-muted-foreground uppercase tracking-wider">
          Dernière mise à jour : {new Date(data.updated_at).toLocaleDateString('fr-FR', {
            day: 'numeric', month: 'long', year: 'numeric',
          })}
        </p>
      </div>
    </div>
  );
}
