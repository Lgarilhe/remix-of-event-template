import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PersonAvatar } from '@/components/ui/person-avatar';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useMyLinkedInAccountId } from '@/hooks/useMyLinkedInAccountId';
import { useOrganization } from '@/hooks/useOrganization';
import {
  addCandidateFromLinkedIn,
  searchPeopleByName,
  type AddFromLinkedInResult,
} from '@/lib/linkedinQuickFind';
import { pickSearchApi, type LinkedInPerson } from '@/lib/linkedinQuickFindModel';
import { SETTINGS_PATHS } from '@/lib/settingsRoutes';

/**
 * « Pas dans l'app ? » : chercher la personne sur LinkedIn par son nom, puis
 * l'ajouter comme candidat. Une recherche par clic sur « Chercher », avec le
 * compte LinkedIn de la personne connectée seulement, jamais de relance
 * automatique : un refus de LinkedIn ou du quota s'affiche tel quel.
 */
export const LinkedInCandidateFinder = ({
  defaultQuery,
  onAdded,
}: {
  defaultQuery: string;
  onAdded: (result: AddFromLinkedInResult) => void;
}) => {
  const { organizationId } = useOrganization();
  const { user } = useAuthReady();
  const accountId = useMyLinkedInAccountId();
  const { accounts } = useLinkedInAccounts();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState(defaultQuery);
  const [searching, setSearching] = useState(false);
  const [people, setPeople] = useState<LinkedInPerson[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);

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
  const canSearch = query.trim().length >= 2 && !searching && addingId === null;

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
    }
  };

  const add = async (person: LinkedInPerson) => {
    if (!organizationId || !user) return;
    setAddingId(person.id);
    try {
      const result = await addCandidateFromLinkedIn({ organizationId, userId: user.id, accountId, person });
      // La recherche « Candidats ajoutés depuis un appel » a pu être créée à l'instant.
      await queryClient.invalidateQueries({ queryKey: ['sourcing-projects'] });
      onAdded(result);
    } catch (e) {
      console.warn('[LinkedInCandidateFinder]', e);
      toast.error("Le candidat n'a pas pu être ajouté. Réessayez.");
    } finally {
      setAddingId(null);
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
                {person.headline && <p className="truncate text-xs text-muted-foreground">{person.headline}</p>}
                {person.location && <p className="truncate text-xs text-muted-foreground">{person.location}</p>}
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
      </p>
    </div>
  );
};
