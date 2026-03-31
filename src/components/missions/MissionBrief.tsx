import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSourcingProjects, SourcingProject } from '@/hooks/useSourcingProjects';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { deepMerge } from '@/lib/deepMerge';
import { Sparkles, Loader2, Play, RefreshCw, Mic, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { BriefWizard } from './BriefWizard';
import { VoiceDictation } from './VoiceDictation';
import { FilterReviewModal } from './FilterReviewModal';
import type { JobDetails } from '@/types/jobDetails';

interface AnalysisResult {
  filters: {
    keywords: string;
    role: Array<{ keywords: string; priority: string; scope: string }>;
    years_of_experience_min: number | null;
    years_of_experience_max: number | null;
    skills_keywords: string[];
    location_keywords: string[];
    location_within_area: number | null;
  };
  analysis: {
    search_rationale: string | null;
    keyword_rationale: string | null;
    experience_rationale: string | null;
    role_keywords: string[];
    skills_to_search: string[];
    domain_expertise: string[];
    location_hint: string | null;
    job_category: string;
  };
}

interface MissionBriefProps {
  project: SourcingProject;
  readOnly?: boolean;
}

export const MissionBrief = ({ project, readOnly = false }: MissionBriefProps) => {
  const [, setSearchParams] = useSearchParams();
  const { updateProject } = useSourcingProjects();

  const [showVoice, setShowVoice] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [showFilterReview, setShowFilterReview] = useState(false);

  // Auto-save job_details (debounced)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatchRef = useRef<Partial<JobDetails>>({});
  const latestJobDetailsRef = useRef(project.job_details || {});
  latestJobDetailsRef.current = project.job_details || {};

  useEffect(() => {
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, []);

  const handleJobDetailsUpdate = useCallback((patch: Partial<JobDetails>) => {
    pendingPatchRef.current = deepMerge(pendingPatchRef.current, patch);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const merged = deepMerge(latestJobDetailsRef.current, pendingPatchRef.current);
      updateProject({ id: project.id, job_details: merged } as any);
      pendingPatchRef.current = {};
    }, 800);
  }, [project.id, updateProject]);

  const handleAnalyze = async () => {
    const jd = deepMerge(latestJobDetailsRef.current, pendingPatchRef.current) as JobDetails;
    const descText = jd.mission_description || jd.raw_brief || jd.context || '';
    if (descText.trim().length < 20 && !jd.title) {
      toast.error('Remplissez au moins le titre ou la description pour analyser');
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
      setAnalysis({ filters: response.data.filters as any, analysis: response.data.analysis as any });
      setShowFilterReview(true);
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
        filters_snapshot: { ...analysis.filters, generated_at: new Date().toISOString() },
      });
      toast.success('Filtres sauvegardés — lancement du sourcing');
      setSearchParams(prev => { const next = new URLSearchParams(prev); next.set('tab', 'sourcing'); return next; }, { replace: true });
    } catch {
      toast.error('Erreur lors de la sauvegarde');
    }
  };

  const handleLaunchSourcing = useCallback(() => {
    setSearchParams(prev => { const next = new URLSearchParams(prev); next.set('tab', 'sourcing'); return next; }, { replace: true });
  }, [setSearchParams]);

  return (
    <div className="bg-background border-2 border-foreground border-t-0 p-4 sm:p-6">
      {/* Voice toggle */}
      {!readOnly && (
        <div className="flex items-center justify-end mb-4">
          <button
            onClick={() => setShowVoice(!showVoice)}
            className={cn(
              "flex items-center gap-1.5 h-[30px] px-3 text-[10px] font-black uppercase tracking-wider border-2 transition-all",
              showVoice
                ? "bg-foreground text-background border-foreground"
                : "bg-background text-muted-foreground border-foreground/30 hover:border-foreground hover:text-foreground"
            )}
          >
            <Mic className="w-3 h-3" /> {showVoice ? 'Masquer la dictée' : 'Dicter le brief'}
          </button>
        </div>
      )}

      {/* Voice mode */}
      {showVoice && !readOnly && (
        <div className="mb-6 border-2 border-foreground/30 p-4 space-y-3">
          <VoiceDictation
            onTranscript={(chunk) => setVoiceTranscript(prev => (prev ? prev + ' ' : '') + chunk)}
            onComplete={(fullText) => {
              handleJobDetailsUpdate({ voice_transcript: fullText, raw_brief: fullText, brief_source: 'voice' });
              toast.success('Dictée terminée — transcript sauvegardé');
            }}
          />
          {voiceTranscript && (
            <div className="border-2 border-foreground/15 bg-foreground/[0.03] p-3 max-h-[150px] overflow-y-auto">
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{voiceTranscript}</p>
            </div>
          )}
        </div>
      )}

      {/* Wizard */}
      <BriefWizard
        jobDetails={deepMerge(project.job_details || {}, pendingPatchRef.current) as JobDetails}
        onUpdate={handleJobDetailsUpdate}
        readOnly={readOnly}
        onLaunchSourcing={handleLaunchSourcing}
      />

      {/* AI Analysis */}
      <div className="mt-6 flex items-center justify-end">
        <button
          onClick={handleAnalyze}
          disabled={isAnalyzing}
          className={cn(
            "relative overflow-hidden flex items-center gap-2 h-[36px] px-5 text-[10px] font-black uppercase tracking-wider border-2 border-foreground group",
            isAnalyzing ? "bg-muted text-muted-foreground" : "bg-foreground text-background"
          )}
        >
          {isAnalyzing ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin relative z-10" /><span className="relative z-10">Analyse en cours...</span></>
          ) : (
            <><Sparkles className="w-3.5 h-3.5 relative z-10" /><span className="relative z-10">Analyser avec l'IA</span>
            <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" /></>
          )}
        </button>
      </div>

      {analysis && (
        <div className="border-2 border-foreground mt-4">
          <div className="border-l-4 border-brutal-accent p-4 sm:p-6 space-y-4">
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-wider text-muted-foreground mb-2">🎯 Stratégie de recherche</h3>
              <p className="text-sm text-foreground">{analysis.analysis.search_rationale || 'Analyse générée'}</p>
            </div>
            <div className="space-y-2">
              <h3 className="text-[10px] font-black uppercase tracking-wider text-muted-foreground mb-2">👤 Profil idéal</h3>
              {analysis.analysis.role_keywords.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mr-1 self-center">Titres:</span>
                  {analysis.analysis.role_keywords.map((kw, i) => (
                    <span key={i} className="px-2 py-0.5 bg-foreground text-background text-[10px] font-bold uppercase tracking-wider border-2 border-foreground">{kw}</span>
                  ))}
                </div>
              )}
              {analysis.filters.skills_keywords.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mr-1 self-center">Skills:</span>
                  {analysis.filters.skills_keywords.map((skill, i) => (
                    <span key={i} className="px-2 py-0.5 border-2 border-foreground/30 text-foreground text-[10px] font-bold uppercase tracking-wider">{skill}</span>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-wider text-muted-foreground mb-2">🔍 Boolean</h3>
              <code className="block text-[11px] text-foreground/80 bg-foreground/[0.03] p-3 border-2 border-foreground/15 break-all font-mono">{analysis.filters.keywords}</code>
            </div>
            <div className="flex flex-wrap gap-2 pt-3 border-t-2 border-foreground/15">
              <button onClick={handleAcceptAndSource}
                className="relative overflow-hidden flex items-center gap-2 h-[34px] px-5 text-[10px] font-black uppercase tracking-wider border-2 border-foreground bg-foreground text-background group">
                <Play className="w-3.5 h-3.5 relative z-10" /><span className="relative z-10">Accepter & lancer le sourcing</span>
              </button>
              <button onClick={() => setAnalysis(null)}
                className="relative overflow-hidden flex items-center gap-2 h-[34px] px-4 text-[10px] font-black uppercase tracking-wider border-2 border-foreground bg-background text-foreground group">
                <RefreshCw className="w-3.5 h-3.5 relative z-10" /><span className="relative z-10">Regénérer</span>
                <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

