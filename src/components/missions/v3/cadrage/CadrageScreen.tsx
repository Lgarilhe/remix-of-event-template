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

// En-tête de section : petites capitales grises, description facultative sur
// la même ligne (même style que « En ce moment » du Pipeline).
const SECTION_TITLE_CLASS = 'text-2xs font-semibold uppercase tracking-wider text-muted-foreground';

// Les composants d'aujourd'hui gardent leur propre en-tête (« Étape 1 · Cadrage »,
// grand titre, phrase d'aide). Ici, un seul niveau de titre par section : on
// masque ce bloc de texte (racine grid > colonne > en-tête > texte), pas ses
// boutons voisins (Dicter, Analyser avec l'IA, Suggestion IA).
const HIDE_V2_HEADING = '[&>div>div:first-child>div:first-child>div:first-child]:hidden';
const HIDE_V2_CONFIG_HEADING = '[&>div>div:first-child>div.mb-5:first-child]:hidden';

function CadrageSectionBlock({
  section,
  title,
  description,
  children,
}: {
  section: Exclude<CadrageSection, 'reglages'>;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const headingId = `${SECTION_ID[section]}-titre`;
  return (
    <section id={SECTION_ID[section]} aria-labelledby={headingId} className="scroll-mt-4">
      <div className="mb-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h2 id={headingId} className={SECTION_TITLE_CLASS}>
          {title}
        </h2>
        {description && <span className="text-xs text-muted-foreground">{description}</span>}
      </div>
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
    <div className="w-full max-w-[1280px] space-y-5 pb-12 pt-2">
      <CadrageReadOnlyBanner />

      <CadrageSectionBlock section="poste" title="Le poste">
        <SectionErrorBoundary fallbackTitle="Erreur dans Le poste">
          <div className={HIDE_V2_HEADING}>
            <MissionBriefV2 project={project} readOnly={!canEditBrief} />
          </div>
        </SectionErrorBoundary>
      </CadrageSectionBlock>

      <CadrageSectionBlock section="etapes" title="Étapes d'entretien" description="Dans l'ordre où le candidat les passe.">
        <SectionErrorBoundary fallbackTitle="Erreur dans les Étapes d'entretien">
          <div className={HIDE_V2_HEADING}>
            <MissionProcessV2 project={project} readOnly={!canEditProcess} />
          </div>
        </SectionErrorBoundary>
      </CadrageSectionBlock>

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
              Portail client, mode chasse et autres réglages de la mission.
            </span>
          </div>
          <CollapsibleContent className="pt-2.5">
            <SectionErrorBoundary fallbackTitle="Erreur dans les Réglages">
              <div className={HIDE_V2_CONFIG_HEADING}>
                <MissionConfigV2 project={project} readOnly={!canEditBrief} hideStatus />
              </div>
            </SectionErrorBoundary>
          </CollapsibleContent>
        </section>
      </Collapsible>
    </div>
  );
}
