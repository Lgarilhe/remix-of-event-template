import React, { useState } from 'react';
import type { JobDetails } from '@/types/jobDetails';
import { motion } from 'framer-motion';
import { SourcingProject, useProjectCandidates } from '@/hooks/useSourcingProjects';
import { useProjectStats } from '@/hooks/useProjectStats';
import { NumberTicker } from '@/components/magicui/number-ticker';
import {
  FileText, Users, PaperPlaneTilt, Crosshair, Sparkle, ArrowRight,
  Lightning, TrendUp, Rocket,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { getBriefCompletionPercent } from '@/lib/missionUtils';
import { FilterReviewModal } from './FilterReviewModal';

/* ─── Props ─── */
interface MissionBentoDashboardProps {
  project: SourcingProject;
  onTabChange: (tab: string) => void;
}

/* ═══════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════ */

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

  const pctColor = briefPct >= 70 ? 'text-foreground' : briefPct >= 30 ? 'text-brutal-accent' : 'text-destructive';
  const barColor = briefPct >= 70 ? 'bg-foreground' : briefPct >= 30 ? 'bg-brutal-accent' : 'bg-destructive';

  const statItems = [
    { value: totalCandidates, label: 'Sourcés', icon: Users, border: 'border-foreground/30' },
    { value: messaged, label: 'Contactés', icon: PaperPlaneTilt, border: 'border-foreground/30' },
    { value: shortlisted, label: 'Shortlistés', icon: Crosshair, border: 'border-brutal-accent/50' },
  ];

  const actions = [
    { icon: Sparkle, title: 'Sourcing', desc: 'Rechercher des profils avec l\'IA et les filtres avancés', tab: 'sourcing' },
    { icon: Lightning, title: 'Outreach', desc: 'Envoyer des messages personnalisés aux candidats', tab: 'outreach' },
    { icon: TrendUp, title: 'Pipeline', desc: 'Suivre et gérer l\'avancement des candidats', tab: 'pipeline' },
  ];

  return (
    <div className="border-2 border-foreground border-t-0">
      {/* ── Brief Card ── */}
      <button
        type="button"
        onClick={() => onTabChange('brief')}
        className="w-full text-left p-4 sm:p-6 hover:bg-foreground/[0.02] active:bg-foreground/[0.04] transition-colors group"
        style={{ WebkitTapHighlightColor: 'transparent' }}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-foreground flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4 text-background" weight="duotone" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Brief Mission</p>
              <p className="text-[9px] text-muted-foreground/60">Cliquez pour compléter</p>
            </div>
          </div>
          <div className={cn('flex items-baseline gap-0.5 font-black', pctColor)}>
            <NumberTicker value={briefPct} className={cn('text-2xl font-black', pctColor)} />
            <span className="text-sm">%</span>
          </div>
        </div>

        <h2 className="text-base sm:text-lg font-black text-foreground mb-1 truncate">
          {jd.title || project.name}
        </h2>
        <p className="text-[11px] text-muted-foreground line-clamp-2 mb-3">
          {jd.mission_description || jd.raw_brief || 'Complétez le brief pour commencer le sourcing'}
        </p>

        {/* Progress bar */}
        <div className="h-2 w-full bg-foreground/10 overflow-hidden border border-foreground/20">
          <motion.div
            className={cn('h-full', barColor)}
            initial={{ width: 0 }}
            animate={{ width: `${briefPct}%` }}
            transition={{ duration: 1, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>

        {/* Skills tags */}
        {jd.skills_must_have && jd.skills_must_have.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {jd.skills_must_have.slice(0, 5).map((s, i) => (
              <span key={i} className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border-2 border-foreground/20 text-foreground/70">{s}</span>
            ))}
            {jd.skills_must_have.length > 5 && (
              <span className="px-2 py-0.5 text-[9px] text-muted-foreground">+{jd.skills_must_have.length - 5}</span>
            )}
          </div>
        )}

        <div className="flex items-center gap-1.5 mt-3 text-[10px] font-black uppercase tracking-wider text-muted-foreground group-hover:text-foreground transition-colors">
          <span>Éditer le brief</span>
          <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
        </div>
      </button>

      {/* ── Stats ── */}
      <div className="border-t-2 border-foreground p-4 sm:p-6 space-y-4">
        <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Métriques</p>
        {statItems.map((item, i) => (
          <div key={item.label} className="flex items-center gap-3">
            <div className={cn('w-8 h-8 flex items-center justify-center border-2 shrink-0', item.border)}>
              <item.icon className="w-3.5 h-3.5 text-foreground" weight="duotone" />
            </div>
            <div className="flex items-baseline gap-2 flex-1">
              <span className="text-xl font-black text-foreground tabular-nums">
                <NumberTicker value={item.value} className="text-foreground" />
              </span>
              <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">{item.label}</span>
            </div>
            <div className="h-[1px] flex-1 bg-foreground/10" />
          </div>
        ))}
      </div>

      {/* ── Launch Sourcing CTA (when filters exist) ── */}
      {hasFilters && (
        <button
          type="button"
          onClick={() => setShowFilterReview(true)}
          className="w-full border-t-2 border-foreground p-4 sm:p-5 flex items-center gap-4 text-left bg-foreground text-background hover:bg-foreground/90 active:bg-foreground/80 transition-colors group"
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <div className="w-10 h-10 flex items-center justify-center border-2 border-background/30 shrink-0">
            <Rocket className="w-4 h-4 text-background" weight="fill" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xs font-black uppercase tracking-wider text-background mb-0.5">Lancer le sourcing</h3>
            <p className="text-[10px] text-background/70 leading-relaxed">Voir et ajuster les filtres IA avant de chercher</p>
          </div>
          <ArrowRight className="w-4 h-4 text-background/70 group-hover:translate-x-1 transition-all shrink-0" />
        </button>
      )}

      {/* ── Quick Actions ── */}
      {actions.map((action) => (
        <button
          key={action.tab}
          type="button"
          onClick={() => onTabChange(action.tab)}
          className="w-full border-t-2 border-foreground p-4 sm:p-5 flex items-center gap-4 text-left hover:bg-foreground/[0.03] active:bg-foreground/[0.06] transition-colors group"
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <div className="w-10 h-10 flex items-center justify-center border-2 border-foreground/20 group-hover:border-foreground/50 transition-colors shrink-0">
            <action.icon className="w-4 h-4 text-foreground" weight="duotone" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xs font-black uppercase tracking-wider text-foreground mb-0.5">{action.title}</h3>
            <p className="text-[10px] text-muted-foreground leading-relaxed">{action.desc}</p>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-1 transition-all shrink-0" />
        </button>
      ))}

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
