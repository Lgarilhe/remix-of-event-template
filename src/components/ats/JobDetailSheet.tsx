import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAgent } from '@/contexts/AgentContext';
import { CandidateDetailModal } from './CandidateDetailModal';
import { ATSCandidate, useATSData } from '@/hooks/useATSData';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScoreBadge } from '@/components/ui/score-badge';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/layout';
import { SCORE_THRESHOLDS } from '@/lib/scoreScale';
import {
  Briefcase, Building2, MapPin, FileText, CalendarDays, X,
  ClipboardList, Users, Brain, GitBranch, Loader2, ChevronRight,
  Zap, BarChart3, Database, MessageSquare, Send, Target
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import type { JobDetails } from '@/types/jobDetails';
import { fr } from 'date-fns/locale';

/* ─── types ─── */
interface JobInfo {
  jobTitle: string | null;
  clientName: string | null;
  description: string | null;
  notes: string | null;
  calendlyLink: string | null;
  filtersSnapshot: any;
  status: string | null;
  createdAt: string | null;
  city: string | null;
  contractType: string | null;
  salary: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  tjm: number | null;
  seniority: string | null;
  remote: string | null;
  stack: string[] | null;
  criteria: string | null;
  mustHave: string | null;
  shouldHave: string | null;
  niceToHave: string | null;
  companyDescription: string | null;
}

interface SequenceStat {
  id: string;
  name: string;
  enrolledCount: number;
  sentCount: number;
  repliedCount: number;
}

interface JobDetailSheetProps {
  jobId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TABS = [
  { key: 'fiche' as const, label: 'Fiche', icon: FileText },
  { key: 'candidats' as const, label: 'Candidats', icon: Users },
  { key: 'sequences' as const, label: 'Séquences', icon: GitBranch },
  { key: 'ia' as const, label: 'Analyse', icon: BarChart3 },
] as const;

type TabKey = typeof TABS[number]['key'];

/* ─── statut de la mission : un mot en français, jamais la valeur brute (E-34) ─── */
function missionStatus(status: string | null): { label: string; tone: 'success' | 'warning' | 'muted' } | null {
  if (!status) return null;
  const s = status.toLowerCase();
  if (['active', 'open', 'en cours'].includes(s)) return { label: 'En cours', tone: 'success' };
  if (['paused', 'pause'].includes(s)) return { label: 'En pause', tone: 'warning' };
  if (['closed', 'fermé', 'pourvu', 'filled'].includes(s)) return { label: 'Terminée', tone: 'muted' };
  if (s === 'draft') return { label: 'Brouillon', tone: 'muted' };
  if (s === 'archived') return { label: 'Archivée', tone: 'muted' };
  return null;
}

/* ─── filtres de recherche : libellés de l'écran de recherche, jamais la clé technique ─── */
const FILTER_LABELS: Record<string, string> = {
  keywords: 'Mots-clés',
  location: 'Localisation',
  location_keywords: 'Localisation',
  skills: 'Compétences',
  skills_keywords: 'Compétences',
  role: 'Intitulés',
  title_keywords: 'Intitulés',
  company_keywords: 'Entreprises',
  industry: 'Secteur',
  seniority: 'Séniorité',
  languages: 'Langues',
};

function filterValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) {
    const parts = value
      .map((v) => (typeof v === 'string' ? v : v && typeof v === 'object' && 'keywords' in v ? String((v as { keywords: unknown }).keywords) : null))
      .filter((v): v is string => !!v);
    return parts.length ? parts.join(', ') : null;
  }
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return null;
}

export function JobDetailSheet({ jobId, open, onOpenChange }: JobDetailSheetProps) {
  const [tab, setTab] = useState<TabKey>('fiche');
  const [jobInfo, setJobInfo] = useState<JobInfo | null>(null);
  const [loading, setLoading] = useState(false);

  // Candidates tab
  // 🐛 BUG FIX (Opus audit) : avant, on consommait juste `candidates` ici et
  // le modal recevait `onStageChange={()=>{}}` (vide) → drag-to-stage / Select
  // dans le modal ne faisait rien silencieusement. Fix : récupérer aussi les
  // handlers depuis useATSData et les passer au modal.
  const { candidates: allCandidates, handleStageChange, handleTagsChange, refetch } = useATSData();
  const [selectedCandidate, setSelectedCandidate] = useState<ATSCandidate | null>(null);

  // Sequences tab
  const [sequences, setSequences] = useState<SequenceStat[]>([]);
  const [seqLoading, setSeqLoading] = useState(false);

  // IA tab
  const { openAgent } = useAgent();
  const [ragCount, setRagCount] = useState<number | null>(null);

  /* ─── job candidates ─── */
  const jobCandidates = useMemo(() => {
    if (!jobId) return [];
    return allCandidates.filter(c => c.jobId === jobId);
  }, [allCandidates, jobId]);

  const stageCounts = useMemo(() => {
    const map: Record<string, number> = {};
    jobCandidates.forEach(c => { map[c.stage] = (map[c.stage] || 0) + 1; });
    return map;
  }, [jobCandidates]);

  /* ─── load job info ─── */
  useEffect(() => {
    if (!jobId || !open) return;
    setTab('fiche');
    const load = async () => {
      setLoading(true);
      const info: JobInfo = {
        jobTitle: null, clientName: null, description: null, notes: null,
        calendlyLink: null, filtersSnapshot: null, status: null, createdAt: null,
        city: null, contractType: null, salary: null, salaryMin: null, salaryMax: null,
        tjm: null, seniority: null, remote: null, stack: null,
        criteria: null, mustHave: null, shouldHave: null, niceToHave: null,
        companyDescription: null,
      };

      // Un poste de mission arrive sous la forme « project:<id> » (poste
      // synthétique tiré du brief) : on lit alors la mission par son id, et le
      // brief (job_details) complète les champs vides.
      const projectId = jobId.startsWith('project:') ? jobId.slice('project:'.length) : null;
      const projectQuery = supabase.from('sourcing_projects').select('*');
      const { data: proj } = await (projectId ? projectQuery.eq('id', projectId) : projectQuery.eq('job_id', jobId))
        .limit(1)
        .maybeSingle();

      if (proj) {
        const brief = ((proj as { job_details?: unknown }).job_details ?? {}) as JobDetails;
        info.jobTitle = proj.job_title || brief.title || proj.name || null;
        info.clientName = proj.client_name || brief.client?.name || null;
        info.description = proj.description || brief.mission_description || null;
        info.notes = proj.notes;
        info.calendlyLink = proj.calendly_link;
        info.filtersSnapshot = proj.filters_snapshot;
        info.status = proj.status;
        info.createdAt = proj.created_at;
        info.city = brief.location || null;
        info.seniority = brief.seniority ? brief.seniority.replace(/^./, (c) => c.toUpperCase()) : null;
        if (brief.salary_min && brief.salary_max && brief.salary_type !== 'daily') {
          // Montants annuels en euros (65000) ou déjà en milliers (65)
          const toK = (v: number) => (v >= 1000 ? Math.round(v / 1000) : v);
          info.salaryMin = toK(brief.salary_min);
          info.salaryMax = toK(brief.salary_max);
        }
        if (brief.skills_must_have?.length) info.mustHave = brief.skills_must_have.join(', ');
        if (brief.skills_should_have?.length) info.shouldHave = brief.skills_should_have.join(', ');
        if (brief.skills_nice_to_have?.length) info.niceToHave = brief.skills_nice_to_have.join(', ');
      }

      const { data: atJob } = await supabase
        .from('airtable_jobs')
        .select('title, city, contract_type, salary, criteria, description')
        .eq('airtable_id', jobId)
        .limit(1)
        .maybeSingle();

      if (atJob) {
        if (!info.jobTitle) info.jobTitle = atJob.title;
        info.city = atJob.city;
        info.contractType = atJob.contract_type;
        info.salary = atJob.salary;
        info.criteria = atJob.criteria;
        if (!info.description) info.description = atJob.description;
      }

      setJobInfo(info);
      setLoading(false);
    };
    load();
  }, [jobId, open]);

  /* ─── load sequences ─── */
  useEffect(() => {
    if (!jobId || !open || tab !== 'sequences') return;
    const load = async () => {
      setSeqLoading(true);
      const { data: enrollments } = await supabase
        .from('sequence_enrollments')
        .select('id, sequence_id, status, connection_status, outreach_sequences (id, name)')
        .eq('job_id', jobId);

      if (enrollments && enrollments.length > 0) {
        const map = new Map<string, SequenceStat>();
        enrollments.forEach((e: any) => {
          const seqId = e.sequence_id;
          const seqName = e.outreach_sequences?.name || 'Sans nom';
          if (!map.has(seqId)) map.set(seqId, { id: seqId, name: seqName, enrolledCount: 0, sentCount: 0, repliedCount: 0 });
          const stat = map.get(seqId)!;
          stat.enrolledCount++;
          if (e.status === 'active' || e.status === 'completed') stat.sentCount++;
          if (e.connection_status === 'replied') stat.repliedCount++;
        });
        setSequences(Array.from(map.values()));
      } else {
        setSequences([]);
      }
      setSeqLoading(false);
    };
    load();
  }, [jobId, open, tab]);

  /* ─── load RAG count ─── */
  useEffect(() => {
    if (!jobId || !open || tab !== 'ia') return;
    Promise.resolve(supabase
      .from('knowledge_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('entity_id', jobId))
      .then(({ count }) => setRagCount(count ?? 0))
      .catch(() => {});
  }, [jobId, open, tab]);

  /* ─── score summary ─── */
  const scoreSummary = useMemo(() => {
    const scored = jobCandidates.filter(c => c.score != null);
    if (scored.length === 0) return null;
    const avg = Math.round(scored.reduce((s, c) => s + (c.score || 0), 0) / scored.length);
    const strong = scored.filter(c => (c.score || 0) >= SCORE_THRESHOLDS.strong).length;
    return { avg, total: scored.length, strong };
  }, [jobCandidates]);

  const filters = jobInfo?.filtersSnapshot as any;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex w-full flex-col border-l border-border p-0 sm:w-[540px] sm:max-w-[540px]">
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="flex min-h-0 flex-1 flex-col">
            {/* En-tête */}
            <div className="shrink-0 border-b border-border p-4">
              {loading ? (
                <>
                  <SheetHeader className="space-y-0">
                    <SheetTitle className="sr-only">Détail du poste</SheetTitle>
                  </SheetHeader>
                  <div className="py-4">
                    <Spinner label="Chargement du poste" />
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <SheetHeader className="space-y-0 text-left">
                        <SheetTitle className="text-base font-semibold leading-tight text-foreground">
                          {jobInfo?.jobTitle || 'Poste sans intitulé'}
                        </SheetTitle>
                      </SheetHeader>
                      {jobInfo?.clientName && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <Building2 className="h-3 w-3" aria-hidden="true" /> {jobInfo.clientName}
                        </p>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {jobInfo?.city && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <MapPin className="h-3 w-3" aria-hidden="true" /> {jobInfo.city}
                          </span>
                        )}
                        {(() => {
                          const st = missionStatus(jobInfo?.status ?? null);
                          return st ? <Badge variant={st.tone}>{st.label}</Badge> : null;
                        })()}
                        <span className="text-xs text-muted-foreground">
                          {jobCandidates.length} candidat{jobCandidates.length > 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                    {jobInfo?.calendlyLink && (
                      <Button asChild variant="outline" size="xs" className="shrink-0">
                        <a href={jobInfo.calendlyLink} target="_blank" rel="noopener noreferrer">
                          <CalendarDays aria-hidden="true" /> Calendly
                        </a>
                      </Button>
                    )}
                  </div>

                  <TabsList className="mt-4">
                    {TABS.map((t) => (
                      <TabsTrigger key={t.key} value={t.key} className="gap-1.5">
                        <t.icon className="h-3.5 w-3.5" aria-hidden="true" />
                        {t.label}
                        {t.key === 'candidats' && jobCandidates.length > 0 && (
                          <span className="tabular-nums text-muted-foreground">{jobCandidates.length}</span>
                        )}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </>
              )}
            </div>

            {/* Contenu */}
            <ScrollArea className="flex-1">
              <div className="p-4">
                {!loading && (
                  <>
                    <TabsContent value="fiche" className="mt-0">
                      {jobInfo ? (
                        <FicheTab jobInfo={jobInfo} filters={filters} />
                      ) : (
                        <EmptyState variant="compact" icon={FileText} title="Aucune information sur ce poste" />
                      )}
                    </TabsContent>
                    <TabsContent value="candidats" className="mt-0">
                      <CandidatsTab
                        candidates={jobCandidates}
                        stageCounts={stageCounts}
                        onCandidateClick={(c) => {
                          // La fiche remplace le panneau au lieu de s'empiler dessus (E-34).
                          onOpenChange(false);
                          setSelectedCandidate(c);
                        }}
                      />
                    </TabsContent>
                    <TabsContent value="sequences" className="mt-0">
                      <SequencesTab sequences={sequences} loading={seqLoading} />
                    </TabsContent>
                    <TabsContent value="ia" className="mt-0">
                      <IATab jobId={jobId} ragCount={ragCount} scoreSummary={scoreSummary} openAgent={openAgent} />
                    </TabsContent>
                  </>
                )}
              </div>
            </ScrollArea>
          </Tabs>
        </SheetContent>
      </Sheet>

      {/* Candidate detail modal */}
      {selectedCandidate && (
        <CandidateDetailModal
          candidate={selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
          onStageChange={handleStageChange}
          onTagsChange={handleTagsChange}
          onRefresh={refetch}
        />
      )}
    </>
  );
}

/* ════════════════════════════════════════
   Tab: Fiche
   ════════════════════════════════════════ */
function FicheTab({ jobInfo, filters }: { jobInfo: JobInfo; filters: any }) {
  const infoGrid = [
    { label: 'Localisation', value: jobInfo.city },
    { label: 'Contrat', value: jobInfo.contractType },
    { label: 'Salaire', value: jobInfo.salary || (jobInfo.salaryMin && jobInfo.salaryMax ? `${jobInfo.salaryMin} à ${jobInfo.salaryMax} k€` : null) },
    { label: 'TJM', value: jobInfo.tjm ? `${jobInfo.tjm} €` : null },
    { label: 'Séniorité', value: jobInfo.seniority },
    { label: 'Télétravail', value: jobInfo.remote },
  ].filter(i => i.value);

  const filterRows = filters && typeof filters === 'object'
    ? Object.entries(filters as Record<string, unknown>)
        .map(([key, value]) => ({ label: FILTER_LABELS[key], value: filterValue(value) }))
        .filter((r): r is { label: string; value: string } => !!r.label && !!r.value && r.value.length <= 160)
    : [];

  return (
    <div className="space-y-5">
      {infoGrid.length > 0 && (
        <dl className="grid grid-cols-2 gap-2">
          {infoGrid.map(item => (
            <div key={item.label} className="rounded-xl border border-border bg-card p-2.5">
              <dt className="eyebrow mb-0.5">{item.label}</dt>
              <dd className="text-xs font-medium text-foreground">{item.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {jobInfo.stack && jobInfo.stack.length > 0 && (
        <section>
          <h3 className="eyebrow mb-1.5">Stack technique</h3>
          <div className="flex flex-wrap gap-1.5">
            {jobInfo.stack.map((s, i) => (
              <Badge key={i} variant="muted">{s}</Badge>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="eyebrow mb-1.5">Description</h3>
        {jobInfo.description ? (
          <p className="whitespace-pre-line text-xs leading-relaxed text-foreground">{jobInfo.description}</p>
        ) : (
          <p className="text-xs text-muted-foreground">Aucune description.</p>
        )}
      </section>

      {(jobInfo.mustHave || jobInfo.shouldHave || jobInfo.niceToHave || jobInfo.criteria) && (
        <section className="space-y-2">
          <h3 className="eyebrow">Critères</h3>
          {jobInfo.mustHave && <CriteriaBlock label="Indispensable" content={jobInfo.mustHave} />}
          {jobInfo.shouldHave && <CriteriaBlock label="Important" content={jobInfo.shouldHave} />}
          {jobInfo.niceToHave && <CriteriaBlock label="Appréciable" content={jobInfo.niceToHave} />}
          {jobInfo.criteria && !jobInfo.mustHave && (
            <p className="whitespace-pre-line text-xs leading-relaxed text-foreground">{jobInfo.criteria}</p>
          )}
        </section>
      )}

      {filterRows.length > 0 && (
        <section>
          <h3 className="eyebrow mb-1.5">Filtres de recherche</h3>
          <dl className="space-y-1">
            {filterRows.map((row) => (
              <div key={row.label} className="flex gap-2 text-xs">
                <dt className="w-24 shrink-0 text-muted-foreground">{row.label}</dt>
                <dd className="min-w-0 text-foreground">{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {jobInfo.notes && (
        <section>
          <h3 className="eyebrow mb-1.5">Notes</h3>
          <p className="whitespace-pre-line text-xs leading-relaxed text-foreground">{jobInfo.notes}</p>
        </section>
      )}
    </div>
  );
}

function CriteriaBlock({ label, content }: { label: string; content: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <p className="mb-0.5 text-xs font-medium text-foreground">{label}</p>
      <p className="whitespace-pre-line text-xs leading-relaxed text-foreground-secondary">{content}</p>
    </div>
  );
}

/* ════════════════════════════════════════
   Tab: Candidats
   ════════════════════════════════════════ */
function CandidatsTab({
  candidates,
  stageCounts,
  onCandidateClick,
}: {
  candidates: ATSCandidate[];
  stageCounts: Record<string, number>;
  onCandidateClick: (c: ATSCandidate) => void;
}) {
  if (candidates.length === 0) {
    return <EmptyState variant="compact" icon={Users} title="Aucun candidat sur ce poste" />;
  }

  const stageEntries = Object.entries(stageCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      {/* Stage counters */}
      <div className="flex flex-wrap gap-1.5">
        {stageEntries.map(([stage, count]) => (
          <Badge key={stage} variant="outline" className="tabular-nums">
            {count} {stage}
          </Badge>
        ))}
      </div>

      {/* Candidate list */}
      <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
        {candidates.map(candidate => (
          <button
            type="button"
            key={candidate.id}
            onClick={() => onCandidateClick(candidate)}
            className="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-xs font-medium text-foreground">{candidate.name}</span>
                <ScoreBadge score={candidate.score} />
              </div>
              {candidate.headline && (
                <p className="truncate text-xs text-muted-foreground">{candidate.headline}</p>
              )}
            </div>
            <Badge variant="muted" className="shrink-0">{candidate.stage}</Badge>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   Tab: Séquences
   ════════════════════════════════════════ */
function SequencesTab({ sequences, loading }: { sequences: SequenceStat[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner label="Chargement des séquences" />
      </div>
    );
  }

  if (sequences.length === 0) {
    return <EmptyState variant="compact" icon={GitBranch} title="Aucune séquence sur ce poste" />;
  }

  return (
    <div className="space-y-3">
      {sequences.map(seq => {
        const responseRate = seq.sentCount > 0 ? Math.round((seq.repliedCount / seq.sentCount) * 100) : 0;
        return (
          <div key={seq.id} className="rounded-xl border border-border bg-card p-3">
            <p className="mb-2 text-sm font-semibold text-foreground">{seq.name}</p>
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div>
                <dd className="text-lg font-semibold tabular-nums text-foreground">{seq.enrolledCount}</dd>
                <dt className="text-xs text-muted-foreground">Inscrits</dt>
              </div>
              <div>
                <dd className="text-lg font-semibold tabular-nums text-foreground">{seq.sentCount}</dd>
                <dt className="text-xs text-muted-foreground">Contactés</dt>
              </div>
              <div>
                <dd className="text-lg font-semibold tabular-nums text-foreground">{responseRate} %</dd>
                <dt className="text-xs text-muted-foreground">Taux de réponse</dt>
              </div>
            </dl>
          </div>
        );
      })}
    </div>
  );
}

/* ════════════════════════════════════════
   Tab: IA
   ════════════════════════════════════════ */
function IATab({
  jobId,
  ragCount,
  scoreSummary,
  openAgent,
}: {
  jobId: string | null;
  ragCount: number | null;
  scoreSummary: { avg: number; total: number; strong: number } | null;
  openAgent: (jobId?: string) => void;
}) {
  return (
    <div className="space-y-4">
      <Button type="button" variant="outline" className="w-full" onClick={() => jobId && openAgent(jobId)} disabled={!jobId}>
        <MessageSquare aria-hidden="true" />
        Analyser ce poste avec l'assistant
      </Button>

      <section className="rounded-xl border border-border bg-card p-3">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Database className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Documents de la mission
        </h3>
        {ragCount !== null ? (
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold tabular-nums text-foreground">{ragCount}</span> passage{ragCount > 1 ? 's' : ''} de
            documents lu{ragCount > 1 ? 's' : ''} par l'assistant pour ce poste
          </p>
        ) : (
          <Spinner size="sm" label="Chargement" />
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-3">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
          <BarChart3 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Scores des candidats
        </h3>
        {scoreSummary ? (
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div>
              <dd className="flex justify-center"><ScoreBadge score={scoreSummary.avg} /></dd>
              <dt className="mt-1 text-xs text-muted-foreground">Score moyen</dt>
            </div>
            <div>
              <dd className="text-lg font-semibold tabular-nums text-foreground">{scoreSummary.total}</dd>
              <dt className="text-xs text-muted-foreground">Candidats scorés</dt>
            </div>
            <div>
              <dd className="text-lg font-semibold tabular-nums text-foreground">{scoreSummary.strong}</dd>
              <dt className="text-xs text-muted-foreground">Scores forts ({SCORE_THRESHOLDS.strong} et plus)</dt>
            </div>
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">Aucun candidat scoré pour l'instant.</p>
        )}
      </section>
    </div>
  );
}
