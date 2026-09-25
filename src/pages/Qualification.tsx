/**
 * Qualification d'un entretien : notes, verdict et commentaire.
 *
 * Enregistrement : les notes partent seules 10 s après la dernière frappe, le
 * verdict et son commentaire avec « Enregistrer la qualification ». L'état de
 * l'enregistrement reste affiché dans l'en-tête ; un échec le dit et propose
 * « Réessayer » (B-67). Les valeurs enregistrées du verdict (go, no_go, maybe,
 * pending) ne changent pas : seul leur libellé est traduit, en attendant le
 * vocabulaire unique des verdicts (E-16).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle, ArrowLeft, Calendar, Check, CheckCircle2, CircleHelp, Clock, ExternalLink, FileQuestion, Gauge,
  Linkedin, Loader2, MapPin, User, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { cn } from '@/lib/utils';
import { Section } from '@/components/layout/Section';
import { EmptyState } from '@/components/layout/EmptyState';
import { ErrorState } from '@/components/layout/ErrorState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

type QualificationSession = {
  id: string;
  candidate_name: string | null;
  candidate_headline: string | null;
  candidate_linkedin_url: string | null;
  candidate_profile_id: string | null;
  job_title: string | null;
  client_name: string | null;
  job_id: string | null;
  project_id?: string | null;
  event_name: string | null;
  event_start_at: string | null;
  event_end_at: string | null;
  event_location: string | null;
  invitee_email: string | null;
  scoring_summary: any;
  job_criteria: any[];
  notes: string;
  verdict: string;
  verdict_notes: string | null;
  status: string;
  created_at: string;
};

type Values = { notes: string; verdict: string; verdictNotes: string };
type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'not_found' }
  | { status: 'ready'; session: QualificationSession };
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const AUTOSAVE_DELAY_MS = 10_000;

// Libellés d'affichage : la valeur enregistrée reste go, no_go, maybe ou pending.
const VERDICT_OPTIONS: Array<{ value: string; label: string; icon: LucideIcon; selected: string }> = [
  {
    value: 'go',
    label: 'Qualifié',
    icon: CheckCircle2,
    selected: 'data-[state=on]:border-success/40 data-[state=on]:bg-success-muted data-[state=on]:text-success',
  },
  {
    value: 'no_go',
    label: 'Non qualifié',
    icon: XCircle,
    selected: 'data-[state=on]:border-danger/40 data-[state=on]:bg-danger-muted data-[state=on]:text-danger',
  },
  {
    value: 'maybe',
    label: 'À revoir',
    icon: CircleHelp,
    selected: 'data-[state=on]:border-warning/40 data-[state=on]:bg-warning-muted data-[state=on]:text-warning',
  },
  {
    value: 'pending',
    label: 'En attente',
    icon: Clock,
    selected: 'data-[state=on]:border-border-strong data-[state=on]:bg-muted data-[state=on]:text-foreground',
  },
];

// Recommandation du scoring IA : jamais la clé brute (E-50).
const RECOMMENDATION_LABELS: Record<string, string> = {
  shortlist: 'Recommandé',
  go: 'Recommandé',
  skip: 'Non recommandé',
  no_go: 'Non recommandé',
  maybe: 'À évaluer',
  strong_match: 'Très bonne adéquation',
  good_match: 'Bonne adéquation',
  possible_match: 'Adéquation possible',
  potential: 'Adéquation possible',
  weak_match: 'Adéquation faible',
  weak: 'Adéquation faible',
  no_match: 'Pas d’adéquation',
};

function recommendationLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return RECOMMENDATION_LABELS[value.trim().toLowerCase()] ?? null;
}

function scoreTone(score: number): string {
  if (score >= 70) return 'text-success';
  if (score >= 50) return 'text-warning';
  return 'text-danger';
}

const SaveIndicator: React.FC<{
  state: SaveState;
  dirty: boolean;
  savedAt: Date | null;
  onRetry: () => void;
}> = ({ state, dirty, savedAt, onRetry }) => {
  let content: React.ReactNode = null;
  if (state === 'saving') {
    content = (
      <>
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Enregistrement…
      </>
    );
  } else if (state === 'error') {
    content = (
      <>
        <AlertTriangle className="h-3.5 w-3.5 text-danger" aria-hidden="true" />
        <span className="text-danger">Échec de l'enregistrement</span>
        <Button variant="outline" size="xs" onClick={onRetry} className="ml-1 min-h-11 md:min-h-0">
          Réessayer
        </Button>
      </>
    );
  } else if (dirty) {
    content = (
      <>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />
        Modifications non enregistrées
      </>
    );
  } else if (savedAt) {
    content = (
      <>
        <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
        Enregistré à {format(savedAt, 'HH:mm')}
      </>
    );
  }
  return (
    <div role="status" aria-live="polite" className="flex min-h-7 items-center gap-1.5 text-xs text-muted-foreground">
      {content}
    </div>
  );
};

const PageSkeleton: React.FC = () => (
  <div className="flex-1 bg-background" aria-busy="true">
    <span className="sr-only" role="status">Chargement de la qualification</span>
    <div className="border-b border-border">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
        <Skeleton className="h-8 w-20" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
    </div>
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-3">
      <div className="space-y-6">
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
      <div className="space-y-6 lg:col-span-2">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    </div>
  </div>
);

export default function Qualification() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [notes, setNotes] = useState('');
  const [verdict, setVerdict] = useState('pending');
  const [verdictNotes, setVerdictNotes] = useState('');
  // Dernières valeurs écrites en base : la comparaison dit ce qui reste à enregistrer.
  const [saved, setSaved] = useState<Values | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const valuesRef = useRef<Values>({ notes, verdict, verdictNotes });
  valuesRef.current = { notes, verdict, verdictNotes };
  const savedRef = useRef<Values | null>(null);
  const sessionRef = useRef<QualificationSession | null>(null);
  // Les enregistrements passent l'un après l'autre : un enregistrement automatique
  // lent ne peut pas écraser des notes plus récentes.
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const retryRef = useRef<(() => void) | null>(null);

  const fetchSession = useCallback(async () => {
    if (!id) {
      setLoad({ status: 'not_found' });
      return;
    }
    setLoad({ status: 'loading' });
    const { data, error } = await supabase
      .from('qualification_sessions')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('[Qualification] lecture impossible :', error);
      // Identifiant mal formé : rien à réessayer.
      setLoad(error.code === '22P02' ? { status: 'not_found' } : { status: 'error' });
      return;
    }
    if (!data) {
      setLoad({ status: 'not_found' });
      return;
    }
    const session = data as unknown as QualificationSession;
    const values: Values = {
      notes: session.notes || '',
      verdict: session.verdict || 'pending',
      verdictNotes: session.verdict_notes || '',
    };
    sessionRef.current = session;
    savedRef.current = values;
    setSaved(values);
    setNotes(values.notes);
    setVerdict(values.verdict);
    setVerdictNotes(values.verdictNotes);
    setSaveState('idle');
    setSavedAt(null);
    setLoad({ status: 'ready', session });
  }, [id]);

  useEffect(() => {
    void fetchSession();
  }, [fetchSession]);

  const persist = useCallback(
    (kind: 'notes' | 'all') => {
      const run = async () => {
        const prev = savedRef.current;
        const session = sessionRef.current;
        if (!id || !prev || !session) return;
        const current = valuesRef.current;
        if (kind === 'notes' && current.notes === prev.notes) return;

        const updates: Record<string, unknown> =
          kind === 'notes'
            ? { notes: current.notes, status: 'in_progress' }
            : {
                notes: current.notes,
                verdict: current.verdict,
                verdict_notes: current.verdictNotes,
                status: current.verdict !== 'pending' ? 'completed' : 'in_progress',
              };
        if (kind === 'all' && current.verdict !== 'pending' && current.verdict !== prev.verdict) {
          updates.verdict_at = new Date().toISOString();
        }

        setSaveState('saving');
        // La ligne relue prouve l'écriture : un refus des droits répond sans erreur sur 0 ligne.
        const { data, error } = await supabase
          .from('qualification_sessions')
          .update(updates)
          .eq('id', id)
          .select('id');

        if (error || !data || data.length === 0) {
          console.error('[Qualification] enregistrement impossible :', error ?? 'aucune ligne modifiée');
          retryRef.current = () => {
            void persist(kind);
          };
          setSaveState('error');
          if (kind === 'all') {
            toast.error("La qualification n'a pas été enregistrée. Vérifiez votre connexion, puis réessayez.");
          }
          return;
        }

        const next: Values =
          kind === 'notes'
            ? { ...prev, notes: current.notes }
            : { notes: current.notes, verdict: current.verdict, verdictNotes: current.verdictNotes };
        savedRef.current = next;
        setSaved(next);
        setSavedAt(new Date());
        setSaveState('saved');
        retryRef.current = null;
        if (kind === 'notes') return;

        // Report du verdict sur l'étape du candidat (go et no_go seulement).
        if ((current.verdict === 'go' || current.verdict === 'no_go') && session.candidate_profile_id && session.job_id) {
          const stage = current.verdict === 'go' ? 'Qualifié' : 'Rejeté';
          const { data: sync, error: syncError } = await invokeEdgeFunction('update-candidate-stage', {
            candidateId: session.candidate_profile_id,
            jobId: session.job_id,
            stage,
            status: stage,
          });
          if (syncError || !sync?.success) {
            console.warn('[Qualification] étape du candidat non mise à jour :', syncError ?? sync?.error);
            const pipelinePath = session.project_id ? `/missions/${session.project_id}?tab=pipeline` : '/pipeline';
            toast.warning(
              "Qualification enregistrée, mais l'étape du candidat n'a pas été mise à jour. Modifiez-la depuis le pipeline.",
              { action: { label: 'Ouvrir le pipeline', onClick: () => navigate(pipelinePath) } },
            );
            return;
          }
        }
        toast.success('Qualification enregistrée');
      };
      const chained = queueRef.current.then(run, run);
      queueRef.current = chained.catch(() => undefined);
      return chained;
    },
    [id, navigate],
  );

  // Notes : enregistrement automatique 10 s après la dernière frappe.
  useEffect(() => {
    if (!saved || notes === saved.notes) return;
    const timer = setTimeout(() => {
      void persist('notes');
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [notes, saved, persist]);

  const goBack = () => {
    // Ouverte dans un nouvel onglet ou par un lien direct, la page n'a pas de page précédente dans l'application.
    if (location.key !== 'default') navigate(-1);
    else navigate('/calendar');
  };

  const backButton = (
    <Button variant="ghost" size="sm" onClick={goBack} className="-ml-2 min-h-11 shrink-0 sm:min-h-0">
      <ArrowLeft aria-hidden="true" />
      Retour
    </Button>
  );

  if (load.status === 'loading') return <PageSkeleton />;

  if (load.status === 'error' || load.status === 'not_found') {
    return (
      <div className="flex-1 bg-background">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <div className="mb-6">{backButton}</div>
          <div className="mx-auto max-w-md">
            {load.status === 'error' ? (
              <ErrorState
                title="Impossible de charger la qualification"
                description="Vérifiez votre connexion, puis réessayez."
                onRetry={() => void fetchSession()}
              />
            ) : (
              <EmptyState
                icon={FileQuestion}
                title="Qualification introuvable"
                description="Cet entretien n'existe plus, ou votre compte n'y a pas accès."
                action={
                  <Button asChild variant="outline" className="min-h-11 md:min-h-0">
                    <Link to="/calendar">Ouvrir l'agenda</Link>
                  </Button>
                }
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  const session = load.session;
  const scoring = session.scoring_summary || {};
  const recoLabel = recommendationLabel(scoring.recommendation);
  const dirty =
    !!saved && (notes !== saved.notes || verdict !== saved.verdict || verdictNotes !== saved.verdictNotes);
  const subtitle = [session.job_title, session.client_name].filter(Boolean).join(' · ');
  const hasScoring = scoring.overall_score != null || scoring.strengths?.length > 0 || scoring.weaknesses?.length > 0;

  return (
    <div className="flex-1 bg-background text-foreground">
      <div className="sticky top-0 z-sticky border-b border-border bg-background">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            {backButton}
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold sm:text-xl">
                {session.candidate_name ? `Qualification\u00a0: ${session.candidate_name}` : 'Qualification'}
              </h1>
              {subtitle && <p className="truncate text-sm text-muted-foreground">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <SaveIndicator
              state={saveState}
              dirty={dirty}
              savedAt={savedAt}
              onRetry={() => retryRef.current?.()}
            />
            <Button
              variant="primary"
              onClick={() => void persist('all')}
              loading={saveState === 'saving'}
              className="min-h-11 shrink-0 sm:min-h-0"
            >
              Enregistrer la qualification
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <Section title="Candidat" icon={User} headingLevel={2} padded>
            <div className="space-y-3">
              <div>
                <p className="text-md font-medium text-foreground">{session.candidate_name || 'Nom non renseigné'}</p>
                {session.candidate_headline && (
                  <p className="text-sm text-muted-foreground">{session.candidate_headline}</p>
                )}
              </div>
              {session.invitee_email && <p className="text-sm text-muted-foreground">{session.invitee_email}</p>}
              {session.candidate_linkedin_url && (
                <a
                  href={session.candidate_linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 md:min-h-0 items-center gap-1.5 rounded-md text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Linkedin className="h-3.5 w-3.5 text-linkedin" aria-hidden="true" />
                  Profil LinkedIn
                  <ExternalLink className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                  <span className="sr-only">(nouvel onglet)</span>
                </a>
              )}
            </div>
          </Section>

          <Section title="Rendez-vous" icon={Calendar} headingLevel={2} padded>
            <div className="space-y-2 text-sm">
              {session.event_name && <p className="font-medium text-foreground">{session.event_name}</p>}
              {session.event_start_at && (
                <p className="text-muted-foreground">
                  {format(new Date(session.event_start_at), "EEEE d MMMM yyyy 'à' HH:mm", { locale: fr })}
                </p>
              )}
              {session.event_location && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {session.event_location.startsWith('http') ? (
                    <a
                      href={session.event_location}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 md:min-h-0 items-center truncate rounded-md font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Rejoindre la visio
                    </a>
                  ) : (
                    <span>{session.event_location}</span>
                  )}
                </div>
              )}
              {!session.event_name && !session.event_start_at && !session.event_location && (
                <p className="text-muted-foreground">Aucun rendez-vous associé.</p>
              )}
            </div>
          </Section>

          {hasScoring && (
            <Section title="Scoring IA" icon={Gauge} headingLevel={2} padded>
              <div className="space-y-4">
                {scoring.overall_score != null && (
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="tabular-nums">
                      <span className={cn('text-2xl font-semibold', scoreTone(Number(scoring.overall_score)))}>
                        {scoring.overall_score}
                      </span>
                      <span className="text-sm text-muted-foreground"> / 100</span>
                    </p>
                    {recoLabel && <Badge variant="muted">{recoLabel}</Badge>}
                  </div>
                )}

                {scoring.strengths?.length > 0 && (
                  <div>
                    <h3 className="mb-1.5 text-xs font-medium text-foreground">Points forts</h3>
                    <ul className="space-y-1">
                      {scoring.strengths.map((s: string, i: number) => (
                        <li key={i} className="flex items-start gap-1.5 text-sm text-muted-foreground">
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {scoring.weaknesses?.length > 0 && (
                  <div>
                    <h3 className="mb-1.5 text-xs font-medium text-foreground">Points faibles</h3>
                    <ul className="space-y-1">
                      {scoring.weaknesses.map((w: string, i: number) => (
                        <li key={i} className="flex items-start gap-1.5 text-sm text-muted-foreground">
                          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
                          {w}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Section>
          )}
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Section title="Notes de l'entretien" headingLevel={2} padded>
            <p id="qualif-notes-aide" className="mb-3 text-sm text-muted-foreground">
              Prenez vos notes pendant l'entretien : elles s'enregistrent seules, 10 secondes après votre dernière frappe.
            </p>
            <Textarea
              aria-label="Notes de l'entretien"
              aria-describedby="qualif-notes-aide"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Motivation, disponibilité, prétentions salariales, adéquation au poste…"
              className="min-h-72 resize-y"
            />
          </Section>

          <Section title="Verdict" headingLevel={2} padded>
            <p id="qualif-verdict-aide" className="mb-3 text-sm text-muted-foreground">
              Votre avis à l'issue de l'entretien, enregistré avec « Enregistrer la qualification ».
            </p>
            <ToggleGroup
              type="single"
              role="radiogroup"
              aria-label="Verdict"
              aria-describedby="qualif-verdict-aide"
              variant="outline"
              value={verdict}
              onValueChange={(value) => {
                if (value) setVerdict(value);
              }}
              className="grid grid-cols-2 gap-2 sm:grid-cols-4"
            >
              {VERDICT_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                return (
                  <ToggleGroupItem
                    key={opt.value}
                    value={opt.value}
                    className={cn('h-11 justify-start gap-2 px-3 text-muted-foreground', opt.selected)}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {opt.label}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>

            <div className="mt-5 space-y-2">
              <Label htmlFor="qualif-verdict-commentaire">Commentaire du verdict</Label>
              <Textarea
                id="qualif-verdict-commentaire"
                value={verdictNotes}
                onChange={(e) => setVerdictNotes(e.target.value)}
                placeholder="Raison de votre décision, prochaines étapes…"
                className="min-h-24"
              />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
