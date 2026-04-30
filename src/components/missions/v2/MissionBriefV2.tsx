/**
 * MissionBriefV2 — Brief de mission inline, cohérent avec la DA v2.
 *
 * Différences avec MissionBrief (v1) :
 *   - Pas de wizard plein écran modal — TOUT est inline dans le tab
 *   - 5 sections empilées (Poste / Client / Profil / Compétences / Évaluation)
 *   - Layout 2 colonnes : form à gauche / panneau complétion à droite
 *   - Auto-save 800ms avec indicator persistant
 *   - Bouton "Analyser avec l'IA" en gradient Skalr
 *   - Tags add/remove en pills cohérents avec le reste
 *
 * Réutilise toute la logique métier de MissionBrief (auto-save, analyse IA,
 * FilterReviewModal). Aucun changement de data model.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Sparkles, Loader2, Mic, Plus, X, Check, Cloud, CloudUpload, AlertCircle,
  Briefcase, Building2, User, Zap, Target, Euro, MapPin, Calendar, Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useSourcingProjects, SourcingProject } from '@/hooks/useSourcingProjects';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { deepMerge } from '@/lib/deepMerge';
import { FilterReviewModal } from '../FilterReviewModal';
import { VoiceDictation } from '../VoiceDictation';
import type { JobDetails } from '@/types/jobDetails';
import { CONTRACT_TYPE_LABELS, REMOTE_LABELS, SIZE_LABELS } from '@/types/jobDetails';
import { Pill } from './Pill';

interface MissionBriefV2Props {
  project: SourcingProject;
  readOnly?: boolean;
}

interface AnalysisResult {
  filters: any;
  analysis: any;
}

// ────────────────────────────────────────────────────────────────────

export const MissionBriefV2: React.FC<MissionBriefV2Props> = ({ project, readOnly = false }) => {
  const [, setSearchParams] = useSearchParams();
  const { updateProject } = useSourcingProjects();

  const [showVoice, setShowVoice] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [showFilterReview, setShowFilterReview] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-save logic (debounced 800ms) — same as v1
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatchRef = useRef<Partial<JobDetails>>({});
  const latestRef = useRef<JobDetails>(project.job_details || {});
  latestRef.current = project.job_details || {};

  const [tick, setTick] = useState(0); // forces re-render on local edit
  const jd = deepMerge(latestRef.current, pendingPatchRef.current) as JobDetails;

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
    };
  }, []);

  const updateField = useCallback((patch: Partial<JobDetails>) => {
    if (readOnly) return;
    pendingPatchRef.current = deepMerge(pendingPatchRef.current, patch);
    setTick(t => t + 1);
    setSaveStatus('saving');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const merged = deepMerge(latestRef.current, pendingPatchRef.current);
      updateProject({ id: project.id, job_details: merged } as any).then(
        () => {
          pendingPatchRef.current = {};
          setSaveStatus('saved');
          if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
          saveStatusTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2500);
        },
        () => setSaveStatus('error'),
      );
    }, 800);
  }, [project.id, updateProject, readOnly]);

  const handleAnalyze = async () => {
    const descText = jd.mission_description || jd.raw_brief || jd.context || '';
    if (descText.trim().length < 20 && !jd.title) {
      toast.error('Renseigne au moins le titre ou la description pour analyser');
      return;
    }
    setIsAnalyzing(true);
    try {
      const response = await invokeWithCredits('generate-search-filters', 'filter_generation', {
        job: {
          id: project.id,
          title: jd.title || project.name,
          description: [jd.mission_description, jd.context, jd.raw_brief].filter(Boolean).join('\n\n'),
          client: jd.client?.name ? { name: jd.client.name, sector: jd.client.sector } : (project.client_name ? { name: project.client_name } : null),
          location: jd.location || null,
          skills: [...(jd.skills_must_have || []), ...(jd.skills_should_have || [])],
          seniority: jd.seniority || null,
          xpMin: jd.experience_min,
          xpMax: jd.experience_max,
        },
      });
      if (response.error) throw new Error(response.error.message || 'Erreur IA');
      if (!response.data?.success) throw new Error('Analyse échouée');
      setAnalysis({ filters: response.data.filters, analysis: response.data.analysis });
      setShowFilterReview(true);
    } catch (err: any) {
      toast.error(err.message || "Erreur lors de l'analyse");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAcceptFilters = async (updatedFilters: any) => {
    try {
      await updateProject({
        id: project.id,
        filters_snapshot: { ...updatedFilters, generated_at: new Date().toISOString() },
      } as any);
      setShowFilterReview(false);
      toast.success('Filtres sauvegardés — direction sourcing');
      setSearchParams(prev => { const n = new URLSearchParams(prev); n.set('tab', 'sourcing'); return n; }, { replace: true });
    } catch {
      toast.error('Erreur lors de la sauvegarde');
    }
  };

  // Completion score
  const completion = computeCompletion(jd);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6 pb-8">
      <div className="min-w-0">
        {/* Header avec actions */}
        <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
              Étape 1 · Cadrage
            </p>
            <h2 className="font-display text-[24px] font-bold leading-tight">Brief de mission</h2>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Plus le brief est précis, meilleur sera le sourcing et le scoring des candidats.
            </p>
          </div>
          {!readOnly && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => setShowVoice(s => !s)}
                className={cn(
                  'h-9 px-3 inline-flex items-center gap-1.5 rounded-full text-[12px] font-medium border transition-colors',
                  showVoice
                    ? 'bg-foreground text-background border-foreground'
                    : 'border-border hover:bg-accent',
                )}
                title="Dicter à voix haute"
              >
                <Mic className="w-3.5 h-3.5" />
                Dicter
              </button>
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={isAnalyzing || completion.percent < 20}
                className="h-9 px-4 inline-flex items-center gap-1.5 rounded-full text-[12px] font-semibold text-white konekt-skalr-bg konekt-shine transition-transform active:scale-[0.97] disabled:opacity-50"
                title={completion.percent < 20 ? 'Remplis au moins le titre + description' : 'Lance l\'analyse IA'}
              >
                {isAnalyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" strokeWidth={2.5} />}
                Analyser avec l'IA
              </button>
            </div>
          )}
        </div>

        {/* Voice dictation panel */}
        {showVoice && !readOnly && (
          <div className="mb-5 bg-card border border-border rounded-xl p-4 konekt-fade-up">
            <div className="flex items-center gap-2 mb-3">
              <Mic className="w-4 h-4 text-muted-foreground" />
              <p className="text-[12px] font-semibold">Dictée vocale</p>
              <button onClick={() => setShowVoice(false)} className="ml-auto h-7 w-7 grid place-items-center rounded-md hover:bg-accent text-muted-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <VoiceDictation
              onTranscript={(chunk) => setVoiceTranscript(prev => (prev ? prev + ' ' : '') + chunk)}
              onComplete={(fullText) => {
                updateField({ voice_transcript: fullText, raw_brief: fullText, brief_source: 'voice' });
                toast.success('Dictée enregistrée');
              }}
            />
            {voiceTranscript && (
              <div className="mt-3 border border-border rounded-md p-3 max-h-[150px] overflow-y-auto bg-background">
                <p className="text-[12px] leading-relaxed whitespace-pre-wrap">{voiceTranscript}</p>
              </div>
            )}
          </div>
        )}

        {/* Sections */}
        <div className="space-y-4">
          <SectionPoste jd={jd} updateField={updateField} readOnly={readOnly} />
          <SectionClient jd={jd} updateField={updateField} readOnly={readOnly} />
          <SectionProfil jd={jd} updateField={updateField} readOnly={readOnly} />
          <SectionCompetences jd={jd} updateField={updateField} readOnly={readOnly} />
          <SectionMission jd={jd} updateField={updateField} readOnly={readOnly} />
        </div>
      </div>

      {/* Sidebar : completion + tips */}
      <aside className="lg:sticky lg:top-4 lg:self-start space-y-3">
        {/* Save indicator */}
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="flex items-center gap-2">
            {saveStatus === 'saving' && (
              <>
                <CloudUpload className="w-3.5 h-3.5 text-info animate-pulse" />
                <span className="text-[11px] text-muted-foreground">Enregistrement…</span>
              </>
            )}
            {saveStatus === 'saved' && (
              <>
                <Check className="w-3.5 h-3.5" style={{ color: 'hsl(var(--status-success))' }} />
                <span className="text-[11px]" style={{ color: 'hsl(var(--status-success))' }}>Enregistré</span>
              </>
            )}
            {saveStatus === 'idle' && (
              <>
                <Cloud className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground">Auto-sauvegarde activée</span>
              </>
            )}
            {saveStatus === 'error' && (
              <>
                <AlertCircle className="w-3.5 h-3.5 text-destructive" />
                <span className="text-[11px] text-destructive">Erreur de sauvegarde</span>
              </>
            )}
          </div>
        </div>

        {/* Completion */}
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">
            État du brief
          </p>
          <div className="flex items-center gap-3 mb-3">
            <div className="relative h-14 w-14 flex-shrink-0">
              <svg className="h-14 w-14 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="16" fill="none" stroke="hsl(var(--border))" strokeWidth="3" />
                <circle
                  cx="18"
                  cy="18"
                  r="16"
                  fill="none"
                  stroke={completion.percent >= 60 ? 'hsl(var(--status-success))' : 'hsl(var(--status-info))'}
                  strokeWidth="3"
                  strokeDasharray="100"
                  strokeDashoffset={100 - completion.percent}
                  className="transition-all duration-500"
                />
              </svg>
              <div className="absolute inset-0 grid place-items-center">
                <span className="font-display text-[13px] font-bold">{completion.percent}%</span>
              </div>
            </div>
            <div className="min-w-0">
              <p className="text-[12px] font-semibold">
                {completion.filled}/{completion.total} champs
              </p>
              <p className="text-[10.5px] text-muted-foreground">
                {completion.percent >= 60 ? 'Prêt à analyser' : 'À compléter'}
              </p>
            </div>
          </div>

          {completion.criticalMissing.length > 0 && (
            <div className="border-t border-border pt-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-warning mb-1.5">
                Critique
              </p>
              <ul className="space-y-1 text-[11px]">
                {completion.criticalMissing.map(m => (
                  <li key={m} className="inline-flex items-center gap-1.5">
                    <span className="h-1 w-1 rounded-full bg-warning" />
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Tips */}
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            💡 Conseil
          </p>
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            Les <strong className="text-foreground">compétences must-have</strong> et la <strong className="text-foreground">description de mission</strong> sont les fields les plus impactants pour le scoring IA des candidats.
          </p>
        </div>
      </aside>

      {/* Filter review modal */}
      {showFilterReview && analysis && (
        <FilterReviewModal
          isOpen={showFilterReview}
          analysis={analysis}
          onClose={() => setShowFilterReview(false)}
          onAccept={handleAcceptFilters}
        />
      )}
    </div>
  );
};

// ─── Reusable Section Card ──────────────────────────────────────────

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
    <div className="p-5 space-y-3">{children}</div>
  </div>
);

// ─── Reusable Field components ──────────────────────────────────────

const FieldLabel: React.FC<{ children: React.ReactNode; required?: boolean }> = ({ children, required }) => (
  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
    {children}
    {required && <span className="text-destructive ml-0.5">*</span>}
  </label>
);

const TextInput: React.FC<{
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  type?: string;
}> = ({ value, onChange, placeholder, readOnly, type = 'text' }) => (
  <input
    type={type}
    value={value || ''}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    readOnly={readOnly}
    className={cn(
      'w-full h-9 px-3 rounded-md border border-border bg-background text-sm',
      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
      readOnly && 'bg-muted/30 cursor-not-allowed',
    )}
  />
);

const TextArea: React.FC<{
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  readOnly?: boolean;
}> = ({ value, onChange, placeholder, rows = 4, readOnly }) => (
  <textarea
    value={value || ''}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    rows={rows}
    readOnly={readOnly}
    className={cn(
      'w-full px-3 py-2 rounded-md border border-border bg-background text-sm leading-relaxed resize-none',
      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
      readOnly && 'bg-muted/30 cursor-not-allowed',
    )}
  />
);

const Select: React.FC<{
  value: string | undefined;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  readOnly?: boolean;
}> = ({ value, onChange, options, placeholder = '—', readOnly }) => (
  <select
    value={value || ''}
    onChange={(e) => onChange(e.target.value)}
    disabled={readOnly}
    className={cn(
      'w-full h-9 px-3 rounded-md border border-border bg-background text-sm',
      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
      readOnly && 'bg-muted/30 cursor-not-allowed',
    )}
  >
    <option value="">{placeholder}</option>
    {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);

const TagsInput: React.FC<{
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  readOnly?: boolean;
  variant?: 'must' | 'should' | 'nice';
}> = ({ values, onChange, placeholder, readOnly, variant = 'must' }) => {
  const [input, setInput] = useState('');
  const colors = {
    must: { bg: 'hsl(var(--status-warning-muted))', color: 'hsl(var(--status-warning))' },
    should: { bg: 'hsl(var(--status-info-muted))', color: 'hsl(var(--status-info))' },
    nice: { bg: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' },
  }[variant];

  const add = () => {
    const t = input.trim();
    if (!t || values.includes(t)) { setInput(''); return; }
    onChange([...values, t]);
    setInput('');
  };
  const remove = (t: string) => onChange(values.filter(v => v !== t));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {values.map(t => (
        <span
          key={t}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11.5px] font-medium"
          style={{ background: colors.bg, color: colors.color }}
        >
          {t}
          {!readOnly && (
            <button
              onClick={() => remove(t)}
              className="hover:opacity-70 transition-opacity"
              aria-label={`Retirer ${t}`}
            >
              <X className="w-2.5 h-2.5" />
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <div className="flex items-center gap-1">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); add(); }
              if (e.key === 'Backspace' && !input && values.length) onChange(values.slice(0, -1));
            }}
            onBlur={() => input.trim() && add()}
            placeholder={placeholder}
            className="h-7 w-44 px-2 text-[12px] border border-dashed border-border bg-transparent rounded-md focus:outline-none focus:border-foreground/50"
          />
          {input.trim() && (
            <button onClick={add} className="text-muted-foreground hover:text-foreground" aria-label="Ajouter">
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Sections ────────────────────────────────────────────────────────

const SectionPoste: React.FC<{ jd: JobDetails; updateField: (p: Partial<JobDetails>) => void; readOnly?: boolean }> = ({ jd, updateField, readOnly }) => (
  <SectionCard emoji="📍" title="Le poste" subtitle="Informations de base">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <FieldLabel required>Titre du poste</FieldLabel>
        <TextInput value={jd.title} onChange={v => updateField({ title: v })} placeholder="Ex: Senior React Engineer" readOnly={readOnly} />
      </div>
      <div>
        <FieldLabel>Type de contrat</FieldLabel>
        <Select
          value={jd.contract_type}
          onChange={v => updateField({ contract_type: (v || undefined) as any })}
          options={Object.entries(CONTRACT_TYPE_LABELS).map(([k, label]) => ({ value: k, label }))}
          readOnly={readOnly}
        />
      </div>
      <div>
        <FieldLabel>Localisation</FieldLabel>
        <TextInput value={jd.location} onChange={v => updateField({ location: v })} placeholder="Ex: Paris" readOnly={readOnly} />
      </div>
      <div>
        <FieldLabel>Politique télétravail</FieldLabel>
        <Select
          value={jd.remote_policy}
          onChange={v => updateField({ remote_policy: (v || undefined) as any })}
          options={Object.entries(REMOTE_LABELS).map(([k, label]) => ({ value: k, label }))}
          readOnly={readOnly}
        />
      </div>
      <div>
        <FieldLabel>Date de démarrage</FieldLabel>
        <TextInput value={jd.start_date} onChange={v => updateField({ start_date: v })} placeholder="Ex: ASAP, T3 2026" readOnly={readOnly} />
      </div>
      <div>
        <FieldLabel>Jours de remote/sem.</FieldLabel>
        <TextInput
          type="number"
          value={typeof jd.remote_days === 'number' ? String(jd.remote_days) : ''}
          onChange={v => updateField({ remote_days: v ? Number(v) : undefined })}
          placeholder="0-5"
          readOnly={readOnly}
        />
      </div>
    </div>
  </SectionCard>
);

const SectionClient: React.FC<{ jd: JobDetails; updateField: (p: Partial<JobDetails>) => void; readOnly?: boolean }> = ({ jd, updateField, readOnly }) => (
  <SectionCard emoji="🏢" title="Le client" subtitle="L'entreprise qui recrute">
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div>
        <FieldLabel>Nom</FieldLabel>
        <TextInput value={jd.client?.name} onChange={v => updateField({ client: { ...jd.client, name: v } })} placeholder="Ex: Doctolib" readOnly={readOnly} />
      </div>
      <div>
        <FieldLabel>Secteur</FieldLabel>
        <TextInput value={jd.client?.sector} onChange={v => updateField({ client: { ...jd.client, sector: v } })} placeholder="Ex: HealthTech" readOnly={readOnly} />
      </div>
      <div>
        <FieldLabel>Taille</FieldLabel>
        <Select
          value={jd.client?.size}
          onChange={v => updateField({ client: { ...jd.client, size: (v || undefined) as any } })}
          options={Object.entries(SIZE_LABELS).map(([k, label]) => ({ value: k, label }))}
          readOnly={readOnly}
        />
      </div>
    </div>
  </SectionCard>
);

const SectionProfil: React.FC<{ jd: JobDetails; updateField: (p: Partial<JobDetails>) => void; readOnly?: boolean }> = ({ jd, updateField, readOnly }) => (
  <SectionCard emoji="👤" title="Le profil recherché" subtitle="Séniorité, expérience, salaire">
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div>
        <FieldLabel>Séniorité</FieldLabel>
        <TextInput value={jd.seniority} onChange={v => updateField({ seniority: v })} placeholder="Ex: Senior, Lead" readOnly={readOnly} />
      </div>
      <div>
        <FieldLabel>Expérience min (ans)</FieldLabel>
        <TextInput
          type="number"
          value={typeof jd.experience_min === 'number' ? String(jd.experience_min) : ''}
          onChange={v => updateField({ experience_min: v ? Number(v) : undefined })}
          placeholder="3"
          readOnly={readOnly}
        />
      </div>
      <div>
        <FieldLabel>Expérience max (ans)</FieldLabel>
        <TextInput
          type="number"
          value={typeof jd.experience_max === 'number' ? String(jd.experience_max) : ''}
          onChange={v => updateField({ experience_max: v ? Number(v) : undefined })}
          placeholder="8"
          readOnly={readOnly}
        />
      </div>
      <div>
        <FieldLabel>Salaire min (€/an)</FieldLabel>
        <TextInput
          type="number"
          value={typeof jd.salary_min === 'number' ? String(jd.salary_min) : ''}
          onChange={v => updateField({ salary_min: v ? Number(v) : undefined })}
          placeholder="65000"
          readOnly={readOnly}
        />
      </div>
      <div>
        <FieldLabel>Salaire max (€/an)</FieldLabel>
        <TextInput
          type="number"
          value={typeof jd.salary_max === 'number' ? String(jd.salary_max) : ''}
          onChange={v => updateField({ salary_max: v ? Number(v) : undefined })}
          placeholder="85000"
          readOnly={readOnly}
        />
      </div>
      <div>
        <FieldLabel>Avantages / Equity</FieldLabel>
        <TextInput value={jd.benefits} onChange={v => updateField({ benefits: v })} placeholder="Ex: BSPCE, mutuelle..." readOnly={readOnly} />
      </div>
    </div>
  </SectionCard>
);

const SectionCompetences: React.FC<{ jd: JobDetails; updateField: (p: Partial<JobDetails>) => void; readOnly?: boolean }> = ({ jd, updateField, readOnly }) => (
  <SectionCard emoji="⚡" title="Compétences" subtitle="Ce qui sera utilisé pour scorer les candidats">
    <div>
      <FieldLabel required>Must-have <span className="ml-1 text-muted-foreground font-normal normal-case tracking-normal">— obligatoires</span></FieldLabel>
      <div className="mt-1.5">
        <TagsInput
          values={jd.skills_must_have || []}
          onChange={v => updateField({ skills_must_have: v })}
          placeholder="React, TypeScript..."
          readOnly={readOnly}
          variant="must"
        />
      </div>
    </div>
    <div>
      <FieldLabel>Should-have <span className="ml-1 text-muted-foreground font-normal normal-case tracking-normal">— souhaitées</span></FieldLabel>
      <div className="mt-1.5">
        <TagsInput
          values={jd.skills_should_have || []}
          onChange={v => updateField({ skills_should_have: v })}
          placeholder="GraphQL, Tests..."
          readOnly={readOnly}
          variant="should"
        />
      </div>
    </div>
    <div>
      <FieldLabel>Nice-to-have <span className="ml-1 text-muted-foreground font-normal normal-case tracking-normal">— bonus</span></FieldLabel>
      <div className="mt-1.5">
        <TagsInput
          values={jd.skills_nice_to_have || []}
          onChange={v => updateField({ skills_nice_to_have: v })}
          placeholder="OSS contributor, blog tech..."
          readOnly={readOnly}
          variant="nice"
        />
      </div>
    </div>
  </SectionCard>
);

const SectionMission: React.FC<{ jd: JobDetails; updateField: (p: Partial<JobDetails>) => void; readOnly?: boolean }> = ({ jd, updateField, readOnly }) => (
  <SectionCard emoji="📝" title="Description de la mission" subtitle="Contexte + missions principales">
    <div>
      <FieldLabel>Contexte du recrutement</FieldLabel>
      <TextArea
        value={jd.context}
        onChange={v => updateField({ context: v })}
        placeholder="Ex: Création de poste, remplacement, croissance équipe..."
        rows={2}
        readOnly={readOnly}
      />
    </div>
    <div>
      <FieldLabel required>Mission</FieldLabel>
      <TextArea
        value={jd.mission_description}
        onChange={v => updateField({ mission_description: v })}
        placeholder="Décris les missions principales, les projets, le quotidien du candidat..."
        rows={6}
        readOnly={readOnly}
      />
    </div>
  </SectionCard>
);

// ─── Completion compute ─────────────────────────────────────────────

interface Completion {
  filled: number;
  total: number;
  percent: number;
  criticalMissing: string[];
}

function computeCompletion(jd: JobDetails): Completion {
  const checks: { key: string; label: string; critical?: boolean; filled: boolean }[] = [
    { key: 'title', label: 'Titre', critical: true, filled: !!jd.title },
    { key: 'contract_type', label: 'Type de contrat', filled: !!jd.contract_type },
    { key: 'location', label: 'Localisation', critical: true, filled: !!jd.location },
    { key: 'remote_policy', label: 'Télétravail', filled: !!jd.remote_policy },
    { key: 'client.name', label: 'Nom du client', filled: !!jd.client?.name },
    { key: 'seniority', label: 'Séniorité', filled: !!jd.seniority },
    { key: 'experience', label: 'Expérience', filled: typeof jd.experience_min === 'number' || typeof jd.experience_max === 'number' },
    { key: 'salary', label: 'Salaire', filled: typeof jd.salary_min === 'number' || typeof jd.salary_max === 'number' },
    { key: 'skills_must_have', label: 'Compétences must-have', critical: true, filled: !!(jd.skills_must_have && jd.skills_must_have.length > 0) },
    { key: 'skills_should_have', label: 'Compétences should-have', filled: !!(jd.skills_should_have && jd.skills_should_have.length > 0) },
    { key: 'mission_description', label: 'Description de mission', critical: true, filled: !!(jd.mission_description && jd.mission_description.length >= 30) },
    { key: 'context', label: 'Contexte', filled: !!jd.context },
  ];
  const filled = checks.filter(c => c.filled).length;
  const total = checks.length;
  const criticalMissing = checks.filter(c => c.critical && !c.filled).map(c => c.label);
  return {
    filled,
    total,
    percent: Math.round((filled / total) * 100),
    criticalMissing,
  };
}
