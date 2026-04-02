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

  const handleAcceptFilters = async (updatedFilters: any) => {
    try {
      await updateProject({
        id: project.id,
        filters_snapshot: { ...updatedFilters, generated_at: new Date().toISOString() },
      });
      setShowFilterReview(false);
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
    <div className="bg-background border-2 border-border border-t-0 p-4 sm:p-6">
      {/* Voice toggle */}
      {!readOnly && (
        <div className="flex items-center justify-end mb-4">
          <button
            onClick={() => setShowVoice(!showVoice)}
            className={cn(
              "flex items-center gap-1.5 h-[30px] px-3 text-xs font-black uppercase tracking-wider border-2 transition-all",
              showVoice
                ? "bg-foreground text-background border-border"
                : "bg-background text-muted-foreground border-border hover:border-border hover:text-foreground"
            )}
          >
            <Mic className="w-3 h-3" /> {showVoice ? 'Masquer la dictée' : 'Dicter le brief'}
          </button>
        </div>
      )}

      {/* Voice mode */}
      {showVoice && !readOnly && (
        <div className="mb-6 border-2 border-border p-4 space-y-3">
          <VoiceDictation
            onTranscript={(chunk) => setVoiceTranscript(prev => (prev ? prev + ' ' : '') + chunk)}
            onComplete={(fullText) => {
              handleJobDetailsUpdate({ voice_transcript: fullText, raw_brief: fullText, brief_source: 'voice' });
              toast.success('Dictée terminée — transcript sauvegardé');
            }}
          />
          {voiceTranscript && (
            <div className="border-2 border-border bg-foreground/[0.03] p-3 max-h-[150px] overflow-y-auto">
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
            "relative overflow-hidden flex items-center gap-2 h-[36px] px-5 text-xs font-black uppercase tracking-wider border-2 border-border group",
            isAnalyzing ? "bg-muted text-muted-foreground" : "bg-foreground text-background"
          )}
        >
          {isAnalyzing ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin relative z-10" /><span className="relative z-10">Analyse en cours...</span></>
          ) : (
            <><Sparkles className="w-3.5 h-3.5 relative z-10" /><span className="relative z-10">Analyser avec l'IA</span>
          )}
        </button>
      </div>

      {analysis && (
        <FilterReviewModal
          open={showFilterReview}
          onOpenChange={setShowFilterReview}
          filters={analysis.filters}
          analysis={analysis.analysis}
          onAccept={handleAcceptFilters}
          onRegenerate={() => { setShowFilterReview(false); setAnalysis(null); handleAnalyze(); }}
        />
      )}
    </div>
  );
};

