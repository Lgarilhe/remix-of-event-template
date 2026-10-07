// Refonte mission, lot 2 : états vides et d'erreur du Pipeline (conception 9).
// Trois états distincts, rien n'apparaît pour disparaître ensuite, jamais un
// zéro inventé. Pas de vidéo, pas de chiffres marketing, pas de carte Maintenant.

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, FileText, RefreshCw, Search, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { computeReadiness } from '@/hooks/useMissionReadiness';
import type { SourcingProject } from '@/hooks/useSourcingProjects';
import { plural } from '@/lib/plural';
import { cn } from '@/lib/utils';
import { unopenedLinkText } from '../types';

// ------------------------------------------------------------ mission neuve

/**
 * Poste décrit : un intitulé (étape brief de computeReadiness) ET de quoi le
 * comprendre (description ou compétences requises). L'intitulé seul est
 * toujours présent (nom de la mission) et ne dit pas que le poste est décrit.
 */
export function isJobDescribed(project: SourcingProject): boolean {
  const brief = computeReadiness(project).find((step) => step.id === 'brief');
  const jd = project.job_details ?? {};
  const hasText = !!(jd.mission_description || jd.context || jd.raw_brief);
  const hasSkills = (jd.skills_must_have?.length ?? 0) > 0;
  return !!brief?.isComplete && (hasText || hasSkills);
}

function useMissionHasSequence(projectId: string) {
  return useQuery({
    queryKey: ['mission-v3', projectId, 'has-sequence'],
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.from('outreach_sequences').select('id').eq('project_id', projectId).limit(1);
      if (error) throw error;
      return (data ?? []).length > 0;
    },
    staleTime: 60_000,
  });
}

interface StartCardProps {
  done: boolean | null;
  title: string;
  text: string;
  action: string;
  icon: typeof FileText;
  onAction: () => void;
}

function StartCard({ done, title, text, action, icon: Icon, onAction }: StartCardProps) {
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'grid h-7 w-7 shrink-0 place-items-center rounded-full border',
            done ? 'border-brand bg-brand text-brand-foreground' : 'border-border text-foreground',
          )}
          aria-hidden="true"
        >
          {done ? <Check className="h-4 w-4" /> : <Icon className="h-3.5 w-3.5" />}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {done === null ? 'Vérification en cours.' : done ? 'Fait.' : text}
          </p>
        </div>
      </div>
      <Button variant={done ? 'outline' : 'primary'} size="sm" onClick={onAction} className="mt-auto self-start">
        {action}
      </Button>
    </li>
  );
}

interface MissionStartCardsProps {
  project: SourcingProject;
  onDescribe: () => void;
  onSearch: () => void;
  onContact: () => void;
}

/** Mission neuve : trois cartes qui se cochent d'après les données. */
export function MissionStartCards({ project, onDescribe, onSearch, onContact }: MissionStartCardsProps) {
  const sequence = useMissionHasSequence(project.id);
  const sequenceDone = sequence.data ?? (sequence.isError ? false : null);

  return (
    <section aria-labelledby="mission-start-title" className="space-y-3">
      <div>
        <h2 id="mission-start-title" className="text-base font-semibold text-foreground">
          Aucun candidat pour l'instant
        </h2>
        <p className="text-sm text-muted-foreground">Trois étapes pour lancer la mission.</p>
      </div>
      <ol className="grid gap-3 md:grid-cols-3">
        <StartCard
          done={isJobDescribed(project)}
          title="Poste décrit"
          text="Décrivez le poste pour que les profils soient notés au plus juste."
          action="Décrire le poste"
          icon={FileText}
          onAction={onDescribe}
        />
        <StartCard
          done={!!project.last_search_at}
          title="Première recherche"
          text="Cherchez des profils qui correspondent au poste."
          action="Chercher des profils"
          icon={Search}
          onAction={onSearch}
        />
        <StartCard
          done={sequenceDone}
          title="Séquence d'approche, facultatif"
          text="Préparez les messages envoyés aux candidats retenus."
          action="Prise de contact"
          icon={Send}
          onAction={onContact}
        />
      </ol>
    </section>
  );
}

// -------------------------------------------------------- autres états vides

function Panel({ children, role }: { children: ReactNode; role?: 'alert' }) {
  return (
    <div role={role} className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border bg-card px-4 py-6 sm:items-center sm:text-center">
      {children}
    </div>
  );
}

/** « Trier les 25 » ; « Trier ce profil » pour un seul. */
export function sortAllLabel(count: number): string {
  return count > 1 ? `Trier les ${count.toLocaleString('fr-FR')}` : 'Trier ce profil';
}

/** « 25 profils à trier vous attendent. » */
export function toSortWaitingText(count: number): string {
  return count > 1
    ? `${plural(count, 'profil')} à trier vous attendent.`
    : `${plural(count, 'profil')} à trier vous attend.`;
}

/** Aucun candidat en cours, des profils à trier. */
export function NothingInProgressToSort({ count, onSort }: { count: number; onSort: () => void }) {
  return (
    <Panel>
      <p className="text-sm text-foreground">
        Aucun candidat retenu pour l'instant. {toSortWaitingText(count)}
      </p>
      <Button variant="primary" size="sm" onClick={onSort}>
        {sortAllLabel(count)}
      </Button>
    </Panel>
  );
}

/** Aucun candidat en cours, rien à trier ; des profils jamais ouverts éventuels. */
export function NothingInProgress({ unopened, onOpenSourcing }: { unopened: number | null; onOpenSourcing: () => void }) {
  const link = unopenedLinkText(unopened);
  return (
    <Panel>
      <p className="text-sm text-foreground">Aucun candidat retenu pour l'instant.</p>
      {link && (
        <button
          type="button"
          onClick={onOpenSourcing}
          className="rounded-sm text-sm text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {link}
        </button>
      )}
    </Panel>
  );
}

/** Filtre d'étape sans résultat. */
export function EmptyFilter({ onReset }: { onReset: () => void }) {
  return (
    <Panel>
      <p className="text-sm text-foreground">Aucun candidat à cette étape.</p>
      <Button variant="outline" size="sm" onClick={onReset}>
        Voir tous les candidats en cours
      </Button>
    </Panel>
  );
}

/** Lecture de la liste en échec. */
export function ListError({ onRetry }: { onRetry: () => void }) {
  return (
    <Panel role="alert">
      <p className="text-sm text-foreground">Impossible de charger les candidats.</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        Réessayer
      </Button>
    </Panel>
  );
}

/** Place gardée pendant le premier chargement. */
export function PipelineLoading() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Chargement des candidats">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}
