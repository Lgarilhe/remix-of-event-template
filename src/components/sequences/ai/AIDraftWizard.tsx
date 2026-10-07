// Rédaction de la séquence d'une mission par l'IA à partir du poste (lot 5e),
// derrière l'interrupteur konekt.sequences-v2. Deux écrans :
// - « Le poste » : arguments retenus du poste (retirables, « + Ajouter un
//   argument »), « Vos messages » repris du Cadrage, nombre de relances (1 à
//   3), premier contact par invitation (défaut) ou par InMail, coût annoncé
//   par prepare, « Rien ne part avant que vous inscriviez des candidats. » ;
// - « L'angle » : trois angles calculés sans IA, dont un « Recommandé »,
//   chacun avec son « Pourquoi » ; « Rédiger la séquence » appelle draft.
// Lot 5e-2 : sur « Le poste », section « Style et niveau » : le style de la
// personne (« Modifier », pour cette rédaction seulement), le niveau de l'IA
// avec le coût de chaque niveau permis (valeurs de prepare), le pied « Coût :
// environ N crédits. » qui suit le niveau choisi. Style et niveau partent dans
// draft (ai_level, style) et sont gardés pour « Rédiger à nouveau ». Un niveau
// refusé par le serveur (au-dessus du plafond) ramène sur « Le poste » avec la
// phrase du serveur ; le plafond est relu, les réglages restent.
// La séquence rédigée va dans l'éditeur (onDrafted), remplie et non
// enregistrée. Erreurs : textes de la spécification (section 2.6), réglages
// gardés. Aucune valeur n'est gardée dans le navigateur.
// Changement d'écran : boutons du pied distincts (clé), second clic d'un
// double clic ignoré, Entrée au clavier ignorée pendant 500 ms, hauteur de
// fenêtre stable, défilement remis en haut et focus posé sur l'écran : un
// double clic ou un second Entrée sur « Choisir l'angle » ne lance jamais la
// rédaction payante.
import { useCallback, useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Plus, Sparkles, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Banner, bannerActionClass } from '@/components/ui/banner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { WritingStyleFields } from '@/components/ai/WritingStyleFields';
import { AiLevelPicker } from '@/components/ai/AiLevelPicker';
import { useMissionDraftReadiness, useSequenceAI } from '@/hooks/useSequenceAI';
import { cn } from '@/lib/utils';
import { AGENDA_FALLBACK_SENTENCE, STYLE_ONLY_THIS_TIME, sameStyle, styleSummary } from '@/lib/writingStyle';
import {
  AI_DRAFT_NOTICE,
  AI_DRAFT_REPLACES_EDITS,
  EXTRA_ARGUMENTS_MAX,
  EXTRA_ARGUMENT_MAX_LENGTH,
  aboutCreditsLabel,
  draftCostFor,
  draftCreditsSufficient,
  draftRequestBody,
  hasArguments,
  settingsForPrepare,
  type AiDraftResult,
  type DraftAngleId,
  type DraftError,
  type DraftPrepare,
  type DraftSettings,
  type FirstContact,
} from '@/lib/sequenceDraft';

type Screen = 'poste' | 'angle';
type PrepareState = { state: 'loading' } | { state: 'error'; error: DraftError } | { state: 'ready'; prepare: DraftPrepare };

const TOUCH = 'max-md:h-11';
/** Arguments du poste montrés d'emblée (les plus forts d'abord, ordre de prepare) ; les autres sous « Voir les N autres ». */
const VISIBLE_FACTS = 5;
/** Activation au clavier ignorée juste après un changement d'écran (second Entrée). */
const SCREEN_GUARD_MS = 500;
const RELANCE_OPTIONS = [
  { value: '1', label: '1 relance' },
  { value: '2', label: '2 relances' },
  { value: '3', label: '3 relances' },
];
const CONTACT_OPTIONS: { value: FirstContact; label: string }[] = [
  { value: 'invitation', label: 'Invitation' },
  { value: 'inmail', label: 'InMail' },
];
const CONTACT_HELP: Record<FirstContact, string> = {
  invitation: 'Une invitation avec une note, puis les messages une fois la relation acceptée (14 jours au plus).',
  inmail: 'Un InMail pour chaque message : chaque envoi consomme un crédit InMail de votre compte LinkedIn.',
};

export interface AIDraftWizardProps {
  open: boolean;
  /** Fermée sans rédaction (Annuler, Échap, croix). */
  onCancel: () => void;
  organizationId: string | null;
  missionId: string;
  /** Réglages de la rédaction précédente, repris par « Rédiger à nouveau ». */
  previousSettings?: DraftSettings | null;
  /** « Rédiger à nouveau » : les étapes affichées seront remplacées. */
  replacing?: boolean;
  onDrafted: (result: AiDraftResult, settings: DraftSettings) => void;
  /** « Depuis un modèle », proposé quand les crédits manquent. */
  onFromTemplate?: () => void;
  /** Après une rédaction, élément qui reçoit le focus à la fermeture (bandeau de la rédaction). */
  focusAfterDraft?: () => HTMLElement | null;
}

/** Bandeau d'erreur : actions à droite du texte, et sous le texte sous 640 px (à côté, le texte n'aurait plus la place). */
function WizardBanner({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <Banner
      tone="warning"
      icon={AlertTriangle}
      role="alert"
      className="rounded-lg border"
      action={actions ? <span className="flex shrink-0 flex-wrap items-center gap-4 max-sm:hidden">{actions}</span> : undefined}
    >
      {children}
      {actions && <span className="mt-1 flex flex-wrap items-center gap-x-4 sm:hidden">{actions}</span>}
    </Banner>
  );
}

export function AIDraftWizard({ open, onCancel, organizationId, missionId, previousSettings = null, replacing = false, onDrafted, onFromTemplate, focusAfterDraft }: AIDraftWizardProps) {
  const id = useId();
  const { prepare: runPrepare, draft: runDraft } = useSequenceAI(organizationId);
  const { cadrageHref } = useMissionDraftReadiness(missionId);
  const [screen, setScreen] = useState<Screen>('poste');
  const [prep, setPrep] = useState<PrepareState>({ state: 'loading' });
  const [settings, setSettings] = useState<DraftSettings | null>(null);
  const [adding, setAdding] = useState(false);
  const [newArgument, setNewArgument] = useState('');
  const [argumentError, setArgumentError] = useState<{ index: number | null; message: string } | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<DraftError | null>(null);
  const [showAllFacts, setShowAllFacts] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  /** Niveau refusé par le serveur (plafond de l'organisation) : phrase montrée sur « Le poste ». */
  const [levelError, setLevelError] = useState<string | null>(null);
  const settingsRef = useRef<DraftSettings | null>(null);
  settingsRef.current = settings;
  const previousRef = useRef(previousSettings);
  previousRef.current = previousSettings;
  const scrollRef = useRef<HTMLDivElement>(null);
  const factsHeadingRef = useRef<HTMLHeadingElement>(null);
  const factsListRef = useRef<HTMLUListElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const levelRef = useRef<HTMLDivElement>(null);
  const screenChangedAtRef = useRef(0);
  const focusScreenRef = useRef(false);
  /** Focus à poser après un ajout ou un retrait d'argument : rang du bouton « Retirer », ou « Ajouter un argument ». */
  const focusArgumentRef = useRef<number | 'add' | null>(null);
  const draftedRef = useRef(false);

  const load = useCallback(async () => {
    setPrep({ state: 'loading' });
    const outcome = await runPrepare(missionId);
    if (outcome.status === 'error') {
      setPrep({ state: 'error', error: outcome.error });
      return;
    }
    setPrep({ state: 'ready', prepare: outcome.prepare });
    // Réglages gardés : ceux de cette fenêtre (Réessayer), sinon de la rédaction précédente.
    setSettings(settingsForPrepare(outcome.prepare, settingsRef.current ?? previousRef.current));
  }, [runPrepare, missionId]);

  // Chaque ouverture repart de « Le poste », avec le poste relu (il a pu changer dans le Cadrage).
  useEffect(() => {
    if (!open) return;
    setScreen('poste');
    setDraftError(null);
    setArgumentError(null);
    setAdding(false);
    setNewArgument('');
    setShowAllFacts(false);
    setStyleOpen(false);
    setLevelError(null);
    draftedRef.current = false;
    void load();
  }, [open, load]);

  /** Plafond relu sans repasser par le chargement : les réglages restent, le niveau est ramené sous le plafond. */
  const refreshLevels = useCallback(async () => {
    const outcome = await runPrepare(missionId);
    if (outcome.status !== 'ok') return;
    setPrep({ state: 'ready', prepare: outcome.prepare });
    setSettings((current) => settingsForPrepare(outcome.prepare, current));
  }, [runPrepare, missionId]);

  const goTo = (next: Screen) => {
    screenChangedAtRef.current = Date.now();
    focusScreenRef.current = true;
    setScreen(next);
  };
  /**
   * Activation à ignorer : second clic d'un double clic (detail > 1 : le
   * bouton de l'écran suivant est sous le pointeur), ou activation au clavier
   * (detail 0) moins de 500 ms après le changement d'écran.
   */
  const ignored = (event: MouseEvent) =>
    event.detail > 1 || (event.detail === 0 && Date.now() - screenChangedAtRef.current < SCREEN_GUARD_MS);

  // Chaque écran s'ouvre en haut ; après un changement, focus sur l'angle choisi ou sur le titre des arguments.
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: 0 });
    if (!focusScreenRef.current) return;
    focusScreenRef.current = false;
    if (screen === 'angle') {
      const angle = settingsRef.current?.angle;
      if (angle) document.getElementById(`${id}-angle-${angle}`)?.focus();
    } else {
      factsHeadingRef.current?.focus();
    }
  }, [screen, id]);

  // Erreur de la rédaction : bandeau amené dans la vue et lu (il est au-dessus des angles).
  useEffect(() => {
    if (!draftError) return;
    errorRef.current?.scrollIntoView?.({ block: 'nearest' });
    errorRef.current?.focus();
  }, [draftError]);

  // Après un ajout ou un retrait d'argument : focus sur le « Retirer » suivant, sinon sur « Ajouter un argument ».
  useEffect(() => {
    const target = focusArgumentRef.current;
    if (target === null) return;
    focusArgumentRef.current = null;
    const removeButtons = Array.from(factsListRef.current?.querySelectorAll<HTMLButtonElement>('[data-remove-argument]') ?? []);
    const next = typeof target === 'number' ? removeButtons[target] : undefined;
    (next ?? addButtonRef.current ?? removeButtons[removeButtons.length - 1] ?? factsHeadingRef.current)?.focus();
  });

  const prepare = prep.state === 'ready' ? prep.prepare : null;
  // Coût et solde au niveau choisi (lot 5e-2) : le pied suit le niveau.
  const cost = prepare ? aboutCreditsLabel(draftCostFor(prepare, settings?.level ?? null)) : null;
  const creditsShort = !!prepare && draftCreditsSufficient(prepare, settings?.level ?? null) === false;
  const update = (patch: Partial<DraftSettings>) => setSettings((s) => (s ? { ...s, ...patch } : s));

  const addArgument = () => {
    const text = newArgument.replace(/\s+/g, ' ').trim();
    if (!text || !settings || settings.extraArguments.length >= EXTRA_ARGUMENTS_MAX) return;
    update({ extraArguments: [...settings.extraArguments, text] });
    setNewArgument('');
    setAdding(false);
    setArgumentError(null);
    // « Ajouter un argument » s'il reste de la place, sinon le « Retirer » de la nouvelle ligne.
    focusArgumentRef.current = 'add';
  };

  const draft = async () => {
    if (!prepare || !settings || !organizationId || drafting) return;
    setDrafting(true);
    setDraftError(null);
    try {
      const outcome = await runDraft(draftRequestBody(organizationId, missionId, prepare, settings));
      if (outcome.status === 'ok') {
        draftedRef.current = true;
        onDrafted(outcome.result, settings);
        return;
      }
      if (outcome.error.kind === 'argument') {
        // Argument ajouté refusé avant tout appel au modèle : retour sur « Le poste », sous l'argument.
        setArgumentError({ index: outcome.error.argumentIndex ?? null, message: outcome.error.message });
        goTo('poste');
        return;
      }
      if (outcome.error.kind === 'level') {
        // Niveau au-dessus du plafond (refusé sans appel ni débit) : retour sur « Le poste », plafond relu.
        setLevelError(outcome.error.message);
        goTo('poste');
        void refreshLevels();
        return;
      }
      setDraftError(outcome.error);
    } finally {
      setDrafting(false);
    }
  };

  const close = (next: boolean) => {
    if (!next && !drafting) onCancel();
  };

  const creditsBanner = (
    <WizardBanner
      actions={
        <>
          <Link to="/pricing" className={cn(bannerActionClass, 'max-md:min-h-11')}>Voir les offres</Link>
          {onFromTemplate && (
            <Button type="button" variant="link" onClick={onFromTemplate} className={cn('h-auto p-0', bannerActionClass, 'max-md:min-h-11')}>
              Depuis un modèle
            </Button>
          )}
        </>
      }
    >
      Crédits IA insuffisants pour rédiger la séquence.
    </WizardBanner>
  );
  const thinBanner = (message: string) => (
    <WizardBanner actions={cadrageHref ? <Link to={cadrageHref} className={cn(bannerActionClass, 'max-md:min-h-11')}>Ouvrir le Cadrage</Link> : undefined}>
      {message}
    </WizardBanner>
  );
  const unavailableBanner = (message: string, onRetry: () => void) => (
    <WizardBanner
      actions={
        <Button type="button" variant="link" onClick={onRetry} className={cn('h-auto p-0', bannerActionClass, 'max-md:min-h-11')}>
          Réessayer
        </Button>
      }
    >
      {message}
    </WizardBanner>
  );

  const removed = new Set(settings?.removedFactIds ?? []);
  const keptFacts = prepare?.facts.filter((f) => !removed.has(f.id)) ?? [];
  const shownFacts = showAllFacts ? keptFacts : keptFacts.slice(0, VISIBLE_FACTS);
  const hiddenFactCount = keptFacts.length - shownFacts.length;
  const canContinue = !!prepare && !!settings && hasArguments(prepare, settings) && !creditsShort;
  // Après un refus faute de crédits, un nouvel essai serait refusé de même.
  const canDraft = canContinue && draftError?.kind !== 'credits';

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        // Hauteur stable une fois le poste lu : les deux écrans gardent le pied au même endroit.
        className={cn('flex max-h-[90vh] w-[calc(100%-1rem)] max-w-xl flex-col gap-0 overflow-hidden p-0 sm:w-full', prepare && 'h-[min(90vh,46rem)]')}
        onEscapeKeyDown={(event) => { if (drafting) event.preventDefault(); }}
        onInteractOutside={(event) => { if (drafting) event.preventDefault(); }}
        onCloseAutoFocus={(event) => {
          // Après une rédaction, la fenêtre n'a plus d'origine : focus sur le résultat.
          const target = draftedRef.current ? focusAfterDraft?.() : null;
          if (target) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <DialogHeader className="space-y-3 border-b border-border px-6 pb-4 pt-6 text-left">
          <DialogTitle className="pr-8">Rédiger une séquence pour cette mission</DialogTitle>
          <DialogDescription asChild>
            <ol aria-label="Étapes de la rédaction" className="flex items-center gap-2 text-sm">
              {(['poste', 'angle'] as const).map((s, i) => (
                <li key={s} aria-current={screen === s ? 'step' : undefined} className={cn('flex items-center gap-2', screen === s ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                  {i > 0 && <span aria-hidden="true" className="h-px w-6 bg-border" />}
                  {i + 1} · {s === 'poste' ? 'Le poste' : 'L’angle'}
                </li>
              ))}
            </ol>
          </DialogDescription>
        </DialogHeader>

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {prep.state === 'loading' && (
            <div role="status" aria-label="Lecture du poste" className="space-y-3">
              <Skeleton className="h-4 w-48 rounded-sm" />
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-full rounded-md" />)}
              <Skeleton className="h-4 w-40 rounded-sm" />
              <Skeleton className="h-8 w-64 rounded-md" />
            </div>
          )}

          {prep.state === 'error' && (
            prep.error.kind === 'thin' ? thinBanner(prep.error.message)
              : prep.error.kind === 'credits' ? creditsBanner
              : unavailableBanner(prep.error.message, () => { void load(); })
          )}

          {prepare && settings && screen === 'poste' && (
            <>
              {creditsShort && creditsBanner}
              {levelError && (
                <WizardBanner
                  actions={
                    <Button
                      type="button"
                      variant="link"
                      onClick={() => { levelRef.current?.scrollIntoView?.({ block: 'center' }); levelRef.current?.focus(); }}
                      className={cn('h-auto p-0', bannerActionClass, 'max-md:min-h-11')}
                    >
                      Changer le niveau
                    </Button>
                  }
                >
                  {levelError}
                </WizardBanner>
              )}
              <section aria-labelledby={`${id}-facts`} className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 id={`${id}-facts`} ref={factsHeadingRef} tabIndex={-1} className="text-sm font-semibold text-foreground outline-none">Ce que l’IA retient du poste</h3>
                  {cadrageHref && (
                    <Link to={cadrageHref} className="text-sm text-foreground underline underline-offset-2 hover:no-underline max-md:inline-flex max-md:min-h-11 max-md:items-center">
                      Modifier dans le Cadrage
                    </Link>
                  )}
                </div>
                <ul ref={factsListRef} className="divide-y divide-border border-y border-border">
                  {shownFacts.map((fact, rank) => (
                    <li key={fact.id} className="flex items-start gap-2 py-2">
                      <span className="min-w-0 flex-1 text-sm text-foreground">{fact.label}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        data-remove-argument=""
                        aria-label={`Retirer l’argument « ${fact.label} »`}
                        onClick={() => {
                          update({ removedFactIds: [...settings.removedFactIds, fact.id] });
                          focusArgumentRef.current = rank;
                        }}
                        className="text-muted-foreground max-md:h-11 max-md:w-11"
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                  {settings.extraArguments.map((text, index) => (
                    <li key={`extra-${index}`} className="py-2">
                      <div className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 text-sm text-foreground">{text}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          data-remove-argument=""
                          aria-label={`Retirer l’argument « ${text} »`}
                          onClick={() => {
                            update({ extraArguments: settings.extraArguments.filter((_, i) => i !== index) });
                            setArgumentError(null);
                            focusArgumentRef.current = shownFacts.length + index;
                          }}
                          className="text-muted-foreground max-md:h-11 max-md:w-11"
                        >
                          <X aria-hidden="true" />
                        </Button>
                      </div>
                      {argumentError?.index === index && <p role="alert" className="mt-1 text-xs text-danger">{argumentError.message}</p>}
                    </li>
                  ))}
                </ul>
                {argumentError && argumentError.index === null && <p role="alert" className="text-xs text-danger">{argumentError.message}</p>}
                {!hasArguments(prepare, settings) && <p className="text-xs text-danger">Gardez au moins un argument pour rédiger.</p>}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  {hiddenFactCount > 0 && (
                    <Button type="button" variant="link" size="sm" onClick={() => setShowAllFacts(true)} className={cn('h-auto px-0', TOUCH)}>
                      Voir {hiddenFactCount > 1 ? `les ${hiddenFactCount} autres` : 'l’autre'}
                    </Button>
                  )}
                  {!adding && settings.extraArguments.length < EXTRA_ARGUMENTS_MAX && (
                    <Button ref={addButtonRef} type="button" variant="ghost" size="sm" onClick={() => setAdding(true)} className={cn('-ml-2', TOUCH)}>
                      <Plus aria-hidden="true" />
                      Ajouter un argument
                    </Button>
                  )}
                  {settings.removedFactIds.length > 0 && (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      onClick={() => {
                        update({ removedFactIds: [] });
                        focusArgumentRef.current = 0;
                      }}
                      className={cn('h-auto px-0', TOUCH)}
                    >
                      Remettre les arguments retirés ({settings.removedFactIds.length})
                    </Button>
                  )}
                </div>
                {adding && (
                  <div className="space-y-1.5">
                    <Label htmlFor={`${id}-argument`} className="text-sm">Nouvel argument</Label>
                    <div className="flex gap-2">
                      <Input
                        id={`${id}-argument`}
                        autoFocus
                        value={newArgument}
                        maxLength={EXTRA_ARGUMENT_MAX_LENGTH}
                        placeholder="Par exemple : création du poste, rattaché au directeur général"
                        onChange={(e) => setNewArgument(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); addArgument(); }
                          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAdding(false); setNewArgument(''); focusArgumentRef.current = 'add'; }
                        }}
                        className={TOUCH}
                      />
                      <Button type="button" variant="outline" onClick={addArgument} disabled={!newArgument.trim()} className={TOUCH}>Ajouter</Button>
                    </div>
                  </div>
                )}
              </section>

              {prepare.messages.length > 0 && (
                <section aria-labelledby={`${id}-messages`} className="space-y-1.5">
                  <h3 id={`${id}-messages`} className="text-sm font-semibold text-foreground">Vos messages (repris du Cadrage)</h3>
                  <ul className="space-y-0.5 text-sm text-foreground-secondary">
                    {prepare.messages.map((line) => <li key={line}>{line}</li>)}
                  </ul>
                </section>
              )}

              <section className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-foreground" id={`${id}-relances`}>Relances</p>
                  <SegmentedControl
                    aria-label="Nombre de relances"
                    variant="quiet"
                    value={String(settings.relances)}
                    onValueChange={(value) => update({ relances: Number(value) })}
                    options={RELANCE_OPTIONS}
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-foreground">Premier contact</p>
                  <SegmentedControl<FirstContact>
                    aria-label="Premier contact"
                    variant="quiet"
                    value={settings.firstContact}
                    onValueChange={(value) => update({ firstContact: value })}
                    options={CONTACT_OPTIONS}
                  />
                </div>
                <p className="text-xs text-muted-foreground sm:col-span-2">{CONTACT_HELP[settings.firstContact]}</p>
              </section>

              <section aria-labelledby={`${id}-writing`} className="space-y-4 border-t border-border pt-5">
                <h3 id={`${id}-writing`} className="text-sm font-semibold text-foreground">Style et niveau</h3>
                <div className="space-y-2">
                  <p className="text-sm text-foreground-secondary">
                    Style : {styleSummary(settings.style ?? prepare.writing.style)}.{' '}
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      aria-expanded={styleOpen}
                      aria-controls={`${id}-style-fields`}
                      onClick={() => setStyleOpen((v) => !v)}
                      className="h-auto p-0 align-baseline text-muted-foreground underline underline-offset-2 max-md:flex max-md:min-h-11"
                    >
                      {styleOpen ? 'Fermer' : 'Modifier'}
                    </Button>
                  </p>
                  {styleOpen && (
                    <div id={`${id}-style-fields`} className="space-y-3 rounded-lg bg-muted/40 p-3">
                      <WritingStyleFields compact value={settings.style ?? prepare.writing.style} onChange={(style) => update({ style })} />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="min-w-0 flex-1 text-xs text-muted-foreground">{STYLE_ONLY_THIS_TIME}</p>
                        {settings.style && !sameStyle(settings.style, prepare.writing.style) && (
                          <Button type="button" variant="ghost" size="xs" onClick={() => update({ style: { ...prepare.writing.style } })} className={TOUCH}>
                            Revenir à mon style
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                  {(settings.style ?? prepare.writing.style).cta === 'agenda' && !prepare.writing.hasCalendlyLink && (
                    <p className="text-xs text-muted-foreground">{AGENDA_FALLBACK_SENTENCE}</p>
                  )}
                </div>
                <div ref={levelRef} tabIndex={-1} className="space-y-2 outline-none">
                  <p className="text-sm font-semibold text-foreground">Niveau de l’IA</p>
                  <AiLevelPicker
                    choices={prepare.writing.levels}
                    value={settings.level ?? prepare.writing.level}
                    maxLevel={prepare.writing.maxLevel}
                    onChange={(level) => { update({ level }); setLevelError(null); }}
                  />
                </div>
              </section>
            </>
          )}

          {prepare && settings && screen === 'angle' && (
            <>
              {/* Avant les angles : lus avant le clic, et visibles à 360 px sans défiler. */}
              {replacing && <p className="text-sm text-foreground-secondary">{AI_DRAFT_REPLACES_EDITS}</p>}
              {draftError && draftError.kind !== 'argument' && (
                <div ref={errorRef} tabIndex={-1} className="outline-none">
                  {draftError.kind === 'credits' && creditsBanner}
                  {draftError.kind === 'thin' && thinBanner(draftError.message)}
                  {draftError.kind === 'unavailable' && unavailableBanner(draftError.message, () => { void draft(); })}
                </div>
              )}
              <RadioGroup
                aria-label="Angle des messages"
                value={settings.angle}
                onValueChange={(value) => update({ angle: value as DraftAngleId })}
                className="gap-3"
                disabled={drafting}
              >
                {prepare.angles.map((angle) => (
                  <Label
                    key={angle.id}
                    htmlFor={`${id}-angle-${angle.id}`}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-lg border p-4 font-normal transition-colors duration-150 hover:border-border-strong',
                      settings.angle === angle.id ? 'border-foreground' : 'border-border',
                    )}
                  >
                    <RadioGroupItem id={`${id}-angle-${angle.id}`} value={angle.id} className="mt-0.5" />
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{angle.label}</span>
                        {angle.recommended && <Badge variant="brand">Recommandé</Badge>}
                      </span>
                      <span className="block text-sm text-foreground-secondary">{angle.description}</span>
                      <span className="block text-sm text-muted-foreground">{angle.why}</span>
                    </span>
                  </Label>
                ))}
              </RadioGroup>
              {drafting && <p role="status" className="text-sm text-muted-foreground">Rédaction en cours : une vingtaine de secondes.</p>}
            </>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-border px-6 py-4 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {cost && <span className="block">Coût : {cost}.</span>}
            <span className="block">{AI_DRAFT_NOTICE}</span>
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {/* Clés distinctes : un bouton d'un écran n'est jamais réutilisé par l'autre (le focus ne passe pas de « Choisir l'angle » à « Rédiger la séquence »). */}
            {screen === 'poste' ? (
              <>
                <Button key="cancel" type="button" variant="ghost" onClick={onCancel} className={TOUCH}>Annuler</Button>
                <Button key="next" type="button" variant="primary" disabled={!canContinue} onClick={(event) => { if (!ignored(event)) goTo('angle'); }} className={TOUCH}>
                  Choisir l’angle
                </Button>
              </>
            ) : (
              <>
                <Button key="back" type="button" variant="ghost" disabled={drafting} onClick={(event) => { if (ignored(event)) return; setDraftError(null); goTo('poste'); }} className={TOUCH}>Retour</Button>
                <Button key="draft" type="button" variant="primary" loading={drafting} disabled={!canDraft || drafting} onClick={(event) => { if (!ignored(event)) void draft(); }} className={TOUCH}>
                  {!drafting && <Sparkles aria-hidden="true" />}
                  {drafting ? 'Rédaction…' : 'Rédiger la séquence'}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
