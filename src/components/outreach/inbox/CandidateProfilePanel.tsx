import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CandidateProfileContent } from './CandidateProfileContent';
import { InboxCandidateProfileError, useInboxCandidateProfile, type CandidateProfileIdentity } from '@/hooks/useInboxCandidateProfile';

export function CandidateProfilePanel(props: CandidateProfileIdentity) {
  const query = useInboxCandidateProfile(props);
  if (query.isLoading && !query.isFetched) return <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Chargement du profil…</p>;
  const errorMessage = query.error instanceof InboxCandidateProfileError ? query.error.message : 'Impossible de charger le profil pour le moment. Réessayez dans quelques instants.';
  const retry = <Button variant="outline" size="sm" className="min-h-11" aria-disabled={query.isFetching || undefined} onClick={() => { if (!query.isFetching) void query.refetch(); }}>{query.isFetching ? <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Chargement…</> : 'Réessayer'}</Button>;
  if ((query.isError || (query.isFetching && query.isFetched)) && !query.data) return <div className="space-y-3"><p role="status" className="text-sm text-muted-foreground">{query.isFetching ? 'Chargement du profil…' : errorMessage}</p>{retry}</div>;
  if (!query.data) return <p className="text-sm text-muted-foreground">Aucun profil détaillé enregistré. Connectez votre compte LinkedIn pour le consulter ici.</p>;
  return <div className="space-y-5"><CandidateProfileContent profile={query.data} />{query.isError && <div className="space-y-3"><p role="status" className="text-sm text-muted-foreground">{errorMessage} Le profil précédent reste affiché.</p>{retry}</div>}{query.canRefresh && <div className="space-y-2 border-t border-border pt-4"><Button variant="outline" size="sm" className="min-h-11 w-full" disabled={query.refresh.isPending} onClick={() => query.refresh.mutate()}>{query.refresh.isPending ? 'Actualisation…' : 'Actualiser depuis LinkedIn'}</Button>{query.refresh.isError && <p role="status" className="text-xs text-muted-foreground">{query.refresh.error instanceof InboxCandidateProfileError ? query.refresh.error.message : 'Actualisation indisponible.'} Le profil précédent reste affiché.</p>}</div>}</div>;
}
