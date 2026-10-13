/* eslint-disable react-refresh/only-export-components -- Frontières du harnais sans serveur. */
type Row = Record<string, unknown>;
type Result = { data: unknown; error: null };
export interface ScorecardSessionQA {
  calls: { name: string; body: Record<string, unknown> }[];
  reads: { table: string; filters: Record<string, unknown> }[];
  manualGenerations: number;
  ready: boolean;
  latePending: boolean;
  lateReleased: boolean;
  releaseLate: () => void;
}
declare global { interface Window { scorecardSessionQA: ScorecardSessionQA } }

const scenario = new URLSearchParams(window.location.search).get('case') ?? 'ready';
const qa: ScorecardSessionQA = window.scorecardSessionQA = {
  calls: [], reads: [], manualGenerations: 0, ready: false,
  latePending: false, lateReleased: false, releaseLate: () => { throw new Error('Aucune réponse différée'); },
};

function evaluation(session: string): Row {
  const second = session === 'session-second';
  return {
    id: `evaluation-${session}`, qualification_session_id: session,
    candidate_id: 'candidate-fixture', organization_id: 'org-fixture',
    project_id: 'mission-fixture', created_by: 'recruiter-fixture',
    job_id: null, job_title: 'Product Designer', process_step_id: null,
    criteria: [{ id: 'criterion', label: second ? 'Architecture du deuxième entretien' : 'Recherche du premier entretien',
      description: 'Décrivez une décision issue des entretiens utilisateurs.',
      category: 'technical', weight: 2, suggestedQuestions: ['Quel résultat avez-vous mesuré ?'] }],
    ratings: {}, comments: {}, overall_score: null, recommendation: null,
    summary: null, follow_up_notes: null, interview_stage: 'technique',
    created_at: second ? '2026-10-10T10:00:00Z' : '2026-10-09T10:00:00Z',
    updated_at: '2026-10-10T10:00:00Z',
  };
}

const evaluations = [evaluation('session-second'), ...(['ready', 'ready-assistant'].includes(scenario) ? [evaluation('session-first')] : [])];
const sessions = ['session-first', 'session-second'].map(id => ({
  id, organization_id: 'org-fixture', candidate_profile_id: 'candidate-fixture',
  project_id: 'mission-fixture', created_by: 'recruiter-fixture',
  manager_id: scenario === 'blocked' ? 'other-recruiter' : 'recruiter-fixture',
}));

export const supabase = {
  auth: { getUser: async () => ({ data: { user: { id: 'recruiter-fixture' } }, error: null }) },
  from(table: string) {
    if (!['qualification_sessions', 'candidate_evaluations'].includes(table)) throw new Error(`Lecture inattendue : ${table}`);
    const filters: Record<string, unknown> = {};
    const execute = () => {
      qa.reads.push({ table, filters: { ...filters } });
      const rows: Row[] = table === 'qualification_sessions' ? sessions : evaluations;
      return rows.filter(row => Object.entries(filters).every(([key, value]) => row[key] === value));
    };
    return {
      select() { return this; },
      eq(key: string, value: unknown) { filters[key] = value; return this; },
      is(key: string, value: unknown) { filters[key] = value; return this; },
      order: async () => ({ data: execute(), error: null }),
      maybeSingle: async () => ({ data: execute()[0] ?? null, error: null }),
      update() { throw new Error('Écriture inattendue : aucune note modifiée dans ce scénario'); },
      insert() { throw new Error('Création de grille inattendue'); },
    };
  },
};

export const useOrganization = () => ({ organizationId: 'org-fixture' });
export const missionIdOfJob = () => undefined;
export const isInsufficientCreditsError = () => false;
export const ModelPicker = () => null;
export const LiveCoachingPanel = ({ qualificationSessionId, meetingLocation }: { qualificationSessionId: string; meetingLocation?: string }) => {
  if (scenario !== 'ready-assistant') throw new Error('Assistant audio ouvert sans demande');
  return <section aria-label="Assistant prêt">
    <output aria-label="Entretien de l’assistant">{qualificationSessionId}</output>
    <output aria-label="Visio de l’assistant">{meetingLocation}</output>
    <button>Démarrer l’enregistrement</button>
  </section>;
};
export const invokeWithCredits = () => { qa.manualGenerations++; throw new Error('Génération manuelle payante inattendue'); };

export async function invokeEdgeFunction(name: string, body: Record<string, unknown>): Promise<Result> {
  qa.calls.push({ name, body });
  if (name !== 'generate-scorecard' || body.qualificationSessionId !== 'session-first'
    || body.organization_id !== 'org-fixture' || body.background !== true) throw new Error('Préparation hors entretien');
  if (scenario === 'switch') {
    qa.latePending = true;
    return new Promise(resolve => {
      qa.releaseLate = () => {
        qa.lateReleased = true;
        resolve({ data: { status: 'ready', evaluation: evaluation('session-first') }, error: null });
      };
    });
  }
  if (scenario === 'failed' && body.retry !== true) return { data: { status: 'failed', error: 'Préparation interrompue. Réessayez.' }, error: null };
  if (scenario === 'preparing' && !qa.ready) return { data: { status: 'preparing' }, error: null };
  return { data: { status: 'ready', evaluation: evaluation(scenario === 'wrong-session' ? 'session-second' : 'session-first') }, error: null };
}
