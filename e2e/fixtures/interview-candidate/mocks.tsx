/* eslint-disable react-refresh/only-export-components -- Harnais local de parcours. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ATSCandidate } from '@/hooks/useATSData';
import type { CandidateFullProfile } from '@/hooks/useCandidateFullProfile';

export const MISSION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const MISSION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const SESSION_A = '11111111-1111-4111-8111-111111111111';
export const SESSION_B = '22222222-2222-4222-8222-222222222222';
export const ORG = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
interface ReadRecord { table: string; filters: Record<string, unknown> }
interface GridProps {
  candidate: ATSCandidate;
  qualificationSessionId?: string | null;
  autoGenerate?: boolean;
  autoOpenFirst?: boolean;
  autoStartCoaching?: boolean;
}
declare global {
  interface Window {
    interviewQA: {
      scenario: string;
      reads: ReadRecord[];
      writes: number;
      microphone: number;
      prepared: string[];
      grids: GridProps[];
      failSession: boolean;
      releaseSession?: () => void;
      releaseSnapshot?: () => void;
      navigate?: (to: string) => void;
    };
  }
}

function candidate(projectId: string, id: string): ATSCandidate {
  return {
    id, candidateId: 'same-person', name: 'Samira Legrand', projectId, jobId: null,
    jobTitle: projectId === MISSION_A ? 'Mission Alpha' : 'Mission Bêta',
    stage: 'Nouveau', source: 'local', sourceId: id, email: null, phone: null, linkedin: null,
    headline: 'Développeuse', expertise: [], entity: null, lastActivity: '', createdAt: '',
    linkedinProfileData: null, tags: [],
  };
}
const candidates = [candidate(MISSION_A, 'row-a'), candidate(MISSION_B, 'row-b')];
export const ATS_STAGES = [{ key: 'Nouveau', label: 'Nouveau' }];
export const countPeople = () => 1;
export const useOrganization = () => ({ organizationId: ORG });
export const useAuthReady = () => ({ user: { id: 'recruiter-one' }, isReady: true });
export const missionIdOfJob = (value: string | null) => value && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined;
export const useATSData = () => ({
  candidates, loading: false, error: null, refetch: async () => {},
  handleStageChange() {}, moveCandidates() {}, undoStageMoves() {}, refreshStageReaders: async () => {}, handleTagsChange() {},
});
const fullProfile: CandidateFullProfile = {
  qualificationSessions: [], sequenceEnrollments: [], sequenceSteps: [], inmailsSent: [],
  scoringHistory: [], accountId: null, airtableMatch: null, airtableShortlists: [],
  airtableNotes: [], airtableAppointments: [], aircallCalls: [], timeline: [], loading: false,
};
export const useCandidateFullProfile = () => fullProfile;
export const useMyLinkedInAccountId = () => null;
export const useAgent = () => ({ openAgent() {} });
export const getCandidateContacts = async () => null;

async function read(table: string, filters: Record<string, unknown>) {
  const qa = window.interviewQA;
  qa.reads.push({ table, filters });
  if (table === 'qualification_sessions') {
    if (qa.scenario === 'slow-session' && filters.id === SESSION_A) await new Promise<void>(resolve => { qa.releaseSession = resolve; });
    if (qa.failSession) return { data: null, error: { message: 'Connexion indisponible' } };
    if (qa.scenario === 'missing-session') return { data: null, error: null };
    return { data: { id: filters.id, candidate_profile_id: filters.candidate_profile_id,
      project_id: qa.scenario === 'no-mission' ? null : filters.id === SESSION_A ? MISSION_A : MISSION_B,
      manager_id: qa.scenario === 'reassigned' ? 'recruiter-two' : null, created_by: 'recruiter-one',
      candidate_name: 'Samira Legrand', candidate_headline: 'Développeuse', candidate_linkedin_url: null,
      invitee_email: 'samira@example.test', job_title: 'Échange de découverte', created_at: '2026-10-10T09:00:00Z', updated_at: '2026-10-10T09:00:00Z' }, error: null };
  }
  if (table === 'job_candidate_status') {
    if (qa.scenario === 'slow-profile') await new Promise<void>(resolve => { qa.releaseSnapshot = resolve; });
    if (filters.candidate_id === 'new-person') return { data: null, error: null };
    return { data: { linkedin_profile_data: { name: 'Samira Legrand', headline: 'Développeuse', summary: 'Parcours chargé pour préparer la grille', work_experience: [{ role: 'Développeuse', company: 'Atelier', company_logo: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E', start: { year: 2020 } }], skills: ['TypeScript'] } }, error: null };
  }
  if (table === 'candidate_notes' || table === 'candidate_reminders') return { data: [], error: null };
  throw new Error(`Lecture inattendue : ${table}`);
}
export const supabase = {
  from(table: string) {
    const filters: Record<string, unknown> = {};
    const chain = {
      select: () => chain,
      eq: (key: string, value: unknown) => { filters[key] = value; return chain; },
      not: () => chain, limit: () => chain, order: () => chain,
      maybeSingle: () => read(table, filters),
      then: (resolve: (data: unknown) => unknown, reject?: (error: unknown) => unknown) => read(table, filters).then(resolve, reject),
      insert: () => { window.interviewQA.writes++; throw new Error('Écriture interdite dans le harnais'); },
      update: () => { window.interviewQA.writes++; throw new Error('Écriture interdite dans le harnais'); },
      delete: () => { window.interviewQA.writes++; throw new Error('Écriture interdite dans le harnais'); },
    };
    return chain;
  },
};

/** Le parent réel construit les onglets ; le cadre ne lance aucun service annexe. */
export function ProfileDetailSheet({ extraTabs, initialTab, onOpenChange, pipelineMeta }: {
  extraTabs: { key: string; label: string; content: ReactNode }[];
  initialTab?: string;
  onOpenChange: (open: boolean) => void;
  pipelineMeta: { stage: string; onStageChange?: unknown; onTagsChange?: unknown; onCreatePortalLink?: unknown };
}) {
  const [tab, setTab] = useState(initialTab ?? 'overview');
  return <section role="dialog" aria-label="Fiche Samira" className="max-w-full p-4">
    <button className="min-h-11" onClick={() => onOpenChange(false)}>Fermer la fiche</button>
    <output aria-label="État dans le pipeline">{pipelineMeta.stage}</output>
    <output aria-label="Actions du pipeline">{String(!!(pipelineMeta.onStageChange || pipelineMeta.onTagsChange || pipelineMeta.onCreatePortalLink))}</output>
    <div role="tablist">{extraTabs.map(item => <button role="tab" aria-selected={item.key === tab} key={item.key} onClick={() => setTab(item.key)}>{item.label}</button>)}</div>
    <div role="tabpanel">{extraTabs.find(item => item.key === tab)?.content}</div>
  </section>;
}
export function ScorecardTab(props: GridProps) {
  const prepared = useRef(false);
  useEffect(() => {
    window.interviewQA.grids.push(props);
    if (props.autoGenerate && !prepared.current) {
      prepared.current = true;
      window.interviewQA.prepared.push(`${props.candidate.projectId}:${props.qualificationSessionId}`);
    }
  }, [props]);
  return <section aria-label="Grille ouverte">
    <p>{props.candidate.jobTitle}</p>
    <output aria-label="Entretien relié">{props.qualificationSessionId}</output>
    <output aria-label="Mission de la grille">{props.candidate.projectId ?? 'aucune'}</output>
    <output aria-label="Poste de la grille">{props.candidate.jobId ?? 'aucun'}</output>
    <output aria-label="Préparation autorisée">{String(!!props.autoGenerate)}</output>
    <output aria-label="Ouverture immédiate">{String(!!props.autoOpenFirst)}</output>
    <output aria-label="Assistant ouvert">{String(!!props.autoStartCoaching)}</output>
    <output aria-label="Parcours disponible">{props.candidate.linkedinProfileData?.summary ?? ''}</output>
  </section>;
}

export const SEOHead = () => null;
export const ATSKanban = () => <p>Pipeline</p>;
export const ATSTable = () => null;
export const ATSTimeline = () => null;
export const ATSTimelineSkeleton = () => null;
export const ATSPipelineAnalytics = () => null;
export const ATSPipelineAnalyticsSkeleton = () => null;
export const ATSFilters = () => null;
export const ATSStats = () => null;
export const ATSKanbanSkeleton = () => null;
export const ATSTableSkeleton = () => null;
export const RemindersSidebar = () => null;
export const JobDetailSheet = () => null;
export const BulkActionsBar = () => null;
export const CandidateSequencesPanel = () => null;
export const ActivityTab = () => null;
export const NotesTab = () => null;
export const ActionsTab = () => null;
export const CVTab = () => null;
export const OverviewTab = () => <p>Aperçu du profil</p>;
export const ProfileDetailedTab = () => <p>Parcours du candidat</p>;
export const ManualContactsEditor = () => null;
export const CardMessageThread = () => null;
export const PrepSheetTab = () => null;
export const FraudDetectionTab = () => null;
export const ScoringCard = () => null;
export const ScorePill = () => null;
export const CandidateAvatar = () => <span aria-hidden="true">SL</span>;
