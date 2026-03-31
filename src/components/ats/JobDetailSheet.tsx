import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAgent } from '@/contexts/AgentContext';
import { CandidateDetailModal } from './CandidateDetailModal';
import { ATSCandidate, useATSData } from '@/hooks/useATSData';
import { cn } from '@/lib/utils';
import {
  Briefcase, Building2, MapPin, FileText, CalendarDays, X,
  ClipboardList, Users, Brain, GitBranch, Loader2, ChevronRight,
  Zap, BarChart3, Database, MessageSquare, Send, Target
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
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
  { key: 'ia' as const, label: 'IA', icon: Brain },
] as const;

type TabKey = typeof TABS[number]['key'];

/* ─── status badge color ─── */
function statusColor(status: string | null) {
  if (!status) return 'border-foreground/20 text-muted-foreground';
  const s = status.toLowerCase();
  if (['active', 'open', 'en cours'].includes(s)) return 'border-green-500 text-green-700 bg-green-50';
  if (['closed', 'fermé', 'pourvu'].includes(s)) return 'border-red-400 text-red-600 bg-red-50';
  if (['paused', 'pause'].includes(s)) return 'border-amber-400 text-amber-600 bg-amber-50';
  return 'border-foreground/20 text-muted-foreground';
}

export function JobDetailSheet({ jobId, open, onOpenChange }: JobDetailSheetProps) {
  const [tab, setTab] = useState<TabKey>('fiche');
  const [jobInfo, setJobInfo] = useState<JobInfo | null>(null);
  const [loading, setLoading] = useState(false);

  // Candidates tab
  const { candidates: allCandidates } = useATSData();
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

      const { data: proj } = await supabase
        .from('sourcing_projects')
        .select('*')
        .eq('job_id', jobId)
        .limit(1)
        .maybeSingle();

      if (proj) {
        info.jobTitle = proj.job_title;
        info.clientName = proj.client_name;
        info.description = proj.description;
        info.notes = proj.notes;
        info.calendlyLink = proj.calendly_link;
        info.filtersSnapshot = proj.filters_snapshot;
        info.status = proj.status;
        info.createdAt = proj.created_at;
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
    supabase
      .from('knowledge_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('entity_id', jobId)
      .then(({ count }) => setRagCount(count ?? 0));
  }, [jobId, open, tab]);

  /* ─── score summary ─── */
  const scoreSummary = useMemo(() => {
    const scored = jobCandidates.filter(c => c.score != null);
    if (scored.length === 0) return null;
    const avg = Math.round(scored.reduce((s, c) => s + (c.score || 0), 0) / scored.length);
    const above70 = scored.filter(c => (c.score || 0) >= 70).length;
    return { avg, total: scored.length, above70 };
  }, [jobCandidates]);

  const filters = jobInfo?.filtersSnapshot as any;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="sm:w-[540px] sm:max-w-[540px] w-full p-0 border-l-2 border-foreground flex flex-col">
          {/* Header */}
          <div className="shrink-0 border-b-2 border-foreground p-4">
            <SheetHeader className="space-y-0">
              <SheetTitle className="sr-only">Détail du poste</SheetTitle>
            </SheetHeader>
            {loading ? (
              <div className="flex items-center gap-2 py-4">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Chargement…</span>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-foreground leading-tight">
                      {jobInfo?.jobTitle || 'Poste non spécifié'}
                    </h2>
                    {jobInfo?.clientName && (
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <Building2 className="w-3 h-3" /> {jobInfo.clientName}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {jobInfo?.city && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="w-3 h-3" /> {jobInfo.city}
                        </span>
                      )}
                      {jobInfo?.status && (
                        <span className={cn("text-xs px-1.5 py-0.5 border font-medium uppercase tracking-wider", statusColor(jobInfo.status))}>
                          {jobInfo.status}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {jobCandidates.length} candidat{jobCandidates.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                  {jobInfo?.calendlyLink && (
                    <a href={jobInfo.calendlyLink} target="_blank" rel="noopener noreferrer"
                      className="h-7 px-2.5 flex items-center gap-1 border border-foreground text-foreground text-xs font-bold uppercase tracking-wider hover:bg-foreground hover:text-background transition-colors shrink-0">
                      <CalendarDays className="w-3 h-3" /> Calendly
                    </a>
                  )}
                </div>

                {/* Tabs */}
                <div className="flex gap-0 mt-4">
                  {TABS.map((t, i) => (
                    <button key={t.key} onClick={() => setTab(t.key)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider border border-foreground transition-colors",
                        i > 0 && "border-l-0",
                        tab === t.key
                          ? "bg-foreground text-background"
                          : "bg-background text-muted-foreground hover:bg-foreground/5"
                      )}>
                      <t.icon className="w-3 h-3" />
                      {t.label}
                      {t.key === 'candidats' && jobCandidates.length > 0 && (
                        <span className="ml-0.5 text-xs">({jobCandidates.length})</span>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Content */}
          <ScrollArea className="flex-1">
            <div className="p-4">
              {loading ? null : !jobInfo && tab === 'fiche' ? (
                <p className="text-xs text-muted-foreground py-8 text-center">Aucune information disponible</p>
              ) : (
                <>
                  {/* ── FICHE ── */}
                  {tab === 'fiche' && jobInfo && <FicheTab jobInfo={jobInfo} filters={filters} />}

                  {/* ── CANDIDATS ── */}
                  {tab === 'candidats' && (
                    <CandidatsTab
                      candidates={jobCandidates}
                      stageCounts={stageCounts}
                      onCandidateClick={setSelectedCandidate}
                    />
                  )}

                  {/* ── SÉQUENCES ── */}
                  {tab === 'sequences' && (
                    <SequencesTab sequences={sequences} loading={seqLoading} />
                  )}

                  {/* ── IA ── */}
                  {tab === 'ia' && (
                    <IATab
                      jobId={jobId}
                      ragCount={ragCount}
                      scoreSummary={scoreSummary}
                      openAgent={openAgent}
                    />
                  )}
                </>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Candidate detail modal */}
      {selectedCandidate && (
        <CandidateDetailModal
          candidate={selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
          onStageChange={() => {}}
          onTagsChange={() => {}}
          onRefresh={() => {}}
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
    { label: 'Salaire', value: jobInfo.salary || (jobInfo.salaryMin && jobInfo.salaryMax ? `${jobInfo.salaryMin}–${jobInfo.salaryMax}k€` : null) },
    { label: 'TJM', value: jobInfo.tjm ? `${jobInfo.tjm}€` : null },
    { label: 'Séniorité', value: jobInfo.seniority },
    { label: 'Remote', value: jobInfo.remote },
  ].filter(i => i.value);

  return (
    <div className="space-y-5">
      {/* Info grid */}
      {infoGrid.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {infoGrid.map(item => (
            <div key={item.label} className="border border-foreground/10 p-2.5">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{item.label}</p>
              <p className="text-[12px] text-foreground font-medium">{item.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Stack */}
      {jobInfo.stack && jobInfo.stack.length > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Stack technique</p>
          <div className="flex flex-wrap gap-1.5">
            {jobInfo.stack.map((s, i) => (
              <span key={i} className="px-2 py-0.5 border border-foreground/15 text-xs font-medium">{s}</span>
            ))}
          </div>
        </div>
      )}

      {/* Description */}
      {jobInfo.description ? (
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Description</p>
          <p className="text-xs text-foreground leading-relaxed whitespace-pre-line">{jobInfo.description}</p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground text-center py-3">Aucune description</p>
      )}

      {/* Criteria */}
      {(jobInfo.mustHave || jobInfo.shouldHave || jobInfo.niceToHave || jobInfo.criteria) && (
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Critères</p>
          {jobInfo.mustHave && <CriteriaBlock label="Must-have" content={jobInfo.mustHave} color="border-red-300" />}
          {jobInfo.shouldHave && <CriteriaBlock label="Should-have" content={jobInfo.shouldHave} color="border-amber-300" />}
          {jobInfo.niceToHave && <CriteriaBlock label="Nice-to-have" content={jobInfo.niceToHave} color="border-green-300" />}
          {jobInfo.criteria && !jobInfo.mustHave && (
            <p className="text-xs text-foreground leading-relaxed whitespace-pre-line">{jobInfo.criteria}</p>
          )}
        </div>
      )}

      {/* Filters snapshot */}
      {filters && typeof filters === 'object' && Object.keys(filters).length > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Filtres de recherche</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(filters).map(([key, value]) => {
              if (!value || (Array.isArray(value) && value.length === 0)) return null;
              const display = Array.isArray(value) ? (value as string[]).join(', ') : String(value);
              if (display.length > 100) return null;
              return (
                <span key={key} className="px-2 py-1 border border-foreground/15 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{key}:</span> {display}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Notes */}
      {jobInfo.notes && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Notes</p>
          <p className="text-xs text-foreground leading-relaxed whitespace-pre-line">{jobInfo.notes}</p>
        </div>
      )}
    </div>
  );
}

function CriteriaBlock({ label, content, color }: { label: string; content: string; color: string }) {
  return (
    <div className={cn("border-l-2 pl-3 py-1", color)}>
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{label}</p>
      <p className="text-xs text-foreground leading-relaxed whitespace-pre-line">{content}</p>
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
    return (
      <div className="text-center py-12">
        <Users className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
        <p className="text-xs text-muted-foreground uppercase tracking-wider">Aucun candidat associé</p>
      </div>
    );
  }

  const stageEntries = Object.entries(stageCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      {/* Stage counters */}
      <div className="flex flex-wrap gap-1.5">
        {stageEntries.map(([stage, count]) => (
          <span key={stage} className="text-xs px-2 py-0.5 border border-foreground/20 font-medium">
            {count} {stage}
          </span>
        ))}
      </div>

      {/* Candidate list */}
      <div className="border border-foreground divide-y divide-foreground/10">
        {candidates.map(candidate => (
          <button
            key={candidate.id}
            onClick={() => onCandidateClick(candidate)}
            className="w-full text-left px-3 py-2.5 hover:bg-foreground/5 transition-colors flex items-center gap-3 group"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-medium text-foreground truncate">{candidate.name}</span>
                {candidate.score != null && (
                  <span className={cn(
                    "text-xs font-bold px-1 py-0.5 border shrink-0",
                    candidate.score >= 70 ? 'border-foreground bg-brutal-accent' : candidate.score >= 40 ? 'border-foreground/50' : 'border-destructive text-destructive'
                  )}>
                    {candidate.score}%
                  </span>
                )}
              </div>
              {candidate.headline && (
                <p className="text-xs text-muted-foreground truncate">{candidate.headline}</p>
              )}
            </div>
            <span className="text-xs px-1.5 py-0.5 border border-foreground/20 uppercase tracking-wider font-medium shrink-0">
              {candidate.stage}
            </span>
            <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
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
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (sequences.length === 0) {
    return (
      <div className="text-center py-12">
        <GitBranch className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
        <p className="text-xs text-muted-foreground uppercase tracking-wider">Aucune séquence liée</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sequences.map(seq => {
        const responseRate = seq.sentCount > 0 ? Math.round((seq.repliedCount / seq.sentCount) * 100) : 0;
        return (
          <div key={seq.id} className="border border-foreground p-3">
            <p className="text-[12px] font-bold uppercase tracking-wider text-foreground mb-2">{seq.name}</p>
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center">
                <p className="text-lg font-bold text-foreground">{seq.enrolledCount}</p>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Enrollés</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-foreground">{seq.sentCount}</p>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Envoyés</p>
              </div>
              <div className="text-center">
                <p className={cn("text-lg font-bold", responseRate >= 20 ? "text-green-600" : "text-foreground")}>{responseRate}%</p>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Réponse</p>
              </div>
            </div>
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
  scoreSummary: { avg: number; total: number; above70: number } | null;
  openAgent: (jobId?: string) => void;
}) {
  return (
    <div className="space-y-5">
      {/* Analyze button */}
      <button
        onClick={() => jobId && openAgent(jobId)}
        className="relative overflow-hidden w-full h-10 flex items-center justify-center gap-2 border-2 border-foreground text-foreground text-xs font-bold uppercase tracking-wider group"
      >
        <Brain className="w-4 h-4 relative z-10" />
        <span className="relative z-10">Analyser ce poste avec l'Agent</span>
        <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
      </button>

      {/* RAG context */}
      <div className="border border-foreground p-3">
        <div className="flex items-center gap-2 mb-2">
          <Database className="w-4 h-4 text-foreground" />
          <p className="text-xs font-bold uppercase tracking-wider text-foreground">Contexte RAG</p>
        </div>
        {ragCount !== null ? (
          <p className="text-xs text-muted-foreground">
            <span className="font-bold text-foreground text-base">{ragCount}</span> chunk{ragCount !== 1 ? 's' : ''} indexé{ragCount !== 1 ? 's' : ''} pour ce poste
          </p>
        ) : (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Score summary */}
      <div className="border border-foreground p-3">
        <div className="flex items-center gap-2 mb-2">
          <BarChart3 className="w-4 h-4 text-foreground" />
          <p className="text-xs font-bold uppercase tracking-wider text-foreground">Scoring candidats</p>
        </div>
        {scoreSummary ? (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-lg font-bold text-foreground">{scoreSummary.avg}%</p>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Score moyen</p>
            </div>
            <div>
              <p className="text-lg font-bold text-foreground">{scoreSummary.total}</p>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Scorés</p>
            </div>
            <div>
              <p className="text-lg font-bold text-green-600">{scoreSummary.above70}</p>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">≥ 70%</p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Aucun candidat scoré</p>
        )}
      </div>
    </div>
  );
}
