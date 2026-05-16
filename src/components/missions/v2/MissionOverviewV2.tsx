/**
 * MissionOverviewV2 — Vue d'ensemble enrichie (Phase 1 / "Vue").
 *
 * Remplace MissionBentoDashboard quand le flag mission_v2 est actif.
 *
 * Inspirée du design Claude "Mission Refonte v2" :
 *   ┌── Header : pills + title + meta (lieu, salaire, contrat) ──┐
 *   │                                                              │
 *   │  ┌── HERO NEXT-STEP CARD ────────────────────────────────┐ │
 *   │  │  [icon glow]  Étape suivante                          │ │
 *   │  │               Lancer le sourcing IA                   │ │
 *   │  │               ~340 profils correspondants détectés    │ │
 *   │  │                                          [CTA shine] │ │
 *   │  └────────────────────────────────────────────────────────┘ │
 *   │                                                              │
 *   │  ┌── Brief en bref ──────┐  ┌── Process recruteur ──────┐ │
 *   │  │ Stack: React, TS…    │  │ ① Screening · 30min       │ │
 *   │  │ XP: 5+ ans            │  │ ② Tech round · 60min      │ │
 *   │  │ Soft skills: …        │  │ ③ Culture fit · 45min     │ │
 *   │  │ Démarrage: T3 2026    │  │ ④ Offre · 48h             │ │
 *   │  └─────────────────────┘  └─────────────────────────────┘ │
 *   │                                                              │
 *   │  ┌── Funnel ───────────────────────────────────────────┐  │
 *   │  │ Sourcés  Contactés  Répondu  Entretien  Offre       │  │
 *   │  │   38       12         5         2         0          │  │
 *   │  └──────────────────────────────────────────────────────┘  │
 *   └──────────────────────────────────────────────────────────────┘
 */

import React, { useMemo } from 'react';
import { Sparkles, Search, Zap, ArrowRight, Building2, MapPin, Euro, Clock, FileText, Briefcase } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { useMissionReadiness } from '@/hooks/useMissionReadiness';
import type { JobDetails } from '@/types/jobDetails';
import { CONTRACT_TYPE_LABELS, REMOTE_LABELS } from '@/types/jobDetails';
import { Pill } from './Pill';

export interface MissionOverviewV2Props {
  project: SourcingProject;
  /** Callback pour naviguer vers un sous-tab (utilisé par les CTA). */
  onNavigateToSub: (sub: string) => void;
  /** Callback pour naviguer vers une phase entière (jump direct). */
  onNavigateToPhase?: (phase: 1 | 2 | 3) => void;
}

// ── Helpers ──

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 1) return "à l'instant";
    if (min < 60) return `il y a ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `il y a ${h}h`;
    const d = Math.floor(h / 24);
    if (d < 7) return `il y a ${d}j`;
    return `il y a ${Math.floor(d / 7)} sem`;
  } catch {
    return '';
  }
}

function formatSalary(jd: JobDetails): string | null {
  const min = jd.salary_min;
  const max = jd.salary_max;
  if (!min && !max) return null;
  const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`);
  if (min && max) return `${k(min)}–${k(max)}€`;
  if (min) return `dès ${k(min)}€`;
  if (max) return `jusqu'à ${k(max)}€`;
  return null;
}

// ── Hero Next-Step Card ──

interface NextStep {
  title: string;
  desc: string;
  cta: string;
  targetSub: string;
  icon: typeof Search;
  available: boolean;
}

function computeNextStep(
  project: SourcingProject,
  readiness: ReturnType<typeof useMissionReadiness>,
): NextStep {
  const briefStep = readiness.find(r => r.id === 'brief');
  const sourcingStep = readiness.find(r => r.id === 'sourcing');
  const outreachStep = readiness.find(r => r.id === 'outreach');
  const pipelineStep = readiness.find(r => r.id === 'pipeline');

  // Brief incomplet → on pousse à compléter
  if (briefStep && !briefStep.isComplete) {
    return {
      title: 'Compléter le brief',
      desc: `Brief rempli à ${briefStep.completionPercent}% — quelques champs critiques manquent pour générer un sourcing pertinent.`,
      cta: 'Continuer le brief',
      targetSub: 'brief',
      icon: FileText,
      available: true,
    };
  }
  // Brief OK mais pas de filtres → analyse IA
  if (briefStep?.nextAction?.label === "Analyser avec l'IA") {
    return {
      title: 'Analyser le brief avec l\'IA',
      desc: "Génère les filtres de recherche depuis ton brief. Tu pourras les valider avant de lancer le sourcing.",
      cta: 'Lancer l\'analyse IA',
      targetSub: 'brief',
      icon: Sparkles,
      available: true,
    };
  }
  // Filtres OK mais pas de candidats → sourcing
  if (sourcingStep && !sourcingStep.isComplete && sourcingStep.isReady) {
    return {
      title: 'Lancer le sourcing',
      desc: 'Ton brief est analysé et tes filtres sont prêts. Démarre la recherche pour identifier les profils correspondants.',
      cta: 'Démarrer le sourcing',
      targetSub: 'sourcing',
      icon: Search,
      available: true,
    };
  }
  // Candidats sourcés mais pas messagés → outreach
  if (outreachStep && !outreachStep.isComplete && outreachStep.isReady) {
    return {
      title: 'Contacter les meilleurs candidats',
      desc: `${project.stats_total_found || 0} candidats détectés. Crée ta séquence de messages pour engager les top profils.`,
      cta: 'Préparer l\'outreach',
      targetSub: 'outreach',
      icon: Zap,
      available: true,
    };
  }
  // Outreach lancé → pipeline
  if (pipelineStep) {
    return {
      title: 'Suivre les candidats dans le pipeline',
      desc: `${project.stats_messaged || 0} candidats contactés. Trie les réponses, qualifie et avance vers les entretiens.`,
      cta: 'Ouvrir le pipeline',
      targetSub: 'pipeline',
      icon: Briefcase,
      available: true,
    };
  }
  return {
    title: 'Mission en place',
    desc: 'Toutes les étapes principales sont configurées. Continue à suivre tes candidats.',
    cta: 'Voir le pipeline',
    targetSub: 'pipeline',
    icon: Briefcase,
    available: true,
  };
}

// ──────────────────────────────────────────────────────────────────

export const MissionOverviewV2: React.FC<MissionOverviewV2Props> = ({
  project,
  onNavigateToSub,
}) => {
  const readiness = useMissionReadiness(project);
  const jd = (project.job_details || {}) as JobDetails;

  const nextStep = useMemo(() => computeNextStep(project, readiness), [project, readiness]);
  const NextIcon = nextStep.icon;

  const created = formatRelativeTime(project.created_at);
  const hasFiltersSnapshot = !!(project.filters_snapshot && Object.keys(project.filters_snapshot).length > 0);

  // Stats funnel
  const stats = [
    { label: 'Sourcés', value: project.stats_total_found || 0 },
    { label: 'Contactés', value: project.stats_messaged || 0 },
    { label: 'Répondu', value: project.stats_replied || 0 },
    { label: 'Entretien', value: project.stats_qualified || 0 },
    { label: 'Offre', value: project.stats_hired || 0 },
  ];

  // Salaire formatté
  const salary = formatSalary(jd);
  const contract = jd.contract_type ? CONTRACT_TYPE_LABELS[jd.contract_type] : null;
  const remote = jd.remote_policy ? REMOTE_LABELS[jd.remote_policy] : null;

  // Skills must-have (top 4)
  const topSkills = (jd.skills_must_have || []).slice(0, 4);

  return (
    <div className="max-w-[920px] mx-auto pb-8">
      {/* ── Header : pills + titre + meta ── */}
      <div className="konekt-fade-up">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          {created && <Pill variant="muted">Créée {created}</Pill>}
          {hasFiltersSnapshot && (
            <Pill variant="ai" icon={Sparkles}>Brief structuré par IA</Pill>
          )}
        </div>
        <h1 className="font-display text-[28px] sm:text-[32px] font-bold leading-tight mb-1">
          {jd.title || project.name}
        </h1>
        <p className="text-[13px] text-muted-foreground inline-flex items-center gap-2 flex-wrap">
          {project.client_name && (
            <>
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5" /> {project.client_name}
              </span>
              <span className="text-muted-foreground/40">·</span>
            </>
          )}
          {jd.location && (
            <>
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" /> {jd.location}
                {remote && remote !== 'Sur site' && <span className="text-muted-foreground/70"> · {remote}</span>}
              </span>
              {salary && <span className="text-muted-foreground/40">·</span>}
            </>
          )}
          {salary && (
            <>
              <span className="inline-flex items-center gap-1.5">
                <Euro className="w-3.5 h-3.5" /> {salary}
              </span>
              {contract && <span className="text-muted-foreground/40">·</span>}
            </>
          )}
          {contract && <span>{contract}</span>}
        </p>
      </div>

      {/* ── HERO NEXT-STEP CARD ── */}
      <div
        className="rounded-xl p-5 my-5 relative overflow-hidden konekt-skalr-bg-soft konekt-glow konekt-fade-up"
        style={{
          border: '1px solid hsl(271 81% 56% / 0.35)',
          animationDelay: '60ms',
        }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 relative z-10">
          <div className="h-12 w-12 rounded-xl grid place-items-center flex-shrink-0 konekt-skalr-bg konekt-shine">
            <NextIcon className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <div className="flex-1 min-w-0">
            <p
              className="text-[10px] uppercase tracking-wider font-semibold mb-0.5"
              style={{ color: 'hsl(330 81% 75%)' }}
            >
              Étape suivante
            </p>
            <h3 className="font-display text-[18px] sm:text-[19px] font-bold leading-tight">
              {nextStep.title}
            </h3>
            <p className="text-[12px] text-muted-foreground mt-1 leading-snug">{nextStep.desc}</p>
          </div>
          <button
            type="button"
            onClick={() => onNavigateToSub(nextStep.targetSub)}
            disabled={!nextStep.available}
            className={cn(
              'h-10 px-5 rounded-full text-[13px] font-semibold text-white inline-flex items-center justify-center gap-1.5 flex-shrink-0 w-full sm:w-auto',
              'konekt-skalr-bg konekt-shine transition-transform active:scale-[0.97]',
              !nextStep.available && 'opacity-50 cursor-not-allowed',
            )}
          >
            <Zap className="w-3.5 h-3.5" strokeWidth={2.5} />
            <span>{nextStep.cta}</span>
            <ArrowRight className="w-3 h-3" strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* ── Brief en bref + Process recruteur ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4 konekt-fade-up" style={{ animationDelay: '120ms' }}>
        {/* Brief en bref */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Brief en bref
            </p>
            <button
              type="button"
              onClick={() => onNavigateToSub('brief')}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Modifier →
            </button>
          </div>
          <div className="space-y-2 text-[12.5px]">
            {topSkills.length > 0 && (
              <div className="flex gap-3">
                <span className="text-muted-foreground w-20 flex-shrink-0">Stack</span>
                <span className="font-medium">{topSkills.join(', ')}</span>
              </div>
            )}
            {(jd.experience_min || jd.experience_max) && (
              <div className="flex gap-3">
                <span className="text-muted-foreground w-20 flex-shrink-0">Expérience</span>
                <span className="font-medium">
                  {jd.experience_min && jd.experience_max
                    ? `${jd.experience_min}–${jd.experience_max} ans`
                    : jd.experience_min
                      ? `${jd.experience_min}+ ans`
                      : `≤ ${jd.experience_max} ans`}
                </span>
              </div>
            )}
            {jd.seniority && (
              <div className="flex gap-3">
                <span className="text-muted-foreground w-20 flex-shrink-0">Séniorité</span>
                <span className="font-medium">{jd.seniority}</span>
              </div>
            )}
            {jd.start_date && (
              <div className="flex gap-3">
                <span className="text-muted-foreground w-20 flex-shrink-0">Démarrage</span>
                <span className="font-medium">{jd.start_date}</span>
              </div>
            )}
            {topSkills.length === 0 && !jd.experience_min && !jd.seniority && (
              <p className="text-muted-foreground text-[12px] italic">
                Pas encore de détails — complète le brief pour les voir apparaître ici.
              </p>
            )}
          </div>
        </div>

        {/* Process recruteur */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Process recruteur
            </p>
            <button
              type="button"
              onClick={() => onNavigateToSub('process')}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Configurer →
            </button>
          </div>
          <ProcessSummary project={project} />
        </div>
      </div>

      {/* ── Funnel KPI ── */}
      <div className="bg-card border border-border rounded-xl p-4 konekt-fade-up" style={{ animationDelay: '180ms' }}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Funnel
          </p>
          {(project.stats_total_found || 0) === 0 ? (
            <Pill variant="muted">En attente du sourcing</Pill>
          ) : (project.stats_messaged || 0) === 0 ? (
            <Pill variant="info" pulse>Sourcing terminé · à contacter</Pill>
          ) : (
            <Pill variant="success" pulse>Outreach actif</Pill>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {stats.map(s => (
            <div
              key={s.label}
              className={cn(
                'text-center px-2 py-3 rounded-md border',
                s.value === 0
                  ? 'border-dashed border-border bg-background'
                  : 'border-border bg-card/50',
              )}
            >
              <p
                className={cn(
                  'font-display text-[20px] font-bold',
                  s.value === 0 ? 'text-muted-foreground/40' : 'text-foreground',
                )}
              >
                {s.value}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── Process summary (reads job_details.process_steps) ──────────────

const ProcessSummary: React.FC<{ project: SourcingProject }> = ({ project }) => {
  // process_steps peut être stocké dans job_details ou ailleurs — on tente les 2
  const jd = (project.job_details || {}) as JobDetails & { process_steps?: any[] };
  const steps = Array.isArray(jd.process_steps) ? jd.process_steps : [];

  if (steps.length === 0) {
    // Fallback : process par défaut
    const defaultSteps = [
      { label: 'Screening', detail: '30 min' },
      { label: 'Entretien tech', detail: '60 min' },
      { label: 'Culture fit', detail: '45 min' },
      { label: 'Offre', detail: 'sous 48h' },
    ];
    return (
      <div>
        <div className="space-y-1.5">
          {defaultSteps.map((s, i) => (
            <div key={i} className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-muted/40">
              <span className="h-5 w-5 rounded-full bg-muted text-[10px] font-bold grid place-items-center text-muted-foreground flex-shrink-0">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium leading-tight">{s.label}</p>
                <p className="text-[10.5px] text-muted-foreground leading-tight">{s.detail}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground italic mt-2 pt-2 border-t border-border">
          Process par défaut — personnalise dans l'onglet Process.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {steps.slice(0, 5).map((s: any, i: number) => (
        <div key={i} className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-muted/40">
          <span className="h-5 w-5 rounded-full bg-muted text-[10px] font-bold grid place-items-center text-muted-foreground flex-shrink-0">
            {i + 1}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-medium leading-tight truncate">
              {s.label || s.title || `Étape ${i + 1}`}
            </p>
            {(s.duration || s.detail) && (
              <p className="text-[10.5px] text-muted-foreground leading-tight truncate">
                {s.duration || s.detail}
              </p>
            )}
          </div>
        </div>
      ))}
      {steps.length > 5 && (
        <p className="text-[10px] text-muted-foreground italic mt-1">
          +{steps.length - 5} autre(s) étape(s)
        </p>
      )}
    </div>
  );
};
