// Refonte mission, lot 1 : écran Cadrage de la nouvelle page mission
// (conception 5.6, jusqu'aux lots 7 et 8). Une seule page : Le poste
// (MissionBriefV2), Étapes d'entretien (MissionProcessV2), puis Réglages repliés
// (MissionConfigV2), composants d'aujourd'hui tels quels. Lecture seule
// annoncée en tête avec sa raison. ?section=poste|etapes|reglages fait défiler
// jusqu'à la section, et reglages la déplie.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { MissionBriefV2 } from '@/components/missions/v2/MissionBriefV2';
import { MissionProcessV2 } from '@/components/missions/v2/MissionProcessV2';
import { MissionConfigV2 } from '@/components/missions/v2/MissionConfigV2';
import { useMissionProcess } from '@/hooks/useMissionProcess';
import { cn } from '@/lib/utils';
import { useMissionV3 } from '../MissionV3Context';
import type { CadrageSection } from '../types';
import { CadrageReadOnlyBanner } from './CadrageReadOnlyBanner';

const SECTION_ID: Record<CadrageSection, string> = {
  poste: 'cadrage-poste',
  etapes: 'cadrage-etapes',
  reglages: 'cadrage-reglages',
};

function CadrageSectionBlock({
  section,
  title,
  children,
}: {
  section: Exclude<CadrageSection, 'reglages'>;
  title: string;
  children: ReactNode;
}) {
  const headingId = `${SECTION_ID[section]}-titre`;
  return (
    <section id={SECTION_ID[section]} aria-labelledby={headingId} className="scroll-mt-4">
      <h2 id={headingId} className="mb-4 border-b border-border pb-2 text-base font-semibold text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function CadrageScreen(): JSX.Element | null {
  const { project, location, canEditBrief, canEditProcess } = useMissionV3();
  const { loadingSteps } = useMissionProcess(project.id);
  const reduceMotion = useReducedMotion();
  const section = location.section;
  const [settingsOpen, setSettingsOpen] = useState(section === 'reglages');
  const scrolledFor = useRef<CadrageSection | null>(null);

  // Défilement vers la section demandée, une fois par demande. Les étapes et
  // les réglages attendent la liste des étapes, qui change la hauteur au-dessus.
  useEffect(() => {
    if (!section) {
      scrolledFor.current = null;
      return;
    }
    if (section === 'reglages') setSettingsOpen(true);
    if (scrolledFor.current === section) return;
    if (section !== 'poste' && loadingSteps) return;
    scrolledFor.current = section;
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(SECTION_ID[section])
        ?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [section, loadingSteps, reduceMotion]);

  return (
    <div className="w-full max-w-[1280px] space-y-10 pb-12 pt-2">
      <CadrageReadOnlyBanner />

      <CadrageSectionBlock section="poste" title="Le poste">
        <SectionErrorBoundary fallbackTitle="Erreur dans Le poste">
          <MissionBriefV2 project={project} readOnly={!canEditBrief} />
        </SectionErrorBoundary>
      </CadrageSectionBlock>

      <CadrageSectionBlock section="etapes" title="Étapes d'entretien">
        <SectionErrorBoundary fallbackTitle="Erreur dans les Étapes d'entretien">
          <MissionProcessV2 project={project} readOnly={!canEditProcess} />
        </SectionErrorBoundary>
      </CadrageSectionBlock>

      <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen} asChild>
        <section id={SECTION_ID.reglages} aria-labelledby="cadrage-reglages-titre" className="scroll-mt-4">
          <div className="border-b border-border pb-2">
            <h2 id="cadrage-reglages-titre">
              <CollapsibleTrigger
                className={cn(
                  'group flex w-full items-center justify-between gap-3 rounded-md text-left text-base font-semibold text-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                )}
              >
                Réglages
                <ChevronDown
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
                />
              </CollapsibleTrigger>
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Statut, portail client, mode chasse et autres réglages de la mission.
            </p>
          </div>
          <CollapsibleContent className="pt-4">
            <SectionErrorBoundary fallbackTitle="Erreur dans les Réglages">
              <MissionConfigV2 project={project} readOnly={!canEditBrief} />
            </SectionErrorBoundary>
          </CollapsibleContent>
        </section>
      </Collapsible>
    </div>
  );
}
