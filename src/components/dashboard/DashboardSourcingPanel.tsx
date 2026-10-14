import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { SearchHero } from '@/components/outreach/search/SourcingFlow';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSourcingProjects, useSourcingProject, type SourcingProject } from '@/hooks/useSourcingProjects';
import { useFilteredLinkedInAccounts } from '@/hooks/useFilteredLinkedInAccounts';
import { SourcingInterviewDialog } from '@/components/outreach/search/SourcingInterviewDialog';
import { saveGuidedBrief } from '@/lib/guidedSourcing';
import { missionV3Path } from '@/lib/missionBeta';
import type { JobDetails } from '@/types/jobDetails';
import type { SourcingSource } from '@/components/outreach/search/SourcingSourcePicker';

export function DashboardSourcingPanel({ projects, loading, error }: { projects: SourcingProject[]; loading: boolean; error: string | null }) {
  const navigate = useNavigate();
  const { createProject, updateProject } = useSourcingProjects();
  const { accounts, accountsLoading } = useFilteredLinkedInAccounts();
  const [openingFilters, setOpeningFilters] = useState(false);
  const openingFiltersRef = useRef(false);
  const [missionId, setMissionId] = useState('');
  const { data: mission, isLoading: missionLoading, error: missionError } = useSourcingProject(missionId || undefined);
  const [dialog, setDialog] = useState<{ message: string; mission?: SourcingProject } | null>(null);
  const disabled = openingFilters || loading || accountsLoading || (!!missionId && (missionLoading || !mission || !!missionError));
  const open = (phrase: string) => { if (!disabled && !dialog) setDialog({ message: phrase, mission: missionId ? mission : undefined }); };
  const configureFilters = async () => {
    if (disabled || openingFiltersRef.current) return;
    openingFiltersRef.current = true; setOpeningFilters(true);
    try {
      const target = missionId ? mission! : await createProject({ name: 'Nouvelle recherche', kind: 'search' });
      navigate(target.kind === 'search' ? `/sourcing/${target.id}` : missionV3Path(target.id, 'sourcing'), { state: { filters: true } });
    } catch { /* Le hook affiche l’erreur ; le prompt reste disponible. */ }
    finally { openingFiltersRef.current = false; setOpeningFilters(false); }
  };
  const confirm = async (brief: JobDetails, source: SourcingSource) => {
    if (!dialog) return;
    const saved = dialog.mission
      ? await saveGuidedBrief(dialog.mission, brief, updateProject)
      : await createProject({ name: brief.title!.trim(), kind: 'search', job_details: brief, description: brief.raw_brief, silent: true });
    const path = saved.kind === 'search' ? `/sourcing/${saved.id}` : missionV3Path(saved.id, 'sourcing');
    navigate(path, { state: { phrase: 'Chercher selon le cadrage et les critères validés.', source } });
    setDialog(null);
  };
  return <section aria-label="Trouver des candidats">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Select value={missionId || 'new'} disabled={disabled || !!dialog} onValueChange={value => setMissionId(value === 'new' ? '' : value)}>
        <SelectTrigger aria-label="Contexte de la recherche" className="w-auto max-w-full max-sm:min-h-11"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="new">Nouvelle recherche</SelectItem>
          {projects.filter(p => p.status === 'active' && p.kind !== 'search').map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button asChild variant="link" size="sm" className="max-sm:min-h-11 px-0"><Link to="/sourcing">Mes recherches</Link></Button>
    </div>
    <SearchHero variant="mission-v3" guided jobTitle={mission?.name ?? ''} history={[]} onResumeHistory={() => {}}
      className="min-h-0 px-0 pt-8 sm:pt-10 pb-4"
      promptLabel="Profil à rechercher depuis l’accueil" onLaunch={open} onConfigureFilters={() => void configureFilters()} disabled={disabled || !!dialog} />
    {error && <p role="alert" className="text-sm">Les missions n’ont pas pu être chargées : {error}</p>}
    {missionError && <p role="alert" className="text-sm">Le cadrage de cette mission n’a pas pu être chargé. Choisissez une autre mission ou une nouvelle recherche.</p>}
    {dialog && <SourcingInterviewDialog initialBrief={dialog.mission?.job_details ?? {}} initialMessage={dialog.message}
      initialSource={accounts.length ? 'linkedin' : 'database'} linkedinAvailable={accounts.length > 0}
      onClose={() => setDialog(null)} onConfirm={confirm} />}
  </section>;
}
