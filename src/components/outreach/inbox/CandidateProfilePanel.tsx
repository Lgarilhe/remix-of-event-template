import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CandidateProfileContent } from './CandidateProfileContent';
import { useInboxCandidateProfile, type CandidateProfileIdentity } from '@/hooks/useInboxCandidateProfile';

export function CandidateProfilePanel(props: CandidateProfileIdentity) {
  const query = useInboxCandidateProfile(props);
  if (query.isLoading) return <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Chargement du profil…</p>;
  if (query.isError) return <div className="space-y-3"><p role="status" className="text-sm text-muted-foreground">Impossible de charger le profil pour le moment.</p><Button variant="outline" size="sm" className="min-h-11" onClick={() => void query.refetch()}>Réessayer</Button></div>;
  if (!query.data) return <p className="text-sm text-muted-foreground">Aucun profil détaillé enregistré. Connectez votre compte LinkedIn pour le consulter ici.</p>;
  return <div className="space-y-5"><CandidateProfileContent profile={query.data} />{query.canRefresh && <div className="space-y-2 border-t border-border pt-4"><Button variant="outline" size="sm" className="min-h-11 w-full" disabled={query.refresh.isPending} onClick={() => query.refresh.mutate()}>{query.refresh.isPending ? 'Actualisation…' : 'Actualiser depuis LinkedIn'}</Button>{query.refresh.isError && <p role="status" className="text-xs text-muted-foreground">Actualisation indisponible. Le profil enregistré reste affiché.</p>}</div>}</div>;
}
