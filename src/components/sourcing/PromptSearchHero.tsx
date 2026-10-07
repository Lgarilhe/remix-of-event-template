import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { useSourcingProjects, SourcingProject } from '@/hooks/useSourcingProjects';
import { Sparkles, Loader2, SlidersHorizontal } from 'lucide-react';
import type { JobDetails } from '@/types/jobDetails';
import { useOrganization } from '@/hooks/useOrganization';
import { requireGeneratedFilters, requireGeneratedSearchMemoryContext } from '@/components/outreach/search/generateFiltersFromJob';

// Réponse de generate-search-filters (champs consommés ici)
interface GenerateFiltersResponse {
  success?: boolean;
  error?: string;
  fallback?: boolean;
  degraded?: boolean;
  filters?: Record<string, unknown>;
  analysis?: { suggested_title?: string | null };
  suggestions?: Record<string, string[]>;
  memory_context?: unknown;
}

const EXAMPLES = [
  'Développeur fullstack React/Node, 5 ans d’expérience minimum, Paris ou full remote, idéalement en scale-up',
  'Head of Sales SaaS B2B, Lyon, habitué aux cycles de vente grands comptes',
  'Product designer senior, Figma et design systems, full remote France',
];

interface PromptSearchHeroProps {
  project: SourcingProject;
  /** Des filtres existent déjà → régénérer les remplacera */
  hasExistingFilters: boolean;
  /** Appelé après persistance des filtres générés */
  onGenerated: () => void;
  /** « Configurer manuellement » — ferme le hero sans rien générer */
  onSkip: () => void;
}

// Hero « recherche par prompt » : décris la cible en langage naturel → l'IA
// génère les filtres LinkedIn (même moteur que le Brief IA des missions),
// extrait l'intitulé du poste (nom de la recherche + scoring débloqué) et
// persiste le tout dans filters_snapshot → hydratation auto du panneau.
export const PromptSearchHero = ({ project, hasExistingFilters, onGenerated, onSkip }: PromptSearchHeroProps) => {
  const { updateProject } = useSourcingProjects('search');
  const { organizationId } = useOrganization();
  const [prompt, setPrompt] = useState<string>(
    () => ((project.filters_snapshot as Record<string, unknown> | undefined)?.brief_text as string) || '',
  );
  const [generating, setGenerating] = useState(false);
  const generationRef = useRef(0);
  const contextKey = JSON.stringify([organizationId, project.id]);
  const contextRef = useRef(contextKey);
  contextRef.current = contextKey;
  useEffect(() => {
    setGenerating(false);
    setPrompt(typeof project.filters_snapshot?.brief_text === 'string' ? project.filters_snapshot.brief_text : '');
    return () => { generationRef.current += 1; };
    // Le changement de contexte recharge le brouillon ; une sauvegarde de
    // filtres dans le même contexte ne doit pas effacer la saisie en cours.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey]);

  const handleGenerate = async () => {
    const trimmed = prompt.trim();
    if (trimmed.length < 10) {
      toast.error('Décris un peu plus ta cible (poste, compétences, localisation…)');
      return;
    }
    if (!organizationId || project.organization_id !== organizationId) {
      toast.error('Attends le chargement de cette recherche avant de générer les filtres.');
      return;
    }
    const generation = ++generationRef.current;
    const isCurrent = () => generationRef.current === generation && contextRef.current === contextKey;
    setGenerating(true);
    try {
      const firstLine = trimmed.split('\n')[0].slice(0, 80);
      const { data, error } = await invokeWithCredits<GenerateFiltersResponse>(
        'generate-search-filters',
        'filter_generation',
        {
          job: {
            id: `project:${project.id}`,
            title: firstLine,
            description: trimmed,
            client: null,
            location: null,
            skills: [],
            seniority: null,
          },
          search_source: 'linkedin',
          organization_id: organizationId,
          project_id: project.id,
        },
      );

      if (!isCurrent()) return;
      if (error) throw error;
      const generatedFilters = requireGeneratedFilters(data);
      const memoryContext = requireGeneratedSearchMemoryContext(data?.memory_context);

      const title = (data?.analysis?.suggested_title || firstLine).trim();
      await updateProject({
        id: project.id,
        name: title || project.name,
        // Le prompt devient la description du poste : il alimente le job
        // synthétique (contexte de scoring) et évite le faux avertissement
        // « recherche peu ciblée » au lancement.
        description: trimmed,
        job_details: { ...(project.job_details || {}), title } as JobDetails,
        filters_snapshot: {
          ...generatedFilters,
          ...(data?.suggestions ? { suggestions: data.suggestions } : {}),
          memory_context: memoryContext ?? null,
          brief_text: trimmed,
          generated_at: new Date().toISOString(),
        },
      });

      if (!isCurrent()) return;
      const memoryCount = memoryContext?.provenance.length ?? 0;
      toast.success('Filtres générés', {
        description: memoryCount > 0
          ? `${memoryCount} règle${memoryCount > 1 ? 's' : ''} confirmée${memoryCount > 1 ? 's' : ''} en mémoire prise${memoryCount > 1 ? 's' : ''} en compte. Vérifie les filtres avant de rechercher.`
          : 'Vérifie les filtres appliqués et lance la recherche.',
      });
      onGenerated();
    } catch (error) {
      if (!isCurrent()) return;
      toast.error('La génération a échoué', {
        description: error instanceof Error ? error.message : 'Réessaie dans quelques secondes.',
      });
    } finally {
      if (isCurrent()) setGenerating(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="w-full max-w-2xl mx-auto py-8 sm:py-14"
    >
      <div className="rounded-xl border border-border bg-card p-5 sm:p-8">
        <p className="text-2xs uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
          Recherche assistée par IA
        </p>
        <h2 className="font-display text-xl sm:text-2xl font-bold text-foreground tracking-tight mb-1">
          Décris qui tu cherches
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Poste, compétences, expérience, localisation, type d'entreprise… en langage naturel.
          L'IA construit les filtres LinkedIn pour toi.
        </p>

        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={`Ex : ${EXAMPLES[0]}`}
          rows={4}
          disabled={generating}
          className="resize-none text-sm"
          aria-label="Description de la cible recherchée"
        />

        <div className="flex flex-wrap gap-1.5 mt-3">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={generating}
              onClick={() => setPrompt(ex)}
              className="h-6 px-2 rounded-full bg-muted text-2xs text-foreground hover:bg-accent transition-colors max-w-full truncate"
              title={ex}
            >
              {ex.slice(0, 52)}…
            </button>
          ))}
        </div>

        {hasExistingFilters && (
          <p className="text-xs text-warning mt-3">
            Régénérer remplacera les filtres actuels de cette recherche.
          </p>
        )}

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mt-5">
          <Button onClick={handleGenerate} disabled={generating} className="gap-1.5">
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                L'IA analyse ta demande…
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Générer la recherche
              </>
            )}
          </Button>
          <Button variant="ghost" onClick={onSkip} disabled={generating} className="gap-1.5">
            <SlidersHorizontal className="w-4 h-4" />
            Configurer les filtres manuellement
          </Button>
        </div>
      </div>
    </motion.div>
  );
};
