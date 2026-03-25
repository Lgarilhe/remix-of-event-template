import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSourcingProjects, SourcingProject } from '@/hooks/useSourcingProjects';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { Sparkles, Loader2, Play, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

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
        className="w-full h-[34px] px-3 text-sm border border-foreground bg-background text-foreground"
      />
    </div>
  );
};

export const MissionBrief = ({ project }: MissionBriefProps) => {
  const [, setSearchParams] = useSearchParams();
  const { updateProject } = useSourcingProjects();

  const [briefText, setBriefText] = useState(project.description || '');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);

  const handleAnalyze = async () => {
    if (briefText.trim().length < 20) return;
    setIsAnalyzing(true);

    try {
      const syntheticJob = {
        id: project.id,
        title: project.name,
        description: briefText,
        client: project.client_name ? { name: project.client_name } : null,
        location: null,
        skills: [],
        seniority: null,
        xpMin: undefined,
        xpMax: undefined,
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
        description: briefText,
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
      {/* Section A: Brief + AI */}
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
          className="w-full min-h-[120px] max-h-[300px] px-3 py-2 text-sm border border-foreground bg-background text-foreground resize-y"
        />
        <div className="flex items-center justify-between mt-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
            {briefText.length > 0 ? `${briefText.length} caractères` : 'Collez votre fiche de poste'}
          </p>
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing || briefText.trim().length < 20}
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
      </div>

      {/* Section A.2: AI Results */}
      {analysis && (
        <div className="border border-foreground mt-6 bg-muted/20">
          <div className="border-l-4 border-brutal-accent p-4 sm:p-6 space-y-5">
            {/* Stratégie globale */}
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                🎯 Stratégie de recherche
              </h3>
              <p className="text-sm text-foreground">
                {analysis.analysis.search_rationale || 'Analyse générée'}
              </p>
            </div>

            {/* ICP */}
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                👤 Profil idéal (ICP)
              </h3>
              <div className="space-y-2">
                {/* Titres */}
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider mr-1 self-center">Titres:</span>
                  {analysis.analysis.role_keywords.map((kw, i) => (
                    <span key={i} className="px-2 py-0.5 bg-foreground text-background text-[10px] font-medium uppercase tracking-wider">
                      {kw}
                    </span>
                  ))}
                </div>
                {/* Skills */}
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
                {/* Expérience */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Expérience:</span>
                  <span className="px-2 py-0.5 border border-foreground/30 text-foreground text-[10px] font-medium">
                    {analysis.filters.years_of_experience_min ?? '?'} - {analysis.filters.years_of_experience_max ?? '?'} ans
                  </span>
                  {analysis.analysis.experience_rationale && (
                    <span className="text-[10px] text-muted-foreground italic">
                      ({analysis.analysis.experience_rationale})
                    </span>
                  )}
                </div>
                {/* Localisation */}
                {analysis.filters.location_keywords.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Zone:</span>
                    {analysis.filters.location_keywords.map((loc, i) => (
                      <span key={i} className="px-2 py-0.5 border border-foreground/30 text-foreground text-[10px] font-medium">
                        {loc}
                      </span>
                    ))}
                    {analysis.filters.location_within_area && (
                      <span className="text-[10px] text-muted-foreground">
                        (rayon {Math.round(analysis.filters.location_within_area * 1.6)} km)
                      </span>
                    )}
                  </div>
                )}
                {/* Domaines */}
                {analysis.analysis.domain_expertise.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider mr-1 self-center">Domaines:</span>
                    {analysis.analysis.domain_expertise.map((d, i) => (
                      <span key={i} className="px-2 py-0.5 border border-foreground/10 bg-muted text-muted-foreground text-[10px] font-medium uppercase tracking-wider">
                        {d}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Boolean preview */}
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                🔍 Boolean généré
              </h3>
              <code className="block text-[11px] text-foreground/80 bg-muted p-3 border border-foreground/10 break-all">
                {analysis.filters.keywords}
              </code>
              {analysis.analysis.keyword_rationale && (
                <p className="text-[10px] text-muted-foreground mt-1 italic">
                  {analysis.analysis.keyword_rationale}
                </p>
              )}
            </div>

            {/* Action buttons */}
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

      {/* Section B: Mission info */}
      <div className="border border-foreground p-4 sm:p-6 mt-6">
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
              className="w-full h-[34px] px-3 text-sm border border-foreground bg-background text-foreground"
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
            className="w-full min-h-[80px] px-3 py-2 text-sm border border-foreground bg-background text-foreground resize-y"
          />
        </div>
      </div>
    </div>
  );
};
