/**
 * Sélecteur « Projet Recruiter » : limite la recherche aux personnes déjà dans un projet
 * du contrat Recruiter du compte. La liste vient de l'action `list_recruiter_projects`
 * (au plus 5 pages de 100, mises en cache 5 minutes par compte) ; le choix est écrit dans
 * `filters.hiring_project`, que la recherche envoie déjà. À afficher pour un compte qui
 * a le produit Recruiter, en source Recruiter. Logique de lecture : `recruiterProjectOptions.ts`. Le retrait du
 * choix (autre source, autre compte) est fait par SearchFiltersPanel, qui reste monté quand le sélecteur ne l'est pas.
 */
import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { invokeUnipile } from '@/lib/invokeUnipile';
import {
  parseRecruiterProjectsResponse,
  projectOptions,
  RecruiterProjectsError,
  type RecruiterProject,
} from './recruiterProjectOptions';
import { RECRUITER_PROJECT_COPY } from './searchControlsCopy';

const PAGE_SIZE = 100;
const MAX_PAGES = 5;
/** Valeur du choix « aucun projet » : un sélecteur ne prend pas de valeur vide. */
const NONE_VALUE = '__none__';

async function fetchRecruiterProjects(accountId: string): Promise<RecruiterProject[]> {
  const projects: RecruiterProject[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data } = await invokeUnipile({
      body: {
        action: 'list_recruiter_projects',
        account_id: accountId,
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      },
    });
    const parsed = parseRecruiterProjectsResponse(data);
    projects.push(...parsed.projects);
    cursor = parsed.cursor;
    if (!cursor) break;
  }
  return projects;
}

interface RecruiterProjectPickerProps {
  accountId: string | null;
  /** Identifiant du projet choisi (`filters.hiring_project`), vide pour aucun. */
  value: string;
  onChange: (projectId: string) => void;
  disabled?: boolean;
}

export const RecruiterProjectPicker: React.FC<RecruiterProjectPickerProps> = ({
  accountId,
  value,
  onChange,
  disabled,
}) => {
  const query = useQuery({
    queryKey: ['recruiter-projects', accountId],
    queryFn: () => fetchRecruiterProjects(accountId as string),
    enabled: !!accountId,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const options = useMemo(() => projectOptions(query.data ?? [], value), [query.data, value]);
  const labelId = React.useId();
  const valueId = React.useId();

  if (!accountId) return null;

  const retryable = !(query.error instanceof RecruiterProjectsError) || query.error.retryable;

  return (
    <div className="space-y-1">
      <span id={labelId} className="block text-xs text-muted-foreground">
        {RECRUITER_PROJECT_COPY.label}
      </span>

      {query.isPending && (
        <div role="status">
          <Skeleton className="h-9 w-full max-sm:h-11" aria-hidden="true" />
          <span className="sr-only">{RECRUITER_PROJECT_COPY.loading}</span>
        </div>
      )}

      {query.isError && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
          <p className="min-w-0 flex-1 text-muted-foreground">
            {query.error instanceof RecruiterProjectsError ? query.error.message : RECRUITER_PROJECT_COPY.error}
          </p>
          {retryable && (
            <Button type="button" size="sm" variant="ghost" className="max-sm:min-h-11" onClick={() => void query.refetch()}>
              {RECRUITER_PROJECT_COPY.retry}
            </Button>
          )}
        </div>
      )}

      {query.isSuccess && options.length === 0 && (
        <p className="text-sm text-muted-foreground">{RECRUITER_PROJECT_COPY.empty}</p>
      )}

      {query.isSuccess && options.length > 0 && (
        <>
          <Select
            value={value || NONE_VALUE}
            onValueChange={(next) => onChange(next === NONE_VALUE ? '' : next)}
            disabled={disabled}
          >
            <SelectTrigger aria-labelledby={`${labelId} ${valueId}`} className="h-9 w-full min-w-0 text-sm max-sm:h-11">
              <SelectValue id={valueId} placeholder={RECRUITER_PROJECT_COPY.placeholder} />
            </SelectTrigger>
            <SelectContent className="bg-background">
              <SelectItem value={NONE_VALUE}>{RECRUITER_PROJECT_COPY.noneOption}</SelectItem>
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{RECRUITER_PROJECT_COPY.help}</p>
        </>
      )}
    </div>
  );
};
