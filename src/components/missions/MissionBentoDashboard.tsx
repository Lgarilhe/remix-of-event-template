import React, { useState } from 'react';
import type { JobDetails } from '@/types/jobDetails';
import { motion } from 'framer-motion';
import { SourcingProject, useProjectCandidates } from '@/hooks/useSourcingProjects';
import { useProjectStats } from '@/hooks/useProjectStats';
import { NumberTicker } from '@/components/magicui/number-ticker';
import {
  FileText, Users, Send, Crosshair, Sparkle, ArrowRight,
  Zap, TrendingUp, Rocket,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getBriefCompletionPercent } from '@/lib/missionUtils';
import { FilterReviewModal } from './FilterReviewModal';

/* ─── Props ─── */
interface MissionBentoDashboardProps {
  project: SourcingProject;
  onTabChange: (tab: string) => void;
}

export const MissionBentoDashboard: React.FC<MissionBentoDashboardProps> = ({ project, onTabChange }) => {
  const { data: candidates = [] } = useProjectCandidates(project.id);
  const { data: stats } = useProjectStats(project.id);
  const jd = (project.job_details || {}) as JobDetails;
  const briefPct = getBriefCompletionPercent(project);

  const [showFilterReview, setShowFilterReview] = useState(false);
  const hasFilters = !!(project as any).filters_snapshot?.role?.length || !!(project as any).filters_snapshot?.skills_keywords?.length;
  const filtersSnapshot = (project as any).filters_snapshot;

  const totalCandidates = stats?.total || candidates.length || 0;
  const messaged = stats?.messaged || 0;
  const shortlisted = stats?.shortlisted || 0;

  const statItems = [
    { value: totalCandidates, label: 'Sourcés', icon: Users },
    { value: messaged, label: 'Contactés', icon: Send },
    { value: shortlisted, label: 'Shortlistés', icon: Crosshair },
  ];

  const actions = [
    { icon: Sparkle, title: 'Sourcing', desc: 'Rechercher des profils avec l\'IA et les filtres avancés', tab: 'sourcing' },
    { icon: Zap, title: 'Outreach', desc: 'Envoyer des messages personnalisés aux candidats', tab: 'outreach' },
    { icon: TrendingUp, title: 'Pipeline', desc: 'Suivre et gérer l\'avancement des candidats', tab: 'pipeline' },
  ];

  return (
    <div className="space-y-4">
      {/* ── Brief Card ── */}
      <button
        type="button"
        onClick={() => onTabChange('brief')}
        className="w-full text-left rounded-lg border border-border bg-card p-5 sm:p-6 hover:border-primary/30 hover:shadow-sm transition-all group"
        style={{ WebkitTapHighlightColor: 'transparent' }}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Brief Mission</p>
              <p className="text-[11px] text-muted-foreground/60">Cliquez pour compléter</p>
            </div>
          </div>
          <div className={cn(
            'flex items-baseline gap-0.5 font-semibold',
            briefPct >= 70 ? 'text-primary' : briefPct >= 30 ? 'text-warning' : 'text-destructive'
          )}>
            <NumberTicker value={briefPct} className={cn(
              'text-2xl font-semibold',
              briefPct >= 70 ? 'text-primary' : briefPct >= 30 ? 'text-warning' : 'text-destructive'
            )} />
            <span className="text-sm">%</span>
          </div>
        </div>

        <h2 className="text-base font-semibold text-foreground mb-1 truncate">
          {jd.title || project.name}
        </h2>
        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
          {jd.mission_description || jd.raw_brief || 'Complétez le brief pour commencer le sourcing'}
        </p>

        {/* Progress bar */}
        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
          <motion.div
            className={cn(
              'h-full rounded-full',
              briefPct >= 70 ? 'bg-primary' : briefPct >= 30 ? 'bg-warning' : 'bg-destructive'
            )}
            initial={{ width: 0 }}
            animate={{ width: `${briefPct}%` }}
            transition={{ duration: 1, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>

        {/* Skills tags */}
        {jd.skills_must_have && jd.skills_must_have.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {jd.skills_must_have.slice(0, 5).map((s, i) => (
              <span key={i} className="px-2 py-0.5 text-xs font-medium rounded-md bg-muted text-muted-foreground">{s}</span>
            ))}
            {jd.skills_must_have.length > 5 && (
              <span className="px-2 py-0.5 text-xs text-muted-foreground">+{jd.skills_must_have.length - 5}</span>
            )}
          </div>
        )}

        <div className="flex items-center gap-1.5 mt-3 text-xs font-medium text-muted-foreground group-hover:text-primary transition-colors">
          <span>Éditer le brief</span>
          <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
        </div>
      </button>

      {/* ── Stats ── */}
      <div className="grid grid-cols-3 gap-3">
        {statItems.map((item) => (
          <div key={item.label} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <item.icon className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">{item.label}</span>
            </div>
            <span className="text-2xl font-semibold text-foreground tabular-nums">
              <NumberTicker value={item.value} className="text-foreground" />
            </span>
          </div>
        ))}
      </div>

      {/* ── Launch Sourcing CTA ── */}
      {hasFilters && (
        <button
          type="button"
          onClick={() => setShowFilterReview(true)}
          className="w-full rounded-lg p-5 flex items-center gap-4 text-left bg-primary text-primary-foreground hover:bg-primary/90 transition-colors group"
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-primary-foreground/20 shrink-0">
            <Rocket className="w-4 h-4 text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold mb-0.5">Lancer le sourcing</h3>
            <p className="text-xs opacity-80 leading-relaxed">Voir et ajuster les filtres IA avant de chercher</p>
          </div>
          <ArrowRight className="w-4 h-4 opacity-70 group-hover:translate-x-0.5 transition-all shrink-0" />
        </button>
      )}

      {/* ── Quick Actions ── */}
      <div className="space-y-2">
        {actions.map((action) => (
          <button
            key={action.tab}
            type="button"
            onClick={() => onTabChange(action.tab)}
            className="w-full rounded-lg border border-border bg-card p-4 flex items-center gap-3 text-left hover:border-primary/20 hover:shadow-sm transition-all group"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-muted shrink-0 group-hover:bg-primary/10 transition-colors">
              <action.icon className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-medium text-foreground">{action.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{action.desc}</p>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
          </button>
        ))}
      </div>

      {/* Filter Review Modal */}
      {hasFilters && filtersSnapshot && (
        <FilterReviewModal
          open={showFilterReview}
          onOpenChange={setShowFilterReview}
          filters={filtersSnapshot}
          analysis={filtersSnapshot.analysis || { search_rationale: null, keyword_rationale: null, experience_rationale: null, role_keywords: filtersSnapshot.role?.map((r: any) => r.keywords) || [], skills_to_search: filtersSnapshot.skills_keywords || [], domain_expertise: [], location_hint: null, job_category: '' }}
          onAccept={() => { setShowFilterReview(false); onTabChange('sourcing'); }}
        />
      )}
    </div>
  );
};
