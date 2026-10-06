import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  ArrowRight, Briefcase, Calendar, Check, CheckCircle2, Clock, ExternalLink, FileText,
  Flag, HelpCircle, Hourglass, Mail, MessageSquare, Phone, Send, Users, type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { SEOHead } from '@/components/SEOHead';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { IconTile } from '@/components/ui/IconTile';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { PublicDeadEnd } from '@/components/public/PublicDeadEnd';
import { PoweredByKonekt } from '@/components/public/PublicFooter';
import { cn } from '@/lib/utils';

interface FAQItem {
  question: string;
  answer: string;
}

interface DocumentItem {
  name: string;
  url: string;
  type?: string;
}

interface PortalData {
  candidate_name: string | null;
  job_title: string | null;
  company_name: string | null;
  company_logo_url: string | null;
  company_description: string | null;
  pipeline_stage: string | null;
  next_steps: string | null;
  updated_at: string;
  stage_updated_at: string | null;
  estimated_days_to_next: number | null;
  recruiter_name: string | null;
  recruiter_email: string | null;
  recruiter_phone: string | null;
  documents: DocumentItem[] | null;
  faq: FAQItem[] | null;
}

interface PortalStep {
  key: string;
  icon: LucideIcon;
  label: string;
  description: string;
  avgDays?: number;
}

/**
 * Étapes vues du candidat, dans l'ordre. Les clés sont celles du pipeline
 * (ATS) copiées dans le lien à sa création.
 */
const STEPS: PortalStep[] = [
  { key: 'Nouveau', icon: Users, label: 'Candidature reçue', description: 'Votre candidature a bien été reçue et est en cours de revue par notre équipe.', avgDays: 2 },
  { key: 'Contacté', icon: Send, label: 'Premier contact', description: 'Nous avons pris contact avec vous pour en savoir plus sur votre parcours.', avgDays: 3 },
  { key: 'Répondu', icon: MessageSquare, label: 'Échange en cours', description: "Nous sommes en discussion active pour évaluer l'adéquation avec le poste.", avgDays: 5 },
  { key: 'Pré-qualif', icon: Clock, label: 'Pré-qualification', description: 'Un entretien de pré-qualification est prévu pour valider les critères clés.', avgDays: 5 },
  { key: 'CV envoyé', icon: FileText, label: 'Dossier transmis au client', description: 'Votre dossier a été présenté à notre client. Nous attendons son retour.', avgDays: 7 },
  { key: 'ITW en cours', icon: Calendar, label: 'Entretiens client', description: 'Les entretiens avec le client sont en cours. Bonne chance !', avgDays: 10 },
  { key: 'Offre', icon: Briefcase, label: "Proposition d'embauche", description: 'Une proposition est en cours de finalisation. Vous êtes presque au bout !', avgDays: 5 },
  { key: 'Gagné', icon: CheckCircle2, label: 'Processus finalisé', description: 'Le processus est terminé avec succès. Félicitations !' },
];

/** Étapes du pipeline sans équivalent propre côté candidat. */
const STEP_ALIASES: Record<string, string> = {
  // Profil pressenti pour le poste : la discussion se poursuit.
  Pressenti: 'Répondu',
};

/** Étape finale sans suite pour le candidat : affichée comme un processus terminé, sans jugement. */
const CLOSED_STAGES = new Set(['Perdu']);

type StageView =
  | { kind: 'step'; index: number }
  | { kind: 'closed' }
  | { kind: 'unknown' };

function resolveStage(raw: string | null): StageView {
  const key = raw?.trim() || 'Nouveau';
  if (CLOSED_STAGES.has(key)) return { kind: 'closed' };
  const index = STEPS.findIndex((step) => step.key === (STEP_ALIASES[key] ?? key));
  return index >= 0 ? { kind: 'step', index } : { kind: 'unknown' };
}

const DEFAULT_FAQ: FAQItem[] = [
  { question: 'Combien de temps dure le processus de recrutement ?', answer: 'En moyenne, le processus complet prend entre 3 et 6 semaines, selon le poste et la disponibilité des interlocuteurs.' },
  { question: "Comment me préparer à l'entretien ?", answer: "Renseignez-vous sur l'entreprise, préparez des exemples concrets de vos réalisations, et n'hésitez pas à poser des questions à votre recruteur." },
  { question: "Puis-je postuler à d'autres postes en parallèle ?", answer: "Bien sûr ! Nous pouvons même vous proposer d'autres opportunités correspondant à votre profil." },
  { question: "Quand aurai-je un retour après l'entretien ?", answer: 'Nous nous engageons à vous faire un retour dans les 48 heures suivant chaque étape du processus.' },
];

const dayLabel = (n: number) => (n > 1 ? 'jours' : 'jour');

type LoadState = 'loading' | 'ready' | 'invalid' | 'error';

export default function CandidatePortal() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PortalData | null>(null);
  const [status, setStatus] = useState<LoadState>('loading');
  const [retrying, setRetrying] = useState(false);

  const fetchPortal = useCallback(async () => {
    if (!token) {
      setStatus('invalid');
      return;
    }
    try {
      const { data: rows, error } = await (supabase.rpc as any)('get_portal_by_token', { p_token: token });
      if (error) {
        // Le service n'a pas répondu : ce n'est pas un lien expiré.
        setStatus('error');
        return;
      }
      // La fonction ne renvoie rien pour un lien inconnu, désactivé ou expiré.
      const result = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
      if (!result) {
        setStatus('invalid');
        return;
      }
      setData(result as PortalData);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [token]);

  useEffect(() => {
    void fetchPortal();
  }, [fetchPortal]);

  const retry = () => {
    setRetrying(true);
    void fetchPortal().finally(() => setRetrying(false));
  };

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner size="lg" label="Chargement de votre suivi de candidature" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <PublicDeadEnd
        kind="network"
        title="Impossible d'afficher votre suivi"
        description="La connexion au service a échoué. Vérifiez votre connexion internet, puis réessayez."
        onRetry={retry}
        retrying={retrying}
        seo={{ title: 'Suivi de candidature', description: "Suivez l'avancement de votre candidature." }}
      />
    );
  }

  if (status === 'invalid' || !data) {
    return (
      <PublicDeadEnd
        kind="link"
        title="Ce lien de suivi n'est plus valide"
        description="Il a peut-être expiré ou été désactivé. Demandez un nouveau lien à votre recruteur."
        seo={{ title: 'Suivi de candidature', description: "Suivez l'avancement de votre candidature." }}
      />
    );
  }

  const stage = resolveStage(data.pipeline_stage);
  const inProgress = stage.kind === 'step' && STEPS[stage.index].key !== 'Gagné';
  // L'étape finale « Gagné » ne s'affiche que lorsqu'elle est atteinte.
  const visibleSteps = stage.kind === 'step' && STEPS[stage.index].key === 'Gagné' ? STEPS : STEPS.slice(0, -1);
  const progressPercent = stage.kind === 'step' ? Math.round((stage.index / (STEPS.length - 1)) * 100) : 0;

  const stageUpdatedDate = data.stage_updated_at ? new Date(data.stage_updated_at) : new Date(data.updated_at);
  const daysSinceStageUpdate = Math.max(0, Math.floor((Date.now() - stageUpdatedDate.getTime()) / (1000 * 60 * 60 * 24)));
  const estimatedDays = stage.kind === 'step' ? (data.estimated_days_to_next ?? STEPS[stage.index].avgDays ?? null) : null;
  const daysRemaining = estimatedDays ? Math.max(0, estimatedDays - daysSinceStageUpdate) : null;

  const faqItems = data.faq && data.faq.length > 0 ? data.faq : DEFAULT_FAQ;
  const documents = data.documents || [];
  const companyInitial = (data.company_name || 'P').trim().charAt(0).toUpperCase();
  const recruiterName = data.recruiter_name || 'Votre recruteur';

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title={`Suivi de candidature, ${data.job_title || 'poste'}`}
        description="Suivez l'avancement de votre candidature."
      />

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-10 sm:py-16">
        {/* ===== En-tête ===== */}
        <section aria-labelledby="portail-titre" className="rounded-xl border border-border bg-card p-6 sm:p-8">
          <div className="flex items-center gap-3">
            {data.company_logo_url ? (
              <img src={data.company_logo_url} alt="" className="h-10 w-10 rounded-lg object-contain" />
            ) : (
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-md font-semibold text-foreground-secondary" aria-hidden="true">
                {companyInitial}
              </span>
            )}
            <div className="min-w-0">
              <p className="eyebrow">Portail candidat</p>
              {data.company_name && <p className="truncate text-sm font-semibold text-foreground">{data.company_name}</p>}
            </div>
          </div>

          {data.candidate_name && (
            <p className="mt-5 text-sm text-muted-foreground">
              Bonjour <span className="font-semibold text-foreground">{data.candidate_name}</span>,
            </p>
          )}
          <h1 id="portail-titre" className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
            {data.job_title || 'Votre candidature'}
          </h1>
          {data.company_description && (
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{data.company_description}</p>
          )}

          {stage.kind === 'step' && (
            <div className="mt-6">
              <div className="flex items-center justify-between text-xs">
                <span id="portail-avancement" className="text-muted-foreground">Avancement</span>
                <span className="font-semibold tabular-nums text-foreground">{progressPercent} %</span>
              </div>
              <div
                className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-labelledby="portail-avancement"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPercent}
              >
                <div className="h-full rounded-full bg-brand" style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
          )}
        </section>

        {/* ===== Durées ===== */}
        {inProgress && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">À cette étape depuis</p>
              <p className="mt-1 flex items-baseline gap-1.5">
                <span className="text-2xl font-semibold tabular-nums text-foreground">{daysSinceStageUpdate}</span>
                <span className="text-xs text-muted-foreground">{dayLabel(daysSinceStageUpdate)}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Depuis le {stageUpdatedDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Prochaine étape</p>
              {daysRemaining !== null ? (
                <>
                  <p className="mt-1 flex items-baseline gap-1.5">
                    <span className="text-xs text-muted-foreground">environ</span>
                    <span className="text-2xl font-semibold tabular-nums text-foreground">{daysRemaining}</span>
                    <span className="text-xs text-muted-foreground">{dayLabel(daysRemaining)}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">Estimation moyenne</p>
                </>
              ) : (
                <p className="mt-1 text-sm text-foreground-secondary">À déterminer</p>
              )}
            </div>
          </div>
        )}

        {/* ===== Avancement du processus ===== */}
        {stage.kind === 'step' ? (
          <section aria-labelledby="etapes-titre" className="rounded-xl border border-border bg-card">
            <h2 id="etapes-titre" className="border-b border-border px-5 py-3 text-sm font-semibold text-foreground">
              Avancement du processus
            </h2>
            <ol className="p-5">
              {visibleSteps.map((step, index) => {
                const isPast = index < stage.index;
                const isCurrent = index === stage.index;
                const isLast = index === visibleSteps.length - 1;
                // Dernière étape atteinte : le processus est fini, pas « en cours ».
                const isDone = isCurrent && step.key === 'Gagné';
                const Icon = isPast ? Check : step.icon;
                return (
                  <li key={step.key} className="flex gap-4" aria-current={isCurrent ? 'step' : undefined}>
                    <div className="flex flex-col items-center">
                      <span
                        className={cn(
                          'grid h-8 w-8 shrink-0 place-items-center rounded-full border',
                          isPast && 'border-transparent bg-muted text-foreground',
                          isCurrent && !isDone && 'border-brand bg-brand/15 text-brand',
                          isDone && 'border-success bg-success-muted text-success',
                          !isPast && !isCurrent && 'border-border text-muted-foreground',
                        )}
                        aria-hidden="true"
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      {!isLast && <span className={cn('min-h-6 w-px flex-1', isPast ? 'bg-border-strong' : 'bg-border')} aria-hidden="true" />}
                    </div>
                    <div className={cn('min-w-0 pb-6 pt-1', isLast && 'pb-0')}>
                      <p className="flex flex-wrap items-center gap-2">
                        <span className={cn('text-sm font-semibold', isPast || isCurrent ? 'text-foreground' : 'text-muted-foreground')}>
                          {step.label}
                        </span>
                        {isCurrent && !isDone && <Badge variant="brand">En cours</Badge>}
                        {isDone && <Badge variant="success">Terminé</Badge>}
                        {isPast && <span className="sr-only">(terminée)</span>}
                        {!isPast && !isCurrent && <span className="sr-only">(à venir)</span>}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{step.description}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ) : (
          <section aria-labelledby="etat-titre" className="flex items-start gap-4 rounded-xl border border-border bg-card p-5">
            <IconTile icon={stage.kind === 'closed' ? Flag : Hourglass} aria-hidden="true" />
            <div>
              <h2 id="etat-titre" className="text-sm font-semibold text-foreground">
                {stage.kind === 'closed' ? 'Processus terminé' : 'Candidature en cours'}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {stage.kind === 'closed'
                  ? "Ce processus de recrutement est terminé pour votre candidature. Merci pour le temps que vous y avez consacré : votre recruteur reste disponible pour en parler."
                  : 'Votre candidature est en cours de traitement. Votre recruteur vous tiendra informé de la suite.'}
              </p>
            </div>
          </section>
        )}

        {/* ===== Prochaines étapes ===== */}
        {data.next_steps && (
          <section aria-labelledby="suite-titre" className="rounded-xl border border-border bg-card p-5">
            <h2 id="suite-titre" className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Prochaines étapes
            </h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground-secondary">{data.next_steps}</p>
          </section>
        )}

        {/* ===== Documents ===== */}
        {documents.length > 0 && (
          <section aria-labelledby="documents-titre" className="rounded-xl border border-border bg-card">
            <h2 id="documents-titre" className="flex items-center gap-2 border-b border-border px-5 py-3 text-sm font-semibold text-foreground">
              <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Documents et ressources
            </h2>
            <ul className="divide-y divide-border">
              {documents.map((doc, i) => (
                <li key={`${doc.url}-${i}`}>
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-11 items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-accent"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{doc.name}</span>
                      {doc.type && <Badge variant="muted">{doc.type.toUpperCase()}</Badge>}
                    </span>
                    <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="sr-only">(s'ouvre dans un nouvel onglet)</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ===== Questions fréquentes ===== */}
        <section aria-labelledby="faq-titre" className="rounded-xl border border-border bg-card">
          <h2 id="faq-titre" className="flex items-center gap-2 border-b border-border px-5 py-3 text-sm font-semibold text-foreground">
            <HelpCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Questions fréquentes
          </h2>
          <Accordion type="single" collapsible className="px-5">
            {faqItems.map((item, i) => (
              <AccordionItem key={i} value={`question-${i}`} className="last:border-b-0">
                <AccordionTrigger className="min-h-11 gap-4 py-3 text-left text-sm font-semibold hover:no-underline [&>svg]:text-muted-foreground">
                  {item.question}
                </AccordionTrigger>
                <AccordionContent className="pb-3 text-sm leading-relaxed text-muted-foreground">{item.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>

        {/* ===== Recruteur ===== */}
        <section aria-labelledby="recruteur-titre" className="rounded-xl border border-border bg-card p-5">
          <p className="eyebrow">Votre recruteur</p>
          <div className="mt-3 flex items-center gap-3">
            <IconTile icon={Users} size="lg" className="rounded-full" aria-hidden="true" />
            <div className="min-w-0">
              <h2 id="recruteur-titre" className="truncate text-md font-semibold text-foreground">{recruiterName}</h2>
              <p className="text-xs text-muted-foreground">N'hésitez pas à me contacter pour toute question.</p>
            </div>
          </div>
          {(data.recruiter_email || data.recruiter_phone) && (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              {data.recruiter_email && (
                <Button asChild variant="outline" className="max-md:h-11">
                  <a href={`mailto:${data.recruiter_email}`}>
                    <Mail aria-hidden="true" />
                    Écrire un e-mail
                  </a>
                </Button>
              )}
              {data.recruiter_phone && (
                <Button asChild variant="outline" className="max-md:h-11">
                  <a href={`tel:${data.recruiter_phone}`}>
                    <Phone aria-hidden="true" />
                    Appeler
                  </a>
                </Button>
              )}
            </div>
          )}
        </section>

        <footer className="space-y-2 pt-4 text-center">
          <p className="text-xs text-muted-foreground">
            Dernière mise à jour le{' '}
            {new Date(data.updated_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
          <PoweredByKonekt />
        </footer>
      </main>
    </div>
  );
}
