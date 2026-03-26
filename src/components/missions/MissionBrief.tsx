import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSourcingProjects, SourcingProject } from '@/hooks/useSourcingProjects';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { Sparkles, Loader2, Play, RefreshCw, FileText, FormInput, Mic } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { StructuredBriefForm } from './StructuredBriefForm';
import { VoiceDictation } from './VoiceDictation';
import type { JobDetails } from '@/types/jobDetails';

interface AnalysisResult {
  filters: {
    keywords: string;
    role: Array<{ keywords: string; priority: string; scope: string }>;
    years_of_experience_min: number | null;
    years_of_experience_max: number | null;
    skills_keywords: string[];
    industry_keywords: string[];
    location_keywords: string[];
    location_within_area: number | null;
    company_keywords: Array<{ keywords: string; priority: string; scope: string }>;
    school: Array<{ id: string; name: string; priority: string }>;
    spotlight: string;
    open_to_work: boolean;
  };
  analysis: {
    search_rationale: string | null;
    keyword_rationale: string | null;
    experience_rationale: string | null;
    role_keywords: string[];
    skills_to_search: string[];
    certifications: string[];
    domain_expertise: string[];
    location_hint: string | null;
    job_category: string;
    years_experience_min: number | null;
    years_experience_max: number | null;
  };
}

interface MissionBriefProps {
  project: SourcingProject;
}

const EditField = ({ label, value, field, projectId }: {
  label: string;
  value: string | null;
  field: string;
  projectId: string;
}) => {
  const { updateProject } = useSourcingProjects();
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</label>
      <input
        defaultValue={value || ''}
        onBlur={(e) => updateProject({ id: projectId, [field]: e.target.value || null } as any)}
        className="w-full h-[34px] px-3 text-sm border border-foreground/30 bg-background text-foreground focus:border-foreground focus:outline-none transition-colors"
      />
    </div>
  );
};

export const MissionBrief = ({ project }: MissionBriefProps) => {
  const [, setSearchParams] = useSearchParams();
  const { updateProject } = useSourcingProjects();

  const [briefMode, setBriefMode] = useState<'structured' | 'text' | 'voice'>('structured');
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [briefText, setBriefText] = useState(project.description || '');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);

  // Auto-save job_details on each field change (debounced)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatchRef = useRef<Partial<JobDetails>>({});
  const latestJobDetailsRef = useRef(project.job_details || {});
  latestJobDetailsRef.current = project.job_details || {};

  // Cleanup pending timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const handleJobDetailsUpdate = useCallback((patch: Partial<JobDetails>) => {
    // Merge patch into pending changes
    pendingPatchRef.current = deepMerge(pendingPatchRef.current, patch);

    // Debounce save (800ms)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      // Use ref to always read latest job_details (avoids stale closure)
      const merged = deepMerge(latestJobDetailsRef.current, pendingPatchRef.current);
      updateProject({ id: project.id, job_details: merged } as any);
      pendingPatchRef.current = {};
    }, 800);
  }, [project.id, updateProject]);

  const handleAnalyze = async () => {
    // Use structured data if available, otherwise fall back to text
    const jd = deepMerge(latestJobDetailsRef.current, pendingPatchRef.current) as JobDetails;
    const descText = jd.mission_description || jd.raw_brief || briefText || '';
    if (descText.trim().length < 20 && !jd.title) {
      toast.error('Remplissez au moins le titre ou la description pour analyser');
      return;
    }
    setIsAnalyzing(true);

    try {
      const syntheticJob = {
        id: project.id,
        title: jd.title || project.name,
        description: [
          jd.mission_description,
          jd.context,
          jd.raw_brief,
          briefText,
        ].filter(Boolean).join('\n\n'),
        client: jd.client?.name ? { name: jd.client.name, sector: jd.client.sector } : (project.client_name ? { name: project.client_name } : null),
        location: jd.location || null,
        skills: [
          ...(jd.skills_must_have || []),
          ...(jd.skills_should_have || []),
        ],
        seniority: jd.seniority || null,
        xpMin: jd.experience_min,
        xpMax: jd.experience_max,
      };

      const response = await invokeEdgeFunction('generate-search-filters', {
        job: syntheticJob,
      });

      if (response.error) throw new Error(response.error.message || 'Erreur IA');
      if (!response.data?.success) throw new Error('Analyse échouée');

      setAnalysis({
        filters: response.data.filters as any,
        analysis: response.data.analysis as any,
      });

      toast.success('Analyse terminée');
    } catch (err: any) {
      toast.error(err.message || "Erreur lors de l'analyse");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAcceptAndSource = async () => {
    if (!analysis) return;

    try {
      await updateProject({
        id: project.id,
        filters_snapshot: {
          ...analysis.filters,
          generated_at: new Date().toISOString(),
          brief_text: briefText,
        },
        description: briefText || (project.job_details as any)?.mission_description || project.description,
      });

      toast.success('Filtres sauvegardés — lancement du sourcing');

      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.set('tab', 'sourcing');
        return next;
      }, { replace: true });
    } catch {
      toast.error('Erreur lors de la sauvegarde');
    }
  };

  return (
    <div className="bg-background border border-foreground border-t-0 p-4 sm:p-6">
      {/* Mode toggle */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setBriefMode('structured')}
          className={cn(
            "flex items-center gap-1.5 h-[30px] px-3 text-[10px] font-medium uppercase tracking-wider border transition-colors",
            briefMode === 'structured'
              ? "bg-foreground text-background border-foreground"
              : "bg-background text-foreground border-foreground/30 hover:border-foreground"
          )}
        >
          <FormInput className="w-3 h-3" /> Structuré
        </button>
        <button
          onClick={() => setBriefMode('text')}
          className={cn(
            "flex items-center gap-1.5 h-[30px] px-3 text-[10px] font-medium uppercase tracking-wider border transition-colors",
            briefMode === 'text'
              ? "bg-foreground text-background border-foreground"
              : "bg-background text-foreground border-foreground/30 hover:border-foreground"
          )}
        >
          <FileText className="w-3 h-3" /> Texte libre
        </button>
        <button
          onClick={() => setBriefMode('voice')}
          className={cn(
            "flex items-center gap-1.5 h-[30px] px-3 text-[10px] font-medium uppercase tracking-wider border transition-colors",
            briefMode === 'voice'
              ? "bg-foreground text-background border-foreground"
              : "bg-background text-foreground border-foreground/30 hover:border-foreground"
          )}
        >
          <Mic className="w-3 h-3" /> Dicter
        </button>
      </div>

      {/* Structured mode */}
      {briefMode === 'structured' && (
        <StructuredBriefForm
          jobDetails={deepMerge(project.job_details || {}, pendingPatchRef.current) as JobDetails}
          onUpdate={handleJobDetailsUpdate}
        />
      )}

      {/* Text mode (legacy) */}
      {briefMode === 'text' && (
        <div>
          <textarea
            value={briefText}
            onChange={(e) => setBriefText(e.target.value)}
            onBlur={() => {
              if (briefText !== (project.description || '')) {
                updateProject({ id: project.id, description: briefText });
              }
            }}
            placeholder="Décrivez le poste à pourvoir : titre, compétences, localisation, expérience, contexte client..."
            className="w-full min-h-[120px] max-h-[300px] px-3 py-2 text-sm border border-foreground/30 bg-background text-foreground resize-y focus:border-foreground focus:outline-none transition-colors"
          />
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-2">
            {briefText.length > 0 ? `${briefText.length} caractères` : 'Collez votre fiche de poste'}
          </p>
        </div>
      )}

      {/* Voice mode */}
      {briefMode === 'voice' && (
        <div className="space-y-4">
          <VoiceDictation
            onTranscript={(chunk) => {
              setVoiceTranscript(prev => (prev ? prev + ' ' : '') + chunk);
            }}
            onComplete={(fullText) => {
              // Save transcript to job_details
              handleJobDetailsUpdate({
                voice_transcript: fullText,
                raw_brief: fullText,
                brief_source: 'voice',
              });
              toast.success('Dictée terminée — transcript sauvegardé');
            }}
          />

          {/* Transcript display */}
          {(voiceTranscript || (project.job_details as any)?.voice_transcript) && (
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Transcript
              </label>
              <div className="border border-foreground/20 bg-muted/10 p-4 max-h-[300px] overflow-y-auto">
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                  {voiceTranscript || (project.job_details as any)?.voice_transcript || ''}
                </p>
              </div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                {(voiceTranscript || (project.job_details as any)?.voice_transcript || '').length} caractères
                — Utilisez "Analyser avec l'IA" pour structurer automatiquement
              </p>
            </div>
          )}
        </div>
      )}

      {/* AI Analyze button */}
      <div className="flex items-center justify-end mt-4">
        <button
          onClick={handleAnalyze}
          disabled={isAnalyzing}
          className={cn(
            "relative overflow-hidden flex items-center gap-2 h-[34px] px-5 text-[10px] font-medium uppercase tracking-wider border border-foreground group",
            isAnalyzing ? "bg-muted text-muted-foreground" : "bg-foreground text-background"
          )}
        >
          {isAnalyzing ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin relative z-10" />
              <span className="relative z-10">Analyse en cours...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5 relative z-10" />
              <span className="relative z-10">Analyser avec l'IA</span>
              <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
            </>
          )}
        </button>
      </div>

      {/* AI Results */}
      {analysis && (
        <div className="border border-foreground mt-6 bg-muted/20">
          <div className="border-l-4 border-brutal-accent p-4 sm:p-6 space-y-5">
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                🎯 Stratégie de recherche
              </h3>
              <p className="text-sm text-foreground">
                {analysis.analysis.search_rationale || 'Analyse générée'}
              </p>
            </div>

            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                👤 Profil idéal (ICP)
              </h3>
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider mr-1 self-center">Titres:</span>
                  {analysis.analysis.role_keywords.map((kw, i) => (
                    <span key={i} className="px-2 py-0.5 bg-foreground text-background text-[10px] font-medium uppercase tracking-wider">
                      {kw}
                    </span>
                  ))}
                </div>
                {analysis.filters.skills_keywords.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider mr-1 self-center">Skills:</span>
                    {analysis.filters.skills_keywords.map((skill, i) => (
                      <span key={i} className="px-2 py-0.5 border border-foreground/30 text-foreground text-[10px] font-medium uppercase tracking-wider">
                        {skill}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Expérience:</span>
                  <span className="px-2 py-0.5 border border-foreground/30 text-foreground text-[10px] font-medium">
                    {analysis.filters.years_of_experience_min ?? '?'} - {analysis.filters.years_of_experience_max ?? '?'} ans
                  </span>
                </div>
                {analysis.filters.location_keywords.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Zone:</span>
                    {analysis.filters.location_keywords.map((loc, i) => (
                      <span key={i} className="px-2 py-0.5 border border-foreground/30 text-foreground text-[10px] font-medium">
                        {loc}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                🔍 Boolean généré
              </h3>
              <code className="block text-[11px] text-foreground/80 bg-muted p-3 border border-foreground/10 break-all">
                {analysis.filters.keywords}
              </code>
            </div>

            <div className="flex flex-wrap gap-2 pt-2 border-t border-foreground/10">
              <button
                onClick={handleAcceptAndSource}
                className="relative overflow-hidden flex items-center gap-2 h-[34px] px-5 text-[10px] font-medium uppercase tracking-wider border border-foreground bg-foreground text-background group"
              >
                <Play className="w-3.5 h-3.5 relative z-10" />
                <span className="relative z-10">Accepter & lancer le sourcing</span>
              </button>
              <button
                onClick={() => setAnalysis(null)}
                className="relative overflow-hidden flex items-center gap-2 h-[34px] px-4 text-[10px] font-medium uppercase tracking-wider border border-foreground bg-background text-foreground group"
              >
                <RefreshCw className="w-3.5 h-3.5 relative z-10" />
                <span className="relative z-10">Regénérer</span>
                <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mission info */}
      <div className="border border-foreground/20 p-4 sm:p-6 mt-6">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-4">
          Infos mission
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <EditField label="Nom" value={project.name} field="name" projectId={project.id} />
          <EditField label="Client" value={project.client_name} field="client_name" projectId={project.id} />
          <EditField label="Lien Calendly" value={project.calendly_link} field="calendly_link" projectId={project.id} />
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Statut</label>
            <select
              defaultValue={project.status}
              onChange={(e) => updateProject({ id: project.id, status: e.target.value as SourcingProject['status'] })}
              className="w-full h-[34px] px-3 text-sm border border-foreground/30 bg-background text-foreground focus:border-foreground focus:outline-none transition-colors"
            >
              <option value="active">Actif</option>
              <option value="paused">En pause</option>
              <option value="completed">Terminé</option>
              <option value="archived">Archivé</option>
            </select>
          </div>
        </div>
        <div className="mt-4 space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Notes internes</label>
          <textarea
            defaultValue={project.notes || ''}
            onBlur={(e) => updateProject({ id: project.id, notes: e.target.value })}
            placeholder="Notes internes sur cette mission..."
            className="w-full min-h-[80px] px-3 py-2 text-sm border border-foreground/30 bg-background text-foreground resize-y focus:border-foreground focus:outline-none transition-colors"
          />
        </div>
      </div>
    </div>
  );
};

/** Deep merge two objects (arrays are replaced, not concatenated) */
function deepMerge(target: any, source: any): any {
  if (!source || typeof source !== 'object') return target;
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target?.[key];
    if (
      sv != null &&
      typeof sv === 'object' &&
      !Array.isArray(sv) &&
      tv != null &&
      typeof tv === 'object' &&
      !Array.isArray(tv)
    ) {
      result[key] = deepMerge(tv, sv);
    } else {
      result[key] = sv;
    }
  }
  return result;
}
