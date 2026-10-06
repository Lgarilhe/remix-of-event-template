import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PersonAvatar } from '@/components/ui/person-avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useAuthReady } from '@/hooks/useAuthReady';
import { LINKEDIN_QUOTA_STATUS_QUERY_KEY, useLinkedInQuotaStatus } from '@/hooks/useLinkedInQuotaStatus';
import { useMyLinkedInAccountId } from '@/hooks/useMyLinkedInAccountId';
import { useOrganization } from '@/hooks/useOrganization';
import { useSourcingProjects } from '@/hooks/useSourcingProjects';
import {
  addCandidateFromLinkedIn,
  searchPeopleByName,
  type AddFromLinkedInResult,
} from '@/lib/linkedinQuickFind';
import {
  missionLabel,
  openMissionOptions,
  pickSearchApi,
  quotaLeft,
  type LinkedInPerson,
  type MissionOption,
} from '@/lib/linkedinQuickFindModel';
import { plural } from '@/lib/plural';
import { SETTINGS_PATHS } from '@/lib/settingsRoutes';

const NO_MISSION = '__none__';

/**
 * « Pas dans l'app ? » : chercher la personne sur LinkedIn par son nom, puis
 * l'ajouter comme candidat, dans une mission si on en choisit une (« À trier »),
 * sinon dans la recherche « Candidats ajoutés depuis un appel ».
 *
 * Une recherche par clic sur « Chercher », avec le compte LinkedIn de la
 * personne connectée seulement, jamais de relance automatique : un refus de
 * LinkedIn ou du quota s'affiche tel quel. Le quota du jour restant est montré.
 */
export const LinkedInCandidateFinder = ({
  defaultQuery,
  onAdded,
}: {
  defaultQuery: string;
  onAdded: (result: AddFromLinkedInResult, mission: MissionOption | null) => void;
}) => {
  const { organizationId } = useOrganization();
  const { user } = useAuthReady();
  const accountId = useMyLinkedInAccountId();
  const { accounts } = useLinkedInAccounts();
  const queryClient = useQueryClient();
  const { projects } = useSourcingProjects();
  const { data: quota } = useLinkedInQuotaStatus(accountId);
  const [query, setQuery] = useState(defaultQuery);
  const [searching, setSearching] = useState(false);
  const [people, setPeople] = useState<LinkedInPerson[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [missionId, setMissionId] = useState<string>(NO_MISSION);

  const missions = useMemo(() => openMissionOptions(projects), [projects]);
  const left = quotaLeft(quota);

  if (!accountId) {
    return (
      <p className="text-sm text-muted-foreground">
        Votre compte LinkedIn n'est pas relié, ou doit être reconnecté.{' '}
        <Link to={SETTINGS_PATHS.connections} className="text-foreground underline underline-offset-2">
          Ouvrir les connexions
        </Link>
      </p>
    );
  }

  const api = pickSearchApi(accounts.find((a) => a.id === accountId)?.subscriptions);
  const quotaReached = left !== null && !left.canSearch;
  const canSearch = query.trim().length >= 2 && !searching && addingId === null && !quotaReached;
  const chosenMission = missions.find((m) => m.id === missionId) ?? null;

  const refreshQuota = () => queryClient.invalidateQueries({ queryKey: [LINKEDIN_QUOTA_STATUS_QUERY_KEY] });

  const search = async () => {
    if (!canSearch) return;
    setSearching(true);
    setErrorMessage(null);
    try {
      const result = await searchPeopleByName({ accountId, api, name: query });
      if (result.status === 'ok') setPeople(result.people);
      else {
        setPeople(null);
        setErrorMessage(result.error.message);
      }
    } finally {
      setSearching(false);
      void refreshQuota();
    }
  };

  const add = async (person: LinkedInPerson) => {
    if (!organizationId || !user) return;
    setAddingId(person.id);
    try {
      const result = await addCandidateFromLinkedIn({
        organizationId,
        userId: user.id,
        accountId,
        person,
        missionId: chosenMission?.id ?? null,
      });
      // La recherche « Candidats ajoutés depuis un appel » a pu être créée à l'instant.
      await queryClient.invalidateQueries({ queryKey: ['sourcing-projects'] });
      onAdded(result, chosenMission);
    } catch (e) {
      console.warn('[LinkedInCandidateFinder]', e);
      toast.error("Le candidat n'a pas pu être ajouté. Réessayez.");
    } finally {
      setAddingId(null);
      void refreshQuota();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void search();
              }
            }}
            placeholder="Prénom et nom"
            aria-label="Nom à chercher sur LinkedIn"
            className="pl-8"
            autoComplete="off"
          />
        </div>
        <Button type="button" variant="outline" size="sm" disabled={!canSearch} loading={searching} onClick={() => void search()} className="shrink-0">
          Chercher
        </Button>
      </div>

      {errorMessage && (
        <p role="alert" className="text-sm text-foreground">
          {errorMessage}
        </p>
      )}
      {quotaReached && (
        <p role="alert" className="text-sm text-foreground">
          Le quota de recherches LinkedIn du jour est atteint pour votre compte. Réessayez demain.
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="linkedin-add-mission">
          Mission <span className="font-normal text-muted-foreground">(facultatif)</span>
        </Label>
        <Select value={missionId} onValueChange={setMissionId} disabled={addingId !== null}>
          <SelectTrigger id="linkedin-add-mission">
            <SelectValue placeholder="Aucune pour l'instant" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_MISSION}>Aucune pour l'instant</SelectItem>
            {missions.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {missionLabel(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {chosenMission
            ? `Le candidat arrive dans « À trier » de cette mission.`
            : 'Sans mission, il est rangé dans la recherche « Candidats ajoutés depuis un appel ».'}
        </p>
      </div>

      {people !== null && people.length === 0 && !errorMessage && (
        <p className="text-sm text-muted-foreground">Aucun profil trouvé. Essayez avec le prénom et le nom.</p>
      )}

      {people !== null && people.length > 0 && (
        <ul className="divide-y divide-border">
          {people.map((person) => (
            <li key={person.id} className="flex items-center gap-3 py-2">
              <PersonAvatar name={person.name} src={person.pictureUrl} size={32} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{person.name}</p>
                {person.headline && <p className="truncate text-xs text-muted-foreground" title={person.headline}>{person.headline}</p>}
                {person.location && <p className="truncate text-xs text-muted-foreground" title={person.location}>{person.location}</p>}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0"
                disabled={addingId !== null || searching}
                loading={addingId === person.id}
                onClick={() => void add(person)}
                aria-label={`Ajouter ${person.name} comme candidat`}
              >
                Ajouter
              </Button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        La recherche utilise votre compte LinkedIn, une fois par clic sur « Chercher ».
        {left && ` Il vous reste aujourd'hui ${plural(left.searches, 'recherche')} et ${plural(left.profileViews, 'profil lu', 'profils lus')}.`}
      </p>
    </div>
  );
};
