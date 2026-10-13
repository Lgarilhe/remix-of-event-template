import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
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
  const [value, setValue] = useState('');
  const [missionId, setMissionId] = useState('');
  const { data: mission, isLoading: missionLoading, error: missionError } = useSourcingProject(missionId || undefined);
  const [dialog, setDialog] = useState<{ message: string; mission?: SourcingProject } | null>(null);
  const disabled = loading || accountsLoading || (!!missionId && (missionLoading || !mission || !!missionError));
  const open = () => { if (!disabled && !dialog) setDialog({ message: value.trim(), mission: missionId ? mission : undefined }); };
  const confirm = async (brief: JobDetails, source: SourcingSource) => {
    if (!dialog) return;
    const saved = dialog.mission
      ? await saveGuidedBrief(dialog.mission, brief, updateProject)
      : await createProject({ name: brief.title!.trim(), kind: 'search', job_details: brief, description: brief.raw_brief, silent: true });
    const path = saved.kind === 'search' ? `/sourcing/${saved.id}` : missionV3Path(saved.id, 'sourcing');
    navigate(path, { state: { phrase: 'Chercher selon le cadrage et les critères validés.', source } });
    setDialog(null); setValue('');
  };
  return <section aria-labelledby="dashboard-sourcing-title">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 id="dashboard-sourcing-title" className="text-lg font-semibold">Trouver des candidats</h2>
      <Button asChild variant="link" size="sm" className="min-h-11 px-0"><Link to="/sourcing">Mes recherches</Link></Button>
    </div>
    <Card className="space-y-4 p-4 sm:p-5">
      <p className="text-sm text-muted-foreground">Décrivez le profil. L’assistant complète le cadrage avec vous avant de chercher, avec ou sans compte LinkedIn relié.</p>
      <form onSubmit={event => { event.preventDefault(); open(); }} className="space-y-3">
        <label className="block space-y-1.5 text-sm">Pour une mission ou une nouvelle recherche
          <Select value={missionId || 'new'} disabled={loading} onValueChange={value => setMissionId(value === 'new' ? '' : value)}>
            <SelectTrigger aria-label="Contexte de la recherche" className="min-h-11"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="new">Nouvelle recherche</SelectItem>
              {projects.filter(p => p.status === 'active' && p.kind !== 'search').map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <Textarea aria-label="Profil à rechercher depuis l’accueil" rows={3} maxLength={6000} value={value} onChange={e => setValue(e.target.value)} placeholder="Par exemple : un développeur React senior à Lyon, passé par une scale-up."
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); open(); } }} />
        {error && <p role="alert" className="text-sm">Les missions n’ont pas pu être chargées : {error}</p>}
        {missionError && <p role="alert" className="text-sm">Le cadrage de cette mission n’a pas pu être chargé. Choisissez une autre mission ou une nouvelle recherche.</p>}
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Vous pourrez ajuster les critères et leur importance.</p><Button type="submit" variant="primary" disabled={disabled} className="min-h-11"><Search aria-hidden="true" />Préparer la recherche</Button></div>
      </form>
    </Card>
    {dialog && <SourcingInterviewDialog initialBrief={dialog.mission?.job_details ?? {}} initialMessage={dialog.message}
      initialSource={accounts.length ? 'linkedin' : 'database'} linkedinAvailable={accounts.length > 0}
      onClose={() => setDialog(null)} onConfirm={confirm} />}
  </section>;
}
