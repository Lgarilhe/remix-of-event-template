import React from 'react';
import { motion } from 'framer-motion';
import { SourcingProject, useProjectCandidates } from '@/hooks/useSourcingProjects';
import { useProjectStats } from '@/hooks/useProjectStats';
import { BentoGrid, BentoItem } from '@/components/ui/bento-grid';
import { SpotlightCard } from '@/components/ui/spotlight-card';
import { TextRotate } from '@/components/ui/text-rotate';
import { NumberTicker } from '@/components/magicui/number-ticker';
import { FileText, Users, Send, Target, TrendingUp, Clock, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { JobDetails } from '@/types/jobDetails';

interface MissionBentoDashboardProps {
  project: SourcingProject;
  onTabChange: (tab: string) => void;
}

function getBriefCompletion(p: SourcingProject) {
  const jd = (p.job_details || {}) as JobDetails;
  const fields = [
    jd.title, jd.mission_description || jd.raw_brief, jd.seniority, jd.location,
    jd.contract_type, jd.remote_policy, jd.client?.name, jd.salary_min,
    jd.experience_min, (jd.skills_must_have?.length || 0) > 0 ? true : null,
    jd.context, jd.languages?.length ? true : null,
  ];
  const filled = fields.filter(Boolean).length;
  return Math.round((filled / fields.length) * 100);
}

const StatValue: React.FC<{ value: number; label: string; icon: typeof Users; color: string }> = ({
  value, label, icon: Icon, color,
}) => (
  <div className="flex items-center gap-3">
    <div className={cn('w-10 h-10 flex items-center justify-center border border-foreground/20', color)}>
      <Icon className="w-4 h-4" />
    </div>
    <div>
      <div className="text-2xl font-black tracking-tight">
        <NumberTicker value={value} className="text-foreground" />
      </div>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
    </div>
  </div>
);

export const MissionBentoDashboard: React.FC<MissionBentoDashboardProps> = ({ project, onTabChange }) => {
  const { data: candidates = [] } = useProjectCandidates(project.id);
  const { data: stats } = useProjectStats(project.id);
  const jd = (project.job_details || {}) as JobDetails;
  const briefPct = getBriefCompletion(project);

  const totalCandidates = stats?.total || candidates.length || 0;
  const messaged = stats?.messaged || 0;
  const shortlisted = stats?.shortlisted || 0;

  return (
    <BentoGrid columns={3} className="mt-4">
      {/* ── Brief Status (2 cols) ── */}
      <BentoItem colSpan={2} delay={0}>
        <SpotlightCard className="h-full">
          <button onClick={() => onTabChange('brief')} className="w-full p-5 text-left group">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Brief Mission</h3>
              </div>
              <span className={cn(
                'text-xs font-bold px-2 py-0.5 border',
                briefPct >= 70 ? 'border-green-500/30 text-green-600 bg-green-500/10' :
                briefPct >= 30 ? 'border-amber-500/30 text-amber-600 bg-amber-500/10' :
                'border-destructive/30 text-destructive bg-destructive/10'
              )}>
                <NumberTicker value={briefPct} className="font-bold" />%
              </span>
            </div>
            <h2 className="text-lg font-bold text-foreground mb-1 group-hover:text-brutal-accent transition-colors truncate">
              {jd.title || project.name}
            </h2>
            <p className="text-xs text-muted-foreground line-clamp-2">
              {jd.mission_description || jd.raw_brief || 'Complétez le brief pour commencer le sourcing'}
            </p>
            {/* Mini progress bar */}
            <div className="mt-3 h-1.5 w-full bg-muted/30 border border-foreground/10 overflow-hidden">
              <motion.div
                className={cn(
                  'h-full',
                  briefPct >= 70 ? 'bg-green-500' : briefPct >= 30 ? 'bg-amber-500' : 'bg-destructive'
                )}
                initial={{ width: 0 }}
                animate={{ width: `${briefPct}%` }}
                transition={{ duration: 1, delay: 0.3, ease: 'easeOut' }}
              />
            </div>
            {/* Skills tags */}
            {jd.skills_must_have && jd.skills_must_have.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {jd.skills_must_have.slice(0, 5).map((s, i) => (
                  <span key={i} className="px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider border border-foreground/20 text-foreground/70">
                    {s}
                  </span>
                ))}
                {jd.skills_must_have.length > 5 && (
                  <span className="px-2 py-0.5 text-[9px] text-muted-foreground">
                    +{jd.skills_must_have.length - 5}
                  </span>
                )}
              </div>
            )}
          </button>
        </SpotlightCard>
      </BentoItem>

      {/* ── Quick Stats ── */}
      <BentoItem delay={0.1}>
        <SpotlightCard className="h-full">
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <TextRotate texts={['Vue d\'ensemble', 'Statistiques', 'Métriques']} interval={4000} rotationType="blur" />
              </h3>
            </div>
            <StatValue value={totalCandidates} label="Candidats sourcés" icon={Users} color="bg-blue-500/10 text-blue-500" />
            <StatValue value={messaged} label="Messages envoyés" icon={Send} color="bg-emerald-500/10 text-emerald-500" />
            <StatValue value={shortlisted} label="Shortlistés" icon={Target} color="bg-amber-500/10 text-amber-500" />
          </div>
        </SpotlightCard>
      </BentoItem>

      {/* ── Quick Actions Row ── */}
      <BentoItem delay={0.2}>
        <SpotlightCard className="h-full" spotlightColor="hsl(var(--brutal-accent) / 0.15)">
          <button onClick={() => onTabChange('sourcing')} className="w-full p-5 text-left group">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 bg-brutal-accent/20 border border-brutal-accent/30 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-brutal-accent" />
              </div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-foreground group-hover:text-brutal-accent transition-colors">
                Sourcing
              </h3>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Lancer une recherche de candidats
            </p>
          </button>
        </SpotlightCard>
      </BentoItem>

      <BentoItem delay={0.25}>
        <SpotlightCard className="h-full" spotlightColor="hsl(142 76% 36% / 0.15)">
          <button onClick={() => onTabChange('outreach')} className="w-full p-5 text-left group">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                <Send className="w-4 h-4 text-emerald-500" />
              </div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-foreground group-hover:text-emerald-500 transition-colors">
                Outreach
              </h3>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Contacter les candidats sélectionnés
            </p>
          </button>
        </SpotlightCard>
      </BentoItem>

      <BentoItem delay={0.3}>
        <SpotlightCard className="h-full" spotlightColor="hsl(221 83% 53% / 0.15)">
          <button onClick={() => onTabChange('pipeline')} className="w-full p-5 text-left group">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
                <Target className="w-4 h-4 text-blue-500" />
              </div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-foreground group-hover:text-blue-500 transition-colors">
                Pipeline
              </h3>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Suivre l'avancement des candidats
            </p>
          </button>
        </SpotlightCard>
      </BentoItem>
    </BentoGrid>
  );
};
