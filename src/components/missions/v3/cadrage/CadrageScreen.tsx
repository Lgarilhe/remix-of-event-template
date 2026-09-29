// Refonte mission : écran Cadrage de la nouvelle page mission (conception
// 5.6, maquette Cadrage). Une colonne de 920 px : bandeau de lecture seule,
// bandeau de complétude, Critères, Le poste (avec Vos messages et Plus de
// détails), Étapes d'entretien, Équipe (selon les droits), puis Réglages
// repliés (MissionConfigV2, jusqu'aux lots 7 et 8).
//
// Une seule instance de useJobDetailsAutosave pour tout l'écran : Critères,
// Le poste, Vos messages et Plus de détails écrivent le même brouillon, et les
// Réglages n'y écrivent plus (hideMessageSettings), d'où plus de course entre
// deux chemins d'enregistrement. ?section=criteres|poste|etapes|equipe|reglages
// fait défiler jusqu'à la section, et reglages la déplie.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { MissionConfigV2 } from '@/components/missions/v2/MissionConfigV2';
import { useJobDetailsAutosave, type JobDetailsSaveStatus } from '@/hooks/useJobDetailsAutosave';
import { useMissionProcess } from '@/hooks/useMissionProcess';
import { useSourcingProjects } from '@/hooks/useSourcingProjects';
import { cn } from '@/lib/utils';
import { useMissionV3 } from '../MissionV3Context';
import type { CadrageSection } from '../types';
import { CadrageReadOnlyBanner } from './CadrageReadOnlyBanner';
import { CadrageReadiness } from './CadrageReadiness';
import { CriteriaSection } from './CriteriaSection';
import { InterviewStepsSection } from './InterviewStepsSection';
import { JobMoreDetails } from './JobMoreDetails';
import { JobSection } from './JobSection';
import { TeamSection } from './TeamSection';

const SECTION_ID: Record<CadrageSection, string> = {
  criteres: 'cadrage-criteres',
  poste: 'cadrage-poste',
  etapes: 'cadrage-etapes',
  equipe: 'cadrage-equipe',
  reglages: 'cadrage-reglages',
};

// En-tête de section : petites capitales grises (même style que « En ce moment » du Pipeline).
const SECTION_TITLE_CLASS = 'text-2xs font-semibold uppercase tracking-wider text-muted-foreground';

/** Lien de prise de rendez-vous (colonne de la mission), enregistré à la sortie du champ. */
function useCalendlyLinkSave(projectId: string, readOnly: boolean) {
  const { updateProject } = useSourcingProjects();
  const [status, setStatus] = useState<JobDetailsSaveStatus>('idle');
  const last = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const save = useCallback(
    async (value: string) => {
      if (readOnly) return;
      last.current = value;
      setStatus('saving');
      try {
        await updateProject({ id: projectId, calendly_link: value || null });
        setStatus('saved');
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setStatus('idle'), 2500);
      } catch {
        setStatus('error');
      }
    },
    [projectId, readOnly, updateProject],
  );
  const retry = useCallback(() => {
    if (last.current !== null) void save(last.current);
  }, [save]);
  return { status, save, retry };
}

/** Un état pour l'écran : l'échec d'abord, puis l'envoi en cours, puis l'enregistré. */
function combinedStatus(a: JobDetailsSaveStatus, b: JobDetailsSaveStatus): JobDetailsSaveStatus {
  for (const s of ['error', 'saving', 'saved'] as const) if (a === s || b === s) return s;
  return 'idle';
}

export function CadrageScreen(): JSX.Element | null {
  const { project, location, canEditBrief, canEditProcess } = useMissionV3();
  const { steps, loadingSteps, stepsError } = useMissionProcess(project.id);
  const autosave = useJobDetailsAutosave(project, !canEditBrief);
  const link = useCalendlyLinkSave(project.id, !canEditBrief);
  const reduceMotion = useReducedMotion();
  const section = location.section;
  const [settingsOpen, setSettingsOpen] = useState(section === 'reglages');
  const scrolledFor = useRef<CadrageSection | null>(null);

  // Défilement vers la section demandée, une fois par demande. Les sections
  // sous les étapes attendent leur liste, qui change la hauteur au-dessus.
  useEffect(() => {
    if (!section) {
      scrolledFor.current = null;
      return;
    }
    if (section === 'reglages') setSettingsOpen(true);
    if (scrolledFor.current === section) return;
    if (section !== 'poste' && section !== 'criteres' && loadingSteps) return;
    scrolledFor.current = section;
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(SECTION_ID[section])
        ?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [section, loadingSteps, reduceMotion]);

  const { jd, updateField } = autosave;
  const status = combinedStatus(autosave.saveStatus, link.status);
  const retry = () => {
    if (autosave.saveStatus === 'error') autosave.retry();
    if (link.status === 'error') link.retry();
  };
  const stepsState = loadingSteps ? 'loading' : stepsError ? 'error' : 'ready';

  return (
    <div className="mx-auto flex w-full max-w-[920px] flex-col gap-5 pb-12 pt-2">
      <CadrageReadOnlyBanner />

      <CadrageReadiness
        jd={jd}
        stepCount={steps.length}
        stepsState={stepsState}
        saveStatus={status}
        onRetry={retry}
        canDictate={canEditBrief}
        updateField={updateField}
      />

      <SectionErrorBoundary fallbackTitle="Erreur dans les Critères">
        <CriteriaSection jd={jd} updateField={updateField} readOnly={!canEditBrief} />
      </SectionErrorBoundary>

      <SectionErrorBoundary fallbackTitle="Erreur dans Le poste">
        <JobSection
          jd={jd}
          updateField={updateField}
          readOnly={!canEditBrief}
          calendlyLink={project.calendly_link ?? ''}
          onCalendlyCommit={(value) => void link.save(value)}
        >
          <JobMoreDetails jd={jd} updateField={updateField} readOnly={!canEditBrief} />
        </JobSection>
      </SectionErrorBoundary>

      <SectionErrorBoundary fallbackTitle="Erreur dans les Étapes d'entretien">
        <InterviewStepsSection project={project} readOnly={!canEditProcess} />
      </SectionErrorBoundary>

      <SectionErrorBoundary fallbackTitle="Erreur dans l'Équipe">
        <TeamSection project={project} readOnly={!canEditProcess} />
      </SectionErrorBoundary>

      <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen} asChild>
        <section id={SECTION_ID.reglages} aria-labelledby="cadrage-reglages-titre" className="scroll-mt-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h2 id="cadrage-reglages-titre">
              <CollapsibleTrigger
                className={cn(
                  'group inline-flex items-center gap-1.5 rounded-md text-left',
                  SECTION_TITLE_CLASS,
                  'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                )}
              >
                Réglages
                <ChevronDown
                  aria-hidden="true"
                  className="h-3.5 w-3.5 shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
                />
              </CollapsibleTrigger>
            </h2>
            <span className="text-xs text-muted-foreground">
              Nom de la mission, notes internes, portail client et autres réglages.
            </span>
          </div>
          <CollapsibleContent className="pt-2.5">
            <SectionErrorBoundary fallbackTitle="Erreur dans les Réglages">
              <MissionConfigV2 project={project} readOnly={!canEditBrief} hideStatus hideMessageSettings embedded />
            </SectionErrorBoundary>
          </CollapsibleContent>
        </section>
      </Collapsible>
    </div>
  );
}
