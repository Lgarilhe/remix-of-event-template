import { useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { useSourcingProjects, SourcingProject } from '@/hooks/useSourcingProjects';
import { Sparkles, Loader2, SlidersHorizontal } from 'lucide-react';
import type { JobDetails } from '@/types/jobDetails';

// Réponse de generate-search-filters (champs consommés ici)
interface GenerateFiltersResponse {
  success?: boolean;
  error?: string;
  fallback?: boolean;
  filters?: Record<string, unknown>;
  analysis?: { suggested_title?: string | null };
  suggestions?: Record<string, string[]>;
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
  const [prompt, setPrompt] = useState<string>(
    () => ((project.filters_snapshot as Record<string, unknown> | undefined)?.brief_text as string) || '',
  );
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    const trimmed = prompt.trim();
    if (trimmed.length < 10) {
      toast.error('Décrivez un peu plus votre cible (poste, compétences, localisation…)');
      return;
    }
    setGenerating(true);
    try {
      const firstLine = trimmed.split('\n')[0].slice(0, 80);
      const { data, error } = await invokeWithCredits<GenerateFiltersResponse>(
        'generate-search-filters',
        'filter_generation',
        {
          job: {
            id: 'draft',
            title: firstLine,
            description: trimmed,
            client: null,
            location: null,
            skills: [],
            seniority: null,
          },
          search_source: 'linkedin',
        },
      );

      if (error || !data?.success || !data.filters) {
        toast.error('La génération a échoué', {
          description: data?.error || error?.message || 'Réessayez dans quelques secondes.',
        });
        return;
      }

      const title = (data.analysis?.suggested_title || firstLine).trim();
      await updateProject({
        id: project.id,
        name: title || project.name,
        // Le prompt devient la description du poste : il alimente le job
        // synthétique (contexte de scoring) et évite le faux avertissement
        // « recherche peu ciblée » au lancement.
        description: trimmed,
        job_details: { ...(project.job_details || {}), title } as JobDetails,
        filters_snapshot: {
          ...data.filters,
          ...(data.suggestions ? { suggestions: data.suggestions } : {}),
          brief_text: trimmed,
          generated_at: new Date().toISOString(),
        },
      });

      toast.success('Filtres générés', {
        description: 'Vérifiez les filtres appliqués et lancez la recherche.',
      });
      onGenerated();
    } catch {
      toast.error('La génération a échoué', { description: 'Réessayez dans quelques secondes.' });
    } finally {
      setGenerating(false);
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
        <p className="eyebrow mb-1.5">Recherche assistée par IA</p>
        <h2 className="text-xl font-semibold tracking-tight text-foreground mb-1">
          Décrivez qui vous cherchez
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Poste, compétences, expérience, localisation, type d'entreprise… en langage naturel.
          L'IA construit les filtres LinkedIn pour vous.
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
              className="h-6 px-2 rounded-full bg-muted text-[11.5px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors max-w-full truncate"
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
          <Button variant="primary" onClick={handleGenerate} disabled={generating}>
            {generating ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                L'IA analyse votre demande…
              </>
            ) : (
              <>
                <Sparkles aria-hidden="true" />
                Générer la recherche
              </>
            )}
          </Button>
          <Button variant="ghost" onClick={onSkip} disabled={generating} className="text-muted-foreground">
            <SlidersHorizontal aria-hidden="true" />
            Configurer les filtres manuellement
          </Button>
        </div>
      </div>
    </motion.div>
  );
};
