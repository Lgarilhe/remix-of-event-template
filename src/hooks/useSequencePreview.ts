/**
 * Aperçu réel des messages dans l'éditeur unique de séquence (lot 5d-2).
 *
 * Candidats de l'aperçu, dans l'ordre : les inscrits de la séquence, puis les
 * Retenus de la mission (mission_candidate_rows), puis l'exemple fictif. Les
 * deux lectures se font sous la RLS de la personne connectée : un candidat
 * qu'elle ne voit pas n'apparaît jamais.
 *
 * Valeurs des variables : un appel preview_values (fonction draft-sequence du
 * lot 5d-1), qui les calcule comme le moteur à l'envoi : les inscriptions par
 * leur identifiant (relues par le serveur sous la même RLS, avec leur
 * expéditeur), les Retenus avec les colonnes que l'inscription écrira. Un
 * candidat effacé (RGPD) est retiré de la liste ; son nom n'est jamais
 * affiché, car aucun nom ne s'affiche avant la réponse du serveur.
 *
 * Rien n'est écrit, ni en base ni dans le stockage du navigateur : les
 * valeurs vivent dans l'état de ce hook.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { normalizeNetworkDistance } from '@/lib/sequenceCompatibility';
import { EXAMPLE_CANDIDATE_NAME, exampleVariableValues } from '@/lib/sequenceVariables';
import {
  fetchPreviewValuesPage,
  type PreviewProfilePayload,
  type PreviewValuesEntry,
} from '@/hooks/usePreviewValues';

/** Candidats réels demandés au plus (un seul appel : le serveur en accepte 20). */
export const EDITOR_PREVIEW_CANDIDATES = 10;
/** Délai après la dernière frappe avant de redemander les valeurs d'une nouvelle variable. */
const KEYS_DEBOUNCE_MS = 400;

export type PreviewSubjectKind = 'enrolled' | 'retained' | 'example';

export interface PreviewSubject {
  /** Inscription, candidat de la mission, ou « exemple ». */
  id: string;
  kind: PreviewSubjectKind;
  name: string;
  entry: PreviewValuesEntry;
}

interface CandidateRef {
  id: string;
  kind: 'enrolled' | 'retained';
  name: string;
  profile?: PreviewProfilePayload;
}

type CandidatesState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; refs: CandidateRef[] };

type ValuesState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; entries: Map<string, PreviewValuesEntry>; sendTime: Record<string, string> };

export interface SequencePreview {
  /** 'loading' : lectures ou valeurs en cours ; 'error' : aperçu réel indisponible (l'exemple reste). */
  status: 'loading' | 'ready' | 'error';
  /** Candidats prêts à l'affichage, l'exemple en dernier. */
  subjects: PreviewSubject[];
  /** Variables de l'heure d'envoi, annoncées entre crochets. */
  sendTime: Readonly<Record<string, string>>;
  /** Aucun candidat réel : l'aperçu ne montre que l'exemple. */
  exampleOnly: boolean;
  retry: () => void;
}

// Colonnes typées `string` : la lecture des chemins JSON (->>) dépasse sinon la profondeur des types générés.
const ENROLLED_COLUMNS: string = 'id, profile_name, profile_url, erased:tracking_data->>gdpr_erased_at';
const MISSION_COLUMNS: string = 'name, title:job_details->>title';
const RETAINED_COLUMNS: string = 'candidate_id, candidate_name, candidate_headline, linkedin_profile_url, provider:linkedin_profile_data->>provider_id, distance:linkedin_profile_data->>network_distance';

const slug = (url: string | null | undefined) => (url ?? '').trim().toLowerCase().replace(/\/+$/, '');

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

interface Options {
  organizationId: string | null;
  /** Séquence enregistrée ; null pour une séquence pas encore créée. */
  sequenceId: string | null;
  missionId: string | null;
  /** Variables des textes de la séquence (templateKeys). */
  keys: readonly string[];
  /** Faux tant qu'aucune étape à message n'est ouverte : rien n'est lu. */
  enabled: boolean;
}

export function useSequencePreview({ organizationId, sequenceId, missionId, keys, enabled }: Options): SequencePreview {
  const [candidates, setCandidates] = useState<CandidatesState>({ status: 'loading' });
  const [values, setValues] = useState<ValuesState>({ status: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const sortedKeys = useMemo(() => [...keys].sort(), [keys]);
  const keysParam = useDebounced(sortedKeys.join(','), KEYS_DEBOUNCE_MS);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const candidatesKey = `${organizationId ?? ''}|${sequenceId ?? ''}|${missionId ?? ''}|${attempt}`;

  // Candidats : inscrits, puis Retenus de la mission (une fois par contexte).
  useEffect(() => {
    if (!enabled || !organizationId || loadedFor === candidatesKey) return;
    let cancelled = false;
    setCandidates({ status: 'loading' });
    void (async () => {
      try {
        const [enrolledRes, missionRes, retainedRes] = await Promise.all([
          sequenceId
            ? supabase
              .from('sequence_enrollments')
              .select(ENROLLED_COLUMNS)
              .eq('sequence_id', sequenceId)
              .eq('organization_id', organizationId)
              .order('created_at', { ascending: false })
              .limit(EDITOR_PREVIEW_CANDIDATES)
            : Promise.resolve({ data: [], error: null }),
          missionId
            ? supabase.from('sourcing_projects').select(MISSION_COLUMNS).eq('id', missionId).maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          missionId
            ? supabase
              .from('mission_candidate_rows')
              .select(RETAINED_COLUMNS)
              .eq('project_id', missionId)
              .eq('organization_id', organizationId)
              .eq('general_stage', 'retained')
              .order('stage_entered_at', { ascending: false })
              .limit(EDITOR_PREVIEW_CANDIDATES)
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (cancelled) return;
        if (enrolledRes.error || missionRes.error || retainedRes.error) {
          console.warn('[useSequencePreview] candidats illisibles :', enrolledRes.error ?? missionRes.error ?? retainedRes.error);
          setCandidates({ status: 'error' });
          setLoadedFor(candidatesKey);
          return;
        }
        const refs: CandidateRef[] = [];
        const seen = new Set<string>();
        for (const row of (enrolledRes.data ?? []) as unknown as Array<{ id: string; profile_name: string | null; profile_url: string | null; erased: string | null }>) {
          if (row.erased) continue;
          refs.push({ id: row.id, kind: 'enrolled', name: row.profile_name?.trim() || 'Candidat inscrit' });
          if (row.profile_url) seen.add(slug(row.profile_url));
        }
        const mission = missionRes.data as unknown as { name: string | null; title: string | null } | null;
        const jobTitle = mission?.title?.trim() || mission?.name?.trim() || null;
        type RetainedRow = { candidate_id: string | null; candidate_name: string | null; candidate_headline: string | null; linkedin_profile_url: string | null; provider: string | null; distance: string | null };
        for (const row of (retainedRes.data ?? []) as unknown as RetainedRow[]) {
          if (refs.length >= EDITOR_PREVIEW_CANDIDATES) break;
          if (!row.candidate_id || (row.linkedin_profile_url && seen.has(slug(row.linkedin_profile_url)))) continue;
          if (row.linkedin_profile_url) seen.add(slug(row.linkedin_profile_url));
          refs.push({
            id: row.candidate_id,
            kind: 'retained',
            name: row.candidate_name?.trim() || 'Candidat retenu',
            profile: {
              id: row.candidate_id,
              provider_id: row.provider ?? null,
              profile_name: row.candidate_name ?? null,
              profile_headline: row.candidate_headline ?? null,
              profile_url: row.linkedin_profile_url ?? null,
              job_title: jobTitle,
              network_distance: normalizeNetworkDistance(row.distance ?? undefined),
            },
          });
        }
        setCandidates({ status: 'ready', refs: refs.slice(0, EDITOR_PREVIEW_CANDIDATES) });
        setLoadedFor(candidatesKey);
      } catch (err) {
        if (cancelled) return;
        console.warn('[useSequencePreview] candidats illisibles :', err);
        setCandidates({ status: 'error' });
        setLoadedFor(candidatesKey);
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, organizationId, sequenceId, missionId, candidatesKey, loadedFor]);

  // Valeurs : un appel pour tous les candidats, refait quand les variables changent
  // (pas à chaque étape ouverte : les valeurs déjà lues pour ces variables restent).
  const refs = candidates.status === 'ready' ? candidates.refs : null;
  const valuesFor = useRef<{ refs: CandidateRef[]; keys: string } | null>(null);
  useEffect(() => {
    if (!enabled || !organizationId || !refs) return;
    if (valuesFor.current?.refs === refs && valuesFor.current.keys === keysParam) return;
    valuesFor.current = { refs, keys: keysParam };
    if (refs.length === 0) {
      setValues({ status: 'ready', entries: new Map(), sendTime: {} });
      return;
    }
    const requested = keysParam ? keysParam.split(',') : [];
    let cancelled = false;
    let settled = false;
    setValues({ status: 'loading' });
    const profiles = refs.flatMap((r) => (r.profile ? [r.profile] : []));
    const enrollmentIds = refs.filter((r) => r.kind === 'enrolled').map((r) => r.id);
    void fetchPreviewValuesPage(
      { organizationId, missionId, sequenceId, accountId: null, keys: requested },
      profiles,
      enrollmentIds,
    ).then((page) => {
      if (cancelled) return;
      settled = true;
      if (page.kind === 'failed') setValues({ status: 'error', message: page.message });
      else setValues({ status: 'ready', entries: page.entries, sendTime: page.sendTime });
    }).catch((err) => {
      if (cancelled) return;
      settled = true;
      console.warn('[useSequencePreview] preview_values en échec :', err);
      setValues({ status: 'error', message: '' });
    });
    return () => {
      cancelled = true;
      // Réponse abandonnée en route : elle sera redemandée.
      if (!settled && valuesFor.current?.refs === refs && valuesFor.current.keys === keysParam) valuesFor.current = null;
    };
  }, [enabled, organizationId, sequenceId, missionId, refs, keysParam]);

  const retry = useCallback(() => {
    setLoadedFor(null);
    setAttempt((n) => n + 1);
  }, []);

  return useMemo(() => {
    const example: PreviewSubject = {
      id: 'exemple',
      kind: 'example',
      name: EXAMPLE_CANDIDATE_NAME,
      entry: { status: 'ready', values: exampleVariableValues(), atSend: {}, missing: [] },
    };
    if (candidates.status === 'loading' || (refs && refs.length > 0 && (values.status === 'loading' || values.status === 'idle'))) {
      return { status: 'loading', subjects: [example], sendTime: {}, exampleOnly: false, retry };
    }
    if (candidates.status === 'error' || values.status === 'error') {
      return { status: 'error', subjects: [example], sendTime: {}, exampleOnly: false, retry };
    }
    const entries = values.status === 'ready' ? values.entries : new Map<string, PreviewValuesEntry>();
    const real: PreviewSubject[] = [];
    for (const ref of refs ?? []) {
      const entry = entries.get(ref.id);
      // Effacé (RGPD) : jamais montré. Absent de la réponse (hors RLS) : jamais montré non plus.
      if (!entry || (entry.status === 'unavailable' && !entry.retryable)) continue;
      real.push({ id: ref.id, kind: ref.kind, name: ref.name, entry });
    }
    return {
      status: 'ready',
      subjects: [...real, example],
      sendTime: values.status === 'ready' ? values.sendTime : {},
      exampleOnly: real.length === 0,
      retry,
    };
  }, [candidates.status, refs, values, retry]);
}
