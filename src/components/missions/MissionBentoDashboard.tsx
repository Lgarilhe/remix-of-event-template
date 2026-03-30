import React, { useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { SourcingProject, useProjectCandidates } from '@/hooks/useSourcingProjects';
import { useProjectStats } from '@/hooks/useProjectStats';
import { NumberTicker } from '@/components/magicui/number-ticker';
import { TextRotate } from '@/components/ui/text-rotate';
import {
  FileText, Users, PaperPlaneTilt, Crosshair, Sparkle, ArrowRight,
  Lightning, TrendUp, ChartBar, Brain,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { JobDetails } from '@/types/jobDetails';

/* ─── Props ─── */
interface MissionBentoDashboardProps {
  project: SourcingProject;
  onTabChange: (tab: string) => void;
}

/* ─── Brief completion ─── */
function getBriefCompletion(p: SourcingProject) {
  const jd = (p.job_details || {}) as JobDetails;
  const fields = [
    jd.title, jd.mission_description || jd.raw_brief, jd.seniority, jd.location,
    jd.contract_type, jd.remote_policy, jd.client?.name, jd.salary_min,
    jd.experience_min, (jd.skills_must_have?.length || 0) > 0 ? true : null,
    jd.context, jd.languages?.length ? true : null,
  ];
  return Math.round((fields.filter(Boolean).length / fields.length) * 100);
}

/* ─── 3D Tilt Card ─── */
const TiltCard: React.FC<{
  children: React.ReactNode;
  className?: string;
  glowColor?: string;
  onClick?: () => void;
}> = ({ children, className, glowColor = 'var(--brutal-accent)', onClick }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [hovering, setHovering] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setMousePos({
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    });
  }, []);

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => { setHovering(false); setMousePos({ x: 50, y: 50 }); }}
      onClick={onClick}
      animate={{
        rotateX: hovering ? (mousePos.y - 50) * -0.15 : 0,
        rotateY: hovering ? (mousePos.x - 50) * 0.15 : 0,
      }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      style={{ transformStyle: 'preserve-3d', perspective: '1000px' }}
      className={cn(
        'relative group cursor-pointer transition-shadow duration-500',
        hovering && 'shadow-2xl',
        className,
      )}
    >
      {/* Spotlight glow */}
      <div
        className="absolute -inset-px pointer-events-none transition-opacity duration-500 z-0"
        style={{
          opacity: hovering ? 0.7 : 0,
          background: `radial-gradient(600px circle at ${mousePos.x}% ${mousePos.y}%, ${glowColor}20 0%, transparent 60%)`,
        }}
      />
      <div className="relative z-10">{children}</div>
    </motion.div>
  );
};

/* ─── Animated ring ─── */
const PulseRing: React.FC<{ color: string }> = ({ color }) => (
  <div className="relative">
    <motion.div
      className="absolute inset-0 rounded-full"
      style={{ border: `2px solid ${color}` }}
      animate={{ scale: [1, 1.6], opacity: [0.6, 0] }}
      transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
    />
    <motion.div
      className="absolute inset-0 rounded-full"
      style={{ border: `1px solid ${color}` }}
      animate={{ scale: [1, 2], opacity: [0.3, 0] }}
      transition={{ duration: 2, repeat: Infinity, ease: 'easeOut', delay: 0.5 }}
    />
  </div>
);

/* ─── Stat with animated bar ─── */
const AnimatedStat: React.FC<{
  value: number; label: string; icon: React.ComponentType<any>; accentColor: string; delay: number; max?: number;
}> = ({ value, label, icon: Icon, accentColor, delay, max = 100 }) => (
  <motion.div
    initial={{ opacity: 0, x: -20 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ delay, duration: 0.5, type: 'spring' }}
    className="group/stat"
  >
    <div className="flex items-center gap-3 mb-1.5">
      <div className={cn('w-8 h-8 flex items-center justify-center border', accentColor)}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-black tracking-tight text-foreground">
            <NumberTicker value={value} className="text-foreground" />
          </span>
          <span className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</span>
        </div>
      </div>
    </div>
    <div className="h-1 w-full bg-foreground/5 overflow-hidden ml-11">
      <motion.div
        className="h-full"
        style={{ backgroundColor: accentColor.includes('emerald') ? 'hsl(var(--accent))' : accentColor.includes('amber') ? 'hsl(var(--brutal-accent))' : 'hsl(var(--primary))' }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min((value / Math.max(max, 1)) * 100, 100)}%` }}
        transition={{ delay: delay + 0.3, duration: 0.8, ease: 'easeOut' }}
      />
    </div>
  </motion.div>
);

/* ─── Quick action card ─── */
const QuickAction: React.FC<{
  icon: React.ComponentType<any>;
  title: string;
  description: string;
  accentVar: string;
  onClick: () => void;
  delay: number;
}> = ({ icon: Icon, title, description, accentVar, onClick, delay }) => (
  <TiltCard glowColor={`hsl(${accentVar})`} onClick={onClick} className="h-full">
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5, type: 'spring' }}
      className="border border-foreground/10 bg-background p-5 h-full hover:border-foreground/30 transition-colors"
    >
      {/* Decorative corner */}
      <div className="absolute top-0 right-0 w-16 h-16 overflow-hidden pointer-events-none">
        <div className="absolute top-0 right-0 w-[1px] h-8 bg-gradient-to-b from-foreground/20 to-transparent" />
        <div className="absolute top-0 right-0 h-[1px] w-8 bg-gradient-to-l from-foreground/20 to-transparent" />
      </div>

      <div className="flex items-start gap-3">
        <div className="relative">
          <div className="w-10 h-10 flex items-center justify-center border border-foreground/20 bg-foreground/5">
            <Icon className="w-4 h-4 text-foreground" />
          </div>
          <PulseRing color="hsl(var(--foreground) / 0.1)" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-xs font-bold uppercase tracking-wider text-foreground mb-0.5">{title}</h3>
          <p className="text-[10px] text-muted-foreground leading-relaxed">{description}</p>
        </div>
        <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-1 transition-all shrink-0 mt-1" />
      </div>
    </motion.div>
  </TiltCard>
);

/* ═══════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════ */

export const MissionBentoDashboard: React.FC<MissionBentoDashboardProps> = ({ project, onTabChange }) => {
  const { data: candidates = [] } = useProjectCandidates(project.id);
  const { data: stats } = useProjectStats(project.id);
  const jd = (project.job_details || {}) as JobDetails;
  const briefPct = getBriefCompletion(project);

  const totalCandidates = stats?.total || candidates.length || 0;
  const messaged = stats?.messaged || 0;
  const shortlisted = stats?.shortlisted || 0;

  const pctColor = briefPct >= 70 ? 'text-accent' : briefPct >= 30 ? 'text-brutal-accent' : 'text-destructive';
  const barColor = briefPct >= 70 ? 'bg-accent' : briefPct >= 30 ? 'bg-brutal-accent' : 'bg-destructive';

  return (
    <div className="mt-4 space-y-3" style={{ perspective: '1200px' }}>
      {/* ── Row 1: Brief (2/3) + Stats (1/3) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Brief Card */}
        <TiltCard className="lg:col-span-2" glowColor="hsl(var(--brutal-accent))" onClick={() => onTabChange('brief')}>
          <div className="border border-foreground/15 bg-background overflow-hidden">
            {/* Header gradient */}
            <div className="h-1 w-full bg-gradient-to-r from-foreground/5 via-brutal-accent/30 to-foreground/5" />
            
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 bg-foreground flex items-center justify-center">
                    <FileText className="w-3.5 h-3.5 text-background" />
                  </div>
                  <div>
                    <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Brief Mission</h3>
                    <p className="text-[9px] text-muted-foreground/60">Cliquez pour compléter</p>
                  </div>
                </div>
                {/* Animated percentage */}
                <motion.div
                  className={cn('flex items-baseline gap-0.5 font-black', pctColor)}
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.3, type: 'spring', stiffness: 200 }}
                >
                  <NumberTicker value={briefPct} className={cn('text-2xl font-black', pctColor)} />
                  <span className="text-sm">%</span>
                </motion.div>
              </div>

              {/* Title */}
              <h2 className="text-lg font-bold text-foreground mb-1 group-hover:text-brutal-accent transition-colors truncate">
                {jd.title || project.name}
              </h2>
              <p className="text-xs text-muted-foreground line-clamp-2 mb-4">
                {jd.mission_description || jd.raw_brief || 'Complétez le brief pour commencer le sourcing'}
              </p>

              {/* Progress bar */}
              <div className="h-2 w-full bg-foreground/5 border border-foreground/10 overflow-hidden">
                <motion.div
                  className={cn('h-full', barColor)}
                  initial={{ width: 0 }}
                  animate={{ width: `${briefPct}%` }}
                  transition={{ duration: 1.2, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>

              {/* Skills tags */}
              {jd.skills_must_have && jd.skills_must_have.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-4">
                  {jd.skills_must_have.slice(0, 6).map((s, i) => (
                    <motion.span
                      key={i}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.6 + i * 0.1 }}
                      className="px-2.5 py-1 text-[9px] font-medium uppercase tracking-wider border border-foreground/20 text-foreground/70 bg-foreground/3 hover:border-foreground/40 hover:text-foreground transition-all"
                    >
                      {s}
                    </motion.span>
                  ))}
                  {jd.skills_must_have.length > 6 && (
                    <span className="px-2 py-1 text-[9px] text-muted-foreground">+{jd.skills_must_have.length - 6}</span>
                  )}
                </div>
              )}

              {/* CTA */}
              <motion.div
                className="flex items-center gap-1.5 mt-4 text-[10px] font-medium uppercase tracking-wider text-muted-foreground group-hover:text-brutal-accent transition-colors"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1 }}
              >
                <span>Éditer le brief</span>
                <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
              </motion.div>
            </div>
          </div>
        </TiltCard>

        {/* Stats Card */}
        <TiltCard glowColor="hsl(var(--foreground))" onClick={() => onTabChange('insights')}>
          <div className="border border-foreground/15 bg-background h-full">
            <div className="h-1 w-full bg-gradient-to-r from-foreground/5 via-foreground/15 to-foreground/5" />
            <div className="p-6 space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ChartBar className="w-4 h-4 text-muted-foreground" weight="duotone" />
                  <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    <TextRotate
                      texts={['Vue d\'ensemble', 'Métriques', 'Statistiques']}
                      interval={4000}
                      rotationType="blur"
                    />
                  </h3>
                </div>
                <Brain className="w-4 h-4 text-muted-foreground/30" weight="duotone" />
              </div>

              <AnimatedStat value={totalCandidates} label="Sourcés" icon={(p: any) => <Users {...p} weight="duotone" />} accentColor="text-primary border-primary/20 bg-primary/5" delay={0.2} max={50} />
              <AnimatedStat value={messaged} label="Contactés" icon={(p: any) => <PaperPlaneTilt {...p} weight="duotone" />} accentColor="text-accent border-accent/20 bg-accent/5" delay={0.4} max={totalCandidates || 10} />
              <AnimatedStat value={shortlisted} label="Shortlistés" icon={(p: any) => <Crosshair {...p} weight="duotone" />} accentColor="text-brutal-accent border-brutal-accent/20 bg-brutal-accent/5" delay={0.6} max={totalCandidates || 10} />
            </div>
          </div>
        </TiltCard>
      </div>

      {/* ── Row 2: Quick Actions ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <QuickAction
          icon={(p: any) => <Sparkle {...p} weight="duotone" />}
          title="Sourcing"
          description="Rechercher des profils avec l'IA et les filtres avancés"
          accentVar="var(--brutal-accent)"
          onClick={() => onTabChange('sourcing')}
          delay={0.3}
        />
        <QuickAction
          icon={(p: any) => <Lightning {...p} weight="fill" />}
          title="Outreach"
          description="Envoyer des messages personnalisés aux candidats"
          accentVar="var(--accent)"
          onClick={() => onTabChange('outreach')}
          delay={0.4}
        />
        <QuickAction
          icon={(p: any) => <TrendUp {...p} weight="duotone" />}
          title="Pipeline"
          description="Suivre et gérer l'avancement des candidats"
          accentVar="var(--primary)"
          onClick={() => onTabChange('pipeline')}
          delay={0.5}
        />
      </div>
    </div>
  );
};
