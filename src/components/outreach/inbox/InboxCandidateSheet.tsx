import { useRef, useState, type ComponentProps } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { CandidateDetailModal } from '@/components/ats/CandidateDetailModal';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { InboxCandidateProfileError, useInboxCandidateProfile } from '@/hooks/useInboxCandidateProfile';
import { useInboxCandidateRecord, type InboxCandidateRecordInput } from '@/hooks/useInboxCandidateRecord';
import type { ATSCandidate } from '@/hooks/useATSData';
import type { LinkedInProfile } from '@/components/outreach/types';
import { hasCandidateProfileDetails, mergeCandidateProfileDetails, normalizeCandidateProfile } from '@/lib/candidateProfile';
import { parseDate } from '@/components/outreach/dateUtils';
import { ATS_LABEL_TO_STAGE, setCandidateStages } from '@/lib/candidateStage';
import { invalidateStageReaders } from '@/lib/stageDisplay';
import { supabase } from '@/integrations/supabase/client';

export interface InboxCandidateSheetProps {
  identity: InboxCandidateRecordInput;
  onClose: () => void;
  onCloseAutoFocus?: ComponentProps<typeof SheetContent>['onCloseAutoFocus'];
  onChanged?: () => void;
  profile?: LinkedInProfile;
}
type Props = InboxCandidateSheetProps;

/** Le même dossier que le pipeline, ouvert sans quitter le fil de discussion. */
export function InboxCandidateSheet(props: Props) {
  const { user } = useAuthReady();
  const { organizationId } = useOrganization();
  const identityKey = JSON.stringify([user?.id, organizationId, props.identity.chatId, props.identity.candidateId, props.identity.profileId, props.identity.aliases, props.identity.profileUrl, props.identity.projectId]);
  return <ScopedCandidateSheet key={identityKey} {...props} />;
}

function ScopedCandidateSheet(props: Props) {
  const record = useInboxCandidateRecord(props.identity);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const replacingSheet = useRef(false);
  const candidate = record.data?.candidates.find(item => item.id === chosenId)
    ?? (!record.data?.requiresChoice ? record.data?.candidates[0] : undefined);
  if (candidate) {
    replacingSheet.current = true;
    return <CandidateRecordSheet key={`${candidate.id}:${candidate.projectId}`} {...props} candidate={candidate} pipelineAttached={record.data!.pipelineAttached} />;
  }
  replacingSheet.current = false;

  return <Sheet open onOpenChange={open => { if (!open) props.onClose(); }}>
    <SheetContent className="!w-full !max-w-[100vw] min-w-0 overflow-y-auto bg-background sm:!w-[95vw] sm:!max-w-[720px]" onCloseAutoFocus={event => {
      // Le choix d'une mission remplace cette fenêtre par la fiche commune.
      if (replacingSheet.current) event.preventDefault();
      else props.onCloseAutoFocus?.(event);
    }}>
      <SheetHeader className="pr-10 text-left"><SheetTitle>Fiche de {props.identity.name || props.identity.profileName || 'ce candidat'}</SheetTitle><SheetDescription>{record.data?.requiresChoice ? 'Choisissez la candidature à consulter.' : 'Retrouvez son profil et son suivi.'}</SheetDescription></SheetHeader>
      <div className="mt-6 space-y-3">
        {record.isLoading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Ouverture de la fiche…</p>}
        {record.isError && <><p role="status" className="text-sm text-muted-foreground">Impossible de retrouver la fiche pour le moment.</p><Button variant="outline" className="min-h-11" aria-disabled={record.isFetching || undefined} onClick={() => { if (!record.isFetching) void record.refetch(); }}>{record.isFetching ? 'Chargement…' : 'Réessayer'}</Button></>}
        {record.data?.requiresChoice && record.data.candidates.map(item => <Button key={item.id} variant="ghost" className="h-auto min-h-11 w-full justify-start whitespace-normal rounded-lg border border-border text-left hover:border-foreground" onClick={() => { replacingSheet.current = true; setChosenId(item.id); }}>{item.missionName || item.jobTitle || 'Mission'} · {item.stage}</Button>)}
      </div>
    </SheetContent>
  </Sheet>;
}

function CandidateRecordSheet({ candidate, pipelineAttached, ...props }: Props & { candidate: ATSCandidate; pipelineAttached: boolean }) {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const changingStage = useRef(false);
  const query = useInboxCandidateProfile({ ...props.identity, aliases: [...new Set([candidate.candidateId, ...(props.identity.aliases ?? [])])] });
  const savedProfile = candidate.linkedinProfileData ? normalizeCandidateProfile(candidate.linkedinProfileData, candidate.candidateId, candidate.name) : null;
  const profile = mergeCandidateProfileDetails(mergeCandidateProfileDetails(savedProfile, props.profile ?? null), query.data ?? null);
  const detailedProfile = profile && {
    ...profile,
    work_experience: profile.work_experience?.map(job => ({ ...job, start: parseDate(job.start), end: parseDate(job.end) })),
    education: profile.education?.map(school => ({ ...school, school_logo: school.school_picture_url, start: parseDate(school.start), end: parseDate(school.end) })),
  };
  const displayedCandidate = {
    ...candidate,
    linkedinProfileData: detailedProfile ?? candidate.linkedinProfileData,
    headline: profile?.headline || candidate.headline,
    pictureUrl: profile?.profile_picture_url || candidate.pictureUrl,
  };
  const refreshReaders = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['inbox-candidate-record'] }),
      invalidateStageReaders(queryClient),
    ]);
    props.onChanged?.();
  };
  const changeStage = async (_id: string, stage: string) => {
    const target = ATS_LABEL_TO_STAGE[stage];
    if (!pipelineAttached || !organizationId || !target || changingStage.current) return;
    changingStage.current = true;
    try {
      const result = await setCandidateStages(candidate.groupIds?.length ? candidate.groupIds : [candidate.sourceId], target, undefined, { surface: 'inbox' });
      if (result.error || result.refused || result.skipped || result.untreatedIds.length) {
        toast.error("Le changement d’étape n’a pas été enregistré. Réessayez depuis la mission.");
      } else toast.success('Étape mise à jour');
      await refreshReaders();
    } catch { toast.error("Le changement d’étape n’a pas été enregistré."); }
    finally { changingStage.current = false; }
  };
  const changeTags = async (_id: string, tags: string[]) => {
    if (!pipelineAttached || !organizationId) return;
    const { error } = await supabase.from('job_candidate_status').update({ tags }).eq('organization_id', organizationId).in('id', candidate.groupIds?.length ? candidate.groupIds : [candidate.sourceId]);
    if (error) toast.error('Les étiquettes n’ont pas été enregistrées.');
    else await refreshReaders();
  };
  const error = query.refresh.error ?? query.error;
  const errorMessage = error instanceof InboxCandidateProfileError ? error.message : 'Le profil est temporairement indisponible.';
  const profileStatus = <div className="mb-5 space-y-3">
    {query.isFetching && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Chargement du profil…</p>}
    {error && <p role="status" className="text-sm text-muted-foreground">{errorMessage}{profile && ' Les informations déjà chargées restent affichées.'}</p>}
    {!!profile?.throttled_sections?.length && <p role="status" className="text-sm text-muted-foreground">{hasCandidateProfileDetails(profile) ? 'Certaines rubriques LinkedIn sont temporairement limitées. Les informations disponibles restent affichées.' : 'LinkedIn limite temporairement l’accès au détail de ce profil. Réessayez plus tard.'}</p>}
    {profile && !hasCandidateProfileDetails(profile) && !profile.throttled_sections?.length && !query.isFetching && !error && <p role="status" className="text-sm text-muted-foreground">Le parcours détaillé n’est pas disponible pour le moment.</p>}
    {query.isError && <Button variant="outline" className="min-h-11" aria-disabled={query.isFetching || undefined} onClick={() => { if (!query.isFetching) void query.refetch(); }}>{query.isFetching ? 'Chargement…' : 'Réessayer'}</Button>}
    {query.canRefresh && <Button variant="outline" className="min-h-11" disabled={query.refresh.isPending || query.isFetching} onClick={() => query.refresh.mutate()}>{query.refresh.isPending ? 'Actualisation…' : 'Actualiser depuis LinkedIn'}</Button>}
    {!query.canRefresh && !profile && !query.isFetching && !error && <p className="text-sm text-muted-foreground">Connectez votre compte LinkedIn pour consulter le profil détaillé.</p>}
  </div>;
  return <CandidateDetailModal candidate={displayedCandidate} pipelineAttached={pipelineAttached} accountPolicy="personal" initialTab="profile" profileStatus={profileStatus} onClose={props.onClose} onCloseAutoFocus={props.onCloseAutoFocus} onStageChange={changeStage} onTagsChange={changeTags} onRefresh={() => { void refreshReaders(); }} />;
}
