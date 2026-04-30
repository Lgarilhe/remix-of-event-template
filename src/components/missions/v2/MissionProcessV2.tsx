/**
 * MissionProcessV2 — Process d'entretien refondu (cohérent avec brief V2).
 *
 * Layout aligné à gauche, 2 colonnes : form + sidebar sticky.
 * Sections en cards rounded-xl avec emoji + Outfit display.
 *
 * Réutilise toute la logique métier de MissionProcess :
 *   - useMissionProcess (CRUD steps + team)
 *   - StepCard (drag-drop + format/provider/adresse)
 *   - MissionTeamSection (équipe + invitations)
 *   - PROCESS_TEMPLATES (5 templates : fast/standard/senior/executive)
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Sparkles, Loader2, Clock, Zap, Target, Users, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useMissionProcess } from '@/hooks/useMissionProcess';
import { useOrganizationMembers } from '@/hooks/useOrganization';
import type { SourcingProject } from '@/hooks/useSourcingProjects';
import type { JobDetails } from '@/types/jobDetails';
import { StepCard, MissionTeamSection, PROCESS_TEMPLATES } from '../MissionProcess';
import { Pill } from './Pill';

interface MissionProcessV2Props {
  project: SourcingProject;
  readOnly?: boolean;
}

// ──────────────────────────────────────────────────────────────────

export const MissionProcessV2: React.FC<MissionProcessV2Props> = ({ project, readOnly = false }) => {
  const {
    steps, team, loadingSteps, loadingTeam,
    addStep, updateStep, deleteStep, reorderSteps,
    initializeDefaultSteps, initializeFromTemplate,
    addTeamMember, removeTeamMember, isAdding,
  } = useMissionProcess(project.id);

  const { members: orgMembers } = useOrganizationMembers(project.organization_id);
  const { data: memberProfiles = [] } = useQuery({
    queryKey: ['member-profiles-mission-v2', orgMembers.map(m => m.user_id)],
    queryFn: async () => {
      if (orgMembers.length === 0) return [];
      const { data } = await supabase
        .from('profiles')
        .select('user_id, display_name, recruiter_headline')
        .in('user_id', orgMembers.map(m => m.user_id));
      return data || [];
    },
    enabled: orgMembers.length > 0,
    staleTime: 10 * 60 * 1000,
  });

  const getMemberName = (userId: string) => {
    const profile = memberProfiles.find((p: any) => p.user_id === userId);
    return profile?.display_name || userId.slice(0, 8) + '...';
  };

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [addingStep, setAddingStep] = useState(false);
  const [newStepName, setNewStepName] = useState('');
  const [suggestingAI, setSuggestingAI] = useState(false);

  // AI suggestion based on job details (rule-based)
  const handleAISuggestion = async () => {
    const jd = (project.job_details || {}) as JobDetails;
    const seniority = jd.seniority?.toLowerCase() || '';
    const manages = jd.manages || 0;

    let templateKey: keyof typeof PROCESS_TEMPLATES = 'standard';
    if (seniority.includes('junior') || seniority.includes('stage') || seniority.includes('alternance')) {
      templateKey = 'fast';
    } else if (seniority.includes('lead') || seniority.includes('senior') || seniority.includes('principal')) {
      templateKey = 'senior';
    } else if (
      seniority.includes('director') || seniority.includes('vp') ||
      seniority.includes('c-level') || seniority.includes('head') || manages > 5
    ) {
      templateKey = 'executive';
    }

    setSuggestingAI(true);
    try {
      await initializeFromTemplate(PROCESS_TEMPLATES[templateKey].steps);
      toast.success(`Process "${PROCESS_TEMPLATES[templateKey].label}" suggéré par l'IA`);
    } finally {
      setSuggestingAI(false);
    }
  };

  const handleDragEnd = () => {
    if (dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex) {
      const reordered = [...steps];
      const [moved] = reordered.splice(dragIndex, 1);
      reordered.splice(dragOverIndex, 0, moved);
      reorderSteps(reordered.map(s => s.id));
    }
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleAddStep = async () => {
    const name = newStepName.trim();
    if (!name) return;
    await addStep({ name });
    setNewStepName('');
    setAddingStep(false);
  };

  const totalDuration = steps.reduce((sum, s) => sum + s.duration_minutes, 0);
  const eliminatoryCount = steps.filter(s => s.is_eliminatory).length;
  const hasSteps = steps.length > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6 pb-8">
      {/* Form principal */}
      <div className="min-w-0">
        {/* Header */}
        <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
              Étape 1 · Cadrage
            </p>
            <h2 className="font-display text-[24px] font-bold leading-tight">
              Process d'entretien
            </h2>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Définis les étapes d'évaluation. L'IA adaptera le scoring et les scorecards en fonction.
            </p>
          </div>
          {!readOnly && hasSteps && (
            <button
              type="button"
              onClick={handleAISuggestion}
              disabled={suggestingAI}
              className="h-9 px-4 inline-flex items-center gap-1.5 rounded-full text-[12px] font-semibold text-white konekt-skalr-bg konekt-shine transition-transform active:scale-[0.97] disabled:opacity-50"
            >
              {suggestingAI ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" strokeWidth={2.5} />}
              Réoptimiser avec l'IA
            </button>
          )}
        </div>

        {readOnly && (
          <div className="mb-4 px-4 py-3 rounded-lg border border-border bg-muted/30 inline-flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              👁️ Lecture seule — le process est défini par le lead recruteur
            </span>
          </div>
        )}

        {/* Section : Étapes du process */}
        <SectionCard
          emoji="🎯"
          title="Étapes du process"
          subtitle={hasSteps ? `${steps.length} étape${steps.length > 1 ? 's' : ''} · glisse pour réordonner` : 'Aucune étape définie'}
        >
          {loadingSteps ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : !hasSteps ? (
            <EmptyProcessState
              readOnly={readOnly}
              isAdding={isAdding}
              suggestingAI={suggestingAI}
              onAISuggestion={handleAISuggestion}
              onTemplate={(key) => initializeFromTemplate(PROCESS_TEMPLATES[key].steps)}
            />
          ) : (
            <div className="relative">
              {/* Vertical connector line */}
              <div className="absolute left-[30px] top-7 bottom-7 w-px bg-border" />

              <div className="relative space-y-2">
                {/* Bullet "Candidat soumis" — début de la timeline */}
                <div className="flex items-center gap-3 px-2 py-1.5 relative z-10">
                  <div className="flex items-center justify-center w-7 h-7 rounded-full bg-muted border border-border text-muted-foreground text-xs flex-shrink-0">
                    →
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">Candidat soumis</span>
                </div>

                {/* Étapes draggables */}
                {steps.map((step, index) => (
                  <div key={step.id} className="relative z-10 ml-0">
                    <StepCard
                      step={step}
                      index={index}
                      onUpdate={updateStep}
                      onDelete={deleteStep}
                      onDragStart={setDragIndex}
                      onDragOver={setDragOverIndex}
                      onDragEnd={handleDragEnd}
                      isDragging={dragIndex === index}
                      isDragTarget={dragOverIndex === index}
                    />
                  </div>
                ))}

                {/* Bullet "Embauché" — fin de la timeline */}
                <div className="flex items-center gap-3 px-2 py-1.5 relative z-10">
                  <div
                    className="flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium flex-shrink-0"
                    style={{
                      background: 'hsl(var(--status-success-muted))',
                      color: 'hsl(var(--status-success))',
                      border: '1px solid hsl(var(--status-success) / 0.4)',
                    }}
                  >
                    ✓
                  </div>
                  <span className="text-xs font-medium" style={{ color: 'hsl(var(--status-success))' }}>
                    Embauché
                  </span>
                </div>
              </div>

              {/* Bouton add step */}
              {!readOnly && (
                <div className="mt-3">
                  {addingStep ? (
                    <div className="flex items-center gap-2 konekt-fade-up">
                      <input
                        value={newStepName}
                        onChange={(e) => setNewStepName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleAddStep();
                          if (e.key === 'Escape') { setAddingStep(false); setNewStepName(''); }
                        }}
                        autoFocus
                        placeholder="Nom de l'étape..."
                        className="flex-1 h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                      />
                      <button
                        onClick={handleAddStep}
                        disabled={!newStepName.trim()}
                        className="h-9 px-4 rounded-md text-[12px] font-semibold bg-foreground text-background disabled:opacity-50"
                      >
                        Ajouter
                      </button>
                      <button
                        onClick={() => { setAddingStep(false); setNewStepName(''); }}
                        className="h-9 px-3 rounded-md text-[12px] text-muted-foreground hover:text-foreground border border-border"
                      >
                        Annuler
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddingStep(true)}
                      className="w-full h-9 rounded-md border border-dashed border-border text-[12px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground inline-flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Ajouter une étape
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </SectionCard>

        {/* Section : Équipe mission (réutilise le composant existant) */}
        <div className="mt-4">
          <SectionCard
            emoji="👥"
            title="Équipe mission"
            subtitle="Recruteurs internes + invitations externes"
          >
            <MissionTeamSection
              team={team}
              loadingTeam={loadingTeam}
              readOnly={readOnly}
              getMemberName={getMemberName}
              orgMembers={orgMembers}
              projectId={project.id}
              projectName={project.name}
              onAdd={addTeamMember}
              onRemove={removeTeamMember}
            />
          </SectionCard>
        </div>
      </div>

      {/* Sidebar */}
      <aside className="lg:sticky lg:top-4 lg:self-start space-y-3">
        {/* État du process */}
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">
            État du process
          </p>

          <div className="space-y-3">
            <KpiRow icon={<Target className="w-3.5 h-3.5" />} label="Étapes" value={steps.length} />
            <KpiRow
              icon={<Clock className="w-3.5 h-3.5" />}
              label="Durée totale"
              value={`${totalDuration}`}
              suffix="min"
            />
            <KpiRow
              icon={<Zap className="w-3.5 h-3.5" />}
              label="Éliminatoires"
              value={eliminatoryCount}
              highlight={eliminatoryCount > 0 ? 'warning' : undefined}
            />
            <KpiRow
              icon={<Users className="w-3.5 h-3.5" />}
              label="Membres équipe"
              value={team.length}
            />
          </div>
        </div>

        {/* Status pill */}
        {hasSteps && (
          <div className="bg-card border border-border rounded-lg p-3">
            <Pill variant="success" pulse>Process configuré</Pill>
          </div>
        )}

        {/* Tips */}
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            💡 Conseil
          </p>
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            {!hasSteps ? (
              <>Choisis un template adapté ou laisse l'IA proposer un process basé sur la séniorité du poste.</>
            ) : eliminatoryCount === 0 ? (
              <>Marquer une étape comme <strong className="text-foreground">éliminatoire</strong> permet de filtrer les candidats automatiquement avant l'étape suivante.</>
            ) : (
              <>Le format <strong className="text-foreground">visio (Teams/Zoom/Meet)</strong> génère automatiquement un lien meeting dans l'invitation calendar du candidat.</>
            )}
          </p>
        </div>
      </aside>
    </div>
  );
};

// ─── Sub-components ───────────────────────────────────────────────

const SectionCard: React.FC<{
  emoji: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}> = ({ emoji, title, subtitle, children }) => (
  <div className="bg-card border border-border rounded-xl overflow-hidden">
    <div className="px-5 py-3 border-b border-border flex items-center gap-3">
      <span className="text-base">{emoji}</span>
      <div>
        <h3 className="font-display text-[14px] font-bold leading-tight">{title}</h3>
        {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
    </div>
    <div className="p-5">{children}</div>
  </div>
);

const KpiRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string | number;
  suffix?: string;
  highlight?: 'warning' | 'success';
}> = ({ icon, label, value, suffix, highlight }) => {
  const color =
    highlight === 'warning' ? 'hsl(var(--status-warning))'
    : highlight === 'success' ? 'hsl(var(--status-success))'
    : undefined;

  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-[11px] text-muted-foreground flex-1">{label}</span>
      <span
        className="font-display font-bold tabular-nums text-[15px] leading-none"
        style={color ? { color } : undefined}
      >
        {value}
        {suffix && <span className="text-[10px] font-normal text-muted-foreground ml-0.5">{suffix}</span>}
      </span>
    </div>
  );
};

interface EmptyProcessStateProps {
  readOnly: boolean;
  isAdding: boolean;
  suggestingAI: boolean;
  onAISuggestion: () => void;
  onTemplate: (key: string) => void;
}

const EmptyProcessState: React.FC<EmptyProcessStateProps> = ({
  readOnly, isAdding, suggestingAI, onAISuggestion, onTemplate,
}) => (
  <div className="text-center py-6 konekt-fade-up">
    <div className="text-3xl mb-3">🏗️</div>
    <h4 className="font-display text-[15px] font-bold mb-1">
      {readOnly ? 'Aucune étape définie' : 'Configure ton process'}
    </h4>
    <p className="text-[12px] text-muted-foreground mb-5 max-w-sm mx-auto">
      {readOnly
        ? 'Aucune étape définie pour cette mission.'
        : 'Choisis un template adapté ou laisse l\'IA proposer un process basé sur le brief.'}
    </p>

    {!readOnly && (
      <div className="space-y-3 max-w-md mx-auto">
        {/* AI suggestion */}
        <button
          onClick={onAISuggestion}
          disabled={isAdding || suggestingAI}
          className="w-full h-10 rounded-full inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold text-white konekt-skalr-bg konekt-shine transition-transform active:scale-[0.97] disabled:opacity-50"
        >
          {suggestingAI ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Analyse du brief…</>
          ) : (
            <><Sparkles className="w-3.5 h-3.5" strokeWidth={2.5} /> Suggestion IA basée sur le brief</>
          )}
        </button>

        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold pt-2">
          Ou choisis un template
        </p>

        {/* Templates grid */}
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(PROCESS_TEMPLATES).map(([key, tpl]) => (
            <button
              key={key}
              onClick={() => onTemplate(key)}
              disabled={isAdding}
              className="text-left bg-background border border-border rounded-lg p-3 hover:border-foreground/30 hover:bg-card transition-all disabled:opacity-50"
            >
              <p className="text-[12px] font-semibold mb-0.5">{tpl.label}</p>
              <p className="text-[10.5px] text-muted-foreground leading-tight">{tpl.description}</p>
              <div className="mt-2 inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                <ChevronRight className="w-2.5 h-2.5" />
                {tpl.steps.length} étapes
              </div>
            </button>
          ))}
        </div>
      </div>
    )}
  </div>
);
