/**
 * Assistant de connexion directe (identifiants, cookie, QR code, code
 * d'association, messagerie) : un bouton discret à côté de la connexion
 * standard, qui ouvre une fenêtre (un tiroir sur téléphone) où chaque état de
 * la connexion a son écran.
 *
 * Chargé à la demande par NativeConnectSlot, seulement quand le serveur annonce
 * la connexion directe ET que l'interrupteur local est allumé.
 *
 * - Tout passe par les actions de connexion (src/hooks/useConnection.ts) ; le
 *   navigateur ne dit jamais où revenir et ne lit aucun texte du prestataire.
 * - Les identifiants sont lus dans leur champ à l'envoi et effacés aussitôt
 *   (steps/StepParts.tsx, `takeSecret`) ; rien n'est journalisé ni gardé.
 * - Une vérification que l'écran ne sait pas afficher (sécurité, type inconnu)
 *   mène seule à la page de connexion standard, avec une explication.
 * - Fermer la fenêtre annule la tentative en cours, sauf quand l'onglet part
 *   vers une page de connexion.
 *
 * Règles pures : nativeFlow.ts (testé par tests/ux/connexion-assistant.test.mjs).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { useConnection, useConnectionCapabilities } from '@/hooks/useConnection';
import {
  CHECKPOINT,
  connectionErrorMessage,
  nativeTriggerLabel,
  NATIVE,
  type ConnectionProviderId,
  type FallbackCause,
} from '@/lib/connectionCopy';
import { browserTimezone, goToProvider, type AttemptStatusView, type CheckpointStep, type StartConnectionInput } from '../connectionApi';
import { startHostedConnection } from '../hostedConnect';
import { rememberReturnTarget } from '../returnTarget';
import type { NativeConnectFlowProps } from '../NativeConnectSlot';
import { FlowSurface } from './FlowSurface';
import {
  defaultCountry,
  emailChoices,
  emailStep,
  entryStep,
  expiredStep,
  nextChangesStep,
  outcomeOfFailure,
  outcomeOfNext,
  previousStep,
  startProviderOf,
  stepKey,
  watchKey,
  watchPlan,
  type CallOutcome,
  type FlowStep,
  type NextOutcome,
} from './nativeFlow';
import { ChallengeStep, CodeStep, ConsentStep, ContractStep, LoadingStep, WaitStep } from './steps/CheckpointSteps';
import { EmailChoiceStep, ImapStep, OAuthStep } from './steps/EmailSteps';
import { LinkedInCookieStep, LinkedInCredentialsStep } from './steps/LinkedInSteps';
import { DoneStep, FailedStep, FallbackStep } from './steps/ResultSteps';
import { PairingStep, QrStep, WhatsAppChoiceStep, WhatsAppPhoneStep } from './steps/WhatsAppSteps';

type Busy = null | 'start' | 'checkpoint' | 'redirect';
type FallbackPhase = 'starting' | 'redirecting' | 'failed';

export default function NativeConnectFlow(props: NativeConnectFlowProps) {
  const [open, setOpen] = useState(false);
  const reconnect = !!props.reconnectAccountId;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full max-md:h-11"
        onClick={() => setOpen(true)}
      >
        {nativeTriggerLabel(props.provider, reconnect)}
      </Button>
      <FlowSurface open={open} onOpenChange={setOpen}>
        <FlowBody {...props} onClose={() => setOpen(false)} />
      </FlowSurface>
    </>
  );
}

interface FlowBodyProps extends NativeConnectFlowProps {
  onClose: () => void;
}

function FlowBody({ provider: initialProvider, reconnectAccountId, returnTo, onConnected, onClose }: FlowBodyProps) {
  const conn = useConnection();
  const { capabilities } = useConnectionCapabilities();
  const isMobile = useIsMobile();
  const reconnect = !!reconnectAccountId;
  const choices = useMemo(() => emailChoices(capabilities), [capabilities]);

  const [provider, setProvider] = useState<ConnectionProviderId>(() => startProviderOf(initialProvider, reconnect, emailChoices(capabilities)));
  const [step, setStep] = useState<FlowStep>(() => entryStep(initialProvider, reconnect, emailChoices(capabilities)));
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [country, setCountry] = useState(() => defaultCountry(typeof navigator === 'undefined' ? undefined : navigator.languages));
  const [challenges, setChallenges] = useState<CheckpointStep['challenges'] | null>(null);
  const [phone, setPhone] = useState('');
  const [fallbackPhase, setFallbackPhase] = useState<FallbackPhase>('starting');

  const attemptRef = useRef<string | null>(null);
  const pairingDigitsRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  /** L'onglet part vers une page de connexion : la tentative n'est pas annulée à la fermeture. */
  const leavingRef = useRef(false);
  const connectedRef = useRef(false);
  const stepRef = useRef(step);
  stepRef.current = step;

  // Fermer la fenêtre (croix, Échap, Annuler) annule la tentative encore ouverte.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const id = attemptRef.current;
      if (id && !leavingRef.current && !connectedRef.current) void conn.api.cancel(id).catch(() => undefined);
    };
    // La fonction de nettoyage lit les références au moment de la fermeture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Compte relié : les cartes sont relues une fois.
  useEffect(() => {
    if (step.name !== 'done' || connectedRef.current) return;
    connectedRef.current = true;
    void conn.refreshAccounts();
    onConnected?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.name]);

  // ------------------------------------------------------------------------
  // Transitions
  // ------------------------------------------------------------------------

  const goTo = useCallback((next: FlowStep) => {
    setStep(next);
    setBusy(null);
    setError(null);
  }, []);

  const failed = useCallback((message: string, code: string) => {
    goTo({ name: 'failed', message, code });
  }, [goTo]);

  /** Bascule sur la page de connexion standard : la tentative directe est remplacée par une tentative standard. */
  const startFallback = useCallback(async (cause: FallbackCause, currentProvider: ConnectionProviderId) => {
    setStep({ name: 'fallback', cause });
    setBusy(null);
    setError(null);
    setFallbackPhase('starting');
    leavingRef.current = true;
    let outcome: Awaited<ReturnType<typeof startHostedConnection>>;
    try {
      outcome = await startHostedConnection({ api: conn.api }, { provider: currentProvider, reconnectAccountId, returnTo });
    } catch {
      outcome = { ok: false, errorCode: 'network_lost', message: connectionErrorMessage('network_lost', currentProvider) };
    }
    if (!mountedRef.current) return;
    if (outcome.ok === false) {
      // La page de connexion standard n'a pas démarré : la tentative directe reste annulable à la fermeture.
      leavingRef.current = false;
      setError(outcome.message);
      setFallbackPhase('failed');
      return;
    }
    setFallbackPhase('redirecting');
  }, [conn.api, reconnectAccountId, returnTo]);

  /** Applique ce que le serveur annonce comme étape suivante. */
  const applyNext = useCallback((outcome: NextOutcome, currentProvider: ConnectionProviderId) => {
    switch (outcome.kind) {
      case 'redirect': {
        setBusy('redirect');
        setError(null);
        if (returnTo && returnTo !== 'settings' && attemptRef.current) rememberReturnTarget(attemptRef.current, returnTo);
        leavingRef.current = true;
        if (!goToProvider(outcome.url)) {
          leavingRef.current = false;
          failed(connectionErrorMessage('unknown', currentProvider), 'unknown');
        }
        return;
      }
      case 'fallback':
        void startFallback(outcome.cause, currentProvider);
        return;
      case 'step': {
        if (outcome.step.name === 'checkpoint' && outcome.step.checkpoint.type.toUpperCase() === 'CHALLENGE_SELECTION') {
          setChallenges(outcome.step.checkpoint.challenges ?? null);
        }
        goTo(outcome.step);
      }
    }
  }, [failed, goTo, returnTo, startFallback]);

  /** Applique la réponse d'un appel : étape suivante, erreur sous le champ ou écran d'échec. */
  const applyResult = useCallback((
    result: { ok: true; next: Parameters<typeof outcomeOfNext>[0] } | { ok: false; errorCode: string; message: string },
    phase: 'start' | 'checkpoint',
    currentProvider: ConnectionProviderId,
  ) => {
    if (result.ok === false) {
      const outcome: CallOutcome = outcomeOfFailure(result, phase);
      if (outcome.kind === 'failed') failed(outcome.message, outcome.code);
      else if (outcome.kind === 'error') {
        setBusy(null);
        setError(outcome.message);
      }
      return;
    }
    applyNext(outcomeOfNext(result.next), currentProvider);
  }, [applyNext, failed]);

  // ------------------------------------------------------------------------
  // Appels
  // ------------------------------------------------------------------------

  const startNative = useCallback(async (input: StartConnectionInput) => {
    setBusy('start');
    setError(null);
    const tz = browserTimezone();
    const result = await conn.start({
      ...input,
      mode: 'native',
      locale: 'fr',
      ...(tz ? { timezone: tz } : {}),
      ...(reconnectAccountId ? { reconnect_account_id: reconnectAccountId } : {}),
    });
    if (!mountedRef.current) {
      // La fenêtre s'est fermée pendant l'appel : la tentative créée ne sert plus.
      if (result.ok === true) void conn.api.cancel(result.attemptId).catch(() => undefined);
      return;
    }
    if (result.ok === true) attemptRef.current = result.attemptId;
    applyResult(result.ok === true ? { ok: true, next: result.next } : result, 'start', input.provider);
  }, [applyResult, conn, reconnectAccountId]);

  const answerCheckpoint = useCallback(async (input: { code?: string; challenge?: string }) => {
    const attemptId = attemptRef.current;
    if (!attemptId) {
      failed(connectionErrorMessage('attempt_not_found', provider, 'checkpoint'), 'attempt_not_found');
      return;
    }
    setBusy('checkpoint');
    setError(null);
    const result = await conn.checkpoint({ attemptId, ...input }, provider);
    if (!mountedRef.current) return;
    applyResult(result.ok === true ? { ok: true, next: result.next } : result, 'checkpoint', provider);
  }, [applyResult, conn, failed, provider]);

  const resend = useCallback(async (): Promise<boolean> => {
    const attemptId = attemptRef.current;
    if (!attemptId) return false;
    const result = await conn.resend({ attemptId }, provider);
    if (!mountedRef.current) return false;
    if (result.ok === false) {
      // Phrase de Konekt choisie d'après le code d'erreur (connectionApi.ts, failureMessage), jamais un texte du prestataire.
      const phrase = result.message;
      toast.error(phrase);
      return false;
    }
    toast.success(CHECKPOINT.resent);
    // Une validation sur le téléphone qui avait expiré repart pour un nouveau tour.
    const current = stepRef.current;
    if (current.name === 'checkpoint' && current.expired) setStep({ ...current, expired: false });
    return true;
  }, [conn, provider]);

  // ------------------------------------------------------------------------
  // Suivi de la tentative pendant une attente (QR code, téléphone, finalisation)
  // ------------------------------------------------------------------------

  const watchedKey = watchKey(step);
  const submittingCheckpoint = busy === 'checkpoint';
  useEffect(() => {
    const plan = watchPlan(stepRef.current);
    const attemptId = attemptRef.current;
    if (!plan || !attemptId || submittingCheckpoint) return undefined;

    let stale = false;
    const onUpdate = (view: AttemptStatusView) => {
      if (stale || !view.next || view.status !== 'pending') return;
      if (nextChangesStep(stepRef.current, view.next)) {
        stale = true;
        applyNext(outcomeOfNext(view.next), provider);
      }
    };
    const handle = conn.watch(attemptId, { waitingStep: plan.waitingStep, timeoutMs: plan.timeoutMs, onUpdate });
    void handle.result.then((result) => {
      if (stale || !mountedRef.current) return;
      switch (result.kind) {
        case 'aborted':
          return;
        case 'settled': {
          const view = result.view;
          if (view.status === 'completed') {
            goTo({ name: 'done', account: view.account ? { ...view.account, provider } : null });
          } else {
            const code = view.errorCode ?? (view.status === 'expired' ? 'attempt_expired' : 'attempt_closed');
            failed(view.errorMessage ?? connectionErrorMessage(code, provider, 'status'), code);
          }
          return;
        }
        case 'timeout': {
          const expired = expiredStep(stepRef.current);
          if (expired) goTo(expired);
          else failed(NATIVE.waitingTooLong, 'attempt_expired');
          return;
        }
        case 'error':
          failed(result.failure.message, result.failure.errorCode);
      }
    }).catch(() => {
      if (!stale && mountedRef.current) failed(connectionErrorMessage('network_lost', provider), 'network_lost');
    });
    return () => {
      stale = true;
      handle.stop();
    };
    // Relancé quand l'écran attendu change, pas à chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedKey, submittingCheckpoint]);

  // ------------------------------------------------------------------------
  // Gestes des écrans
  // ------------------------------------------------------------------------

  const cancel = useCallback(() => {
    conn.stopWatching();
    onClose();
  }, [conn, onClose]);

  const restart = useCallback(() => {
    const id = attemptRef.current;
    attemptRef.current = null;
    if (id) void conn.api.cancel(id).catch(() => undefined);
    leavingRef.current = false;
    setProvider(startProviderOf(initialProvider, reconnect, choices));
    goTo(entryStep(initialProvider, reconnect, choices));
  }, [choices, conn.api, goTo, initialProvider, reconnect]);

  const back = useCallback(() => {
    const target = previousStep(stepRef.current, { provider, reconnect, choices });
    if (target) goTo(target);
  }, [choices, goTo, provider, reconnect]);
  const hasBack = previousStep(step, { provider, reconnect, choices }) !== null;

  const chooseEmail = (next: 'google' | 'outlook' | 'imap') => {
    setProvider(next);
    goTo(emailStep(next));
  };

  /** Laisse tomber la tentative en cours (l'écran revient en arrière) : le serveur la clôt. */
  const dropAttempt = () => {
    const id = attemptRef.current;
    attemptRef.current = null;
    conn.stopWatching();
    if (id) void conn.api.cancel(id).catch(() => undefined);
  };

  const startQr = () => {
    if (step.name === 'qr') goTo({ name: 'qr', qrcode: null, expired: false });
    void startNative({ provider: 'whatsapp', whatsapp: { method: 'qr' } });
  };

  const startPairing = (digits: string) => {
    pairingDigitsRef.current = digits;
    void startNative({ provider: 'whatsapp', whatsapp: { method: 'pairing', phone_number: digits } });
  };

  const submitting = busy === 'start';
  const checkpointBusy = busy === 'checkpoint';

  // ------------------------------------------------------------------------
  // Rendu
  // ------------------------------------------------------------------------

  const body = (() => {
    switch (step.name) {
      case 'email_choice':
        return <EmailChoiceStep choices={choices} onChoose={chooseEmail} onCancel={cancel} />;
      case 'linkedin_credentials':
        return (
          <LinkedInCredentialsStep
            reconnect={reconnect}
            submitting={submitting}
            error={error}
            country={country}
            onCountry={setCountry}
            onSubmit={({ username, password }) => {
              void startNative({ provider: 'linkedin', country, linkedin: { method: 'credentials', username, password } });
            }}
            onCookie={() => goTo({ name: 'linkedin_cookie' })}
            onCancel={cancel}
          />
        );
      case 'linkedin_cookie':
        return (
          <LinkedInCookieStep
            submitting={submitting}
            error={error}
            country={country}
            onCountry={setCountry}
            onSubmit={({ accessToken, premiumToken, userAgent }) => {
              void startNative({
                provider: 'linkedin',
                country,
                linkedin: {
                  method: 'cookie',
                  access_token: accessToken,
                  ...(premiumToken ? { premium_access_token: premiumToken } : {}),
                  user_agent: userAgent,
                },
              });
            }}
            onBack={back}
            onCancel={cancel}
          />
        );
      case 'whatsapp_choice':
        return (
          <WhatsAppChoiceStep
            reconnect={reconnect}
            phoneFirst={isMobile}
            starting={submitting}
            error={error}
            onQr={startQr}
            onPairing={() => goTo({ name: 'whatsapp_phone' })}
            onCancel={cancel}
          />
        );
      case 'whatsapp_phone':
        return (
          <WhatsAppPhoneStep
            initialPhone={phone}
            submitting={submitting}
            error={error}
            onSubmit={(digits, display) => {
              setPhone(display);
              startPairing(digits);
            }}
            onBack={back}
            onCancel={cancel}
          />
        );
      case 'qr':
        return (
          <QrStep
            qrcode={step.qrcode}
            expired={step.expired}
            starting={submitting}
            error={error}
            onNew={startQr}
            onOtherMethod={() => { dropAttempt(); goTo({ name: 'whatsapp_choice' }); }}
            onCancel={cancel}
          />
        );
      case 'pairing':
        return (
          <PairingStep
            code={step.code}
            expired={step.expired}
            starting={submitting}
            error={error}
            onNew={() => { if (pairingDigitsRef.current) startPairing(pairingDigitsRef.current); else goTo({ name: 'whatsapp_phone' }); }}
            onCancel={cancel}
          />
        );
      case 'imap':
        return (
          <ImapStep
            reconnect={reconnect}
            submitting={submitting}
            error={error}
            onSubmit={({ user, password, imap, smtp }) => {
              void startNative({ provider: 'imap', imap: { user, password, ...(imap ? { imap } : {}), ...(smtp ? { smtp } : {}) } });
            }}
            onBack={hasBack ? back : null}
            onCancel={cancel}
          />
        );
      case 'oauth':
        return (
          <OAuthStep
            provider={provider === 'outlook' ? 'outlook' : 'google'}
            reconnect={reconnect}
            busy={submitting || busy === 'redirect'}
            redirecting={busy === 'redirect'}
            error={error}
            onContinue={() => { void startNative({ provider }); }}
            onBack={hasBack ? back : null}
            onCancel={cancel}
          />
        );
      case 'checkpoint': {
        const cp = step.checkpoint;
        const common = { provider, checkpoint: cp, submitting: checkpointBusy, error, onCancel: cancel };
        switch (cp.type.toUpperCase()) {
          case 'IN_APP_VALIDATION':
            return <WaitStep provider={provider} checkpoint={cp} expired={step.expired} onResend={resend} onCancel={cancel} />;
          case 'CHALLENGE_SELECTION':
            return <ChallengeStep {...common} onSubmit={(challenge) => { void answerCheckpoint({ challenge }); }} />;
          case 'CONTRACT_SELECTION':
            return <ContractStep {...common} onSubmit={(code) => { void answerCheckpoint({ code }); }} />;
          case 'CONSENT_SCREEN':
            return <ConsentStep {...common} onSubmit={(code) => { void answerCheckpoint({ code }); }} />;
          default:
            return (
              <CodeStep
                {...common}
                expired={step.expired}
                onResend={resend}
                onSubmit={(code) => { void answerCheckpoint({ code }); }}
                onChangeMethod={challenges && challenges.length > 1
                  ? () => goTo({ name: 'checkpoint', checkpoint: { kind: 'checkpoint', type: 'CHALLENGE_SELECTION', challenges }, expired: false })
                  : undefined}
              />
            );
        }
      }
      case 'loading':
        return <LoadingStep provider={provider} onCancel={cancel} />;
      case 'fallback':
        return (
          <FallbackStep
            provider={provider}
            cause={step.cause}
            phase={fallbackPhase}
            error={error}
            onRetry={() => { void startFallback(step.cause, provider); }}
            onClose={cancel}
          />
        );
      case 'done':
        return <DoneStep provider={provider} reconnect={reconnect} account={step.account} onFinish={onClose} />;
      case 'failed':
        return <FailedStep message={step.message} onRestart={restart} onClose={onClose} />;
    }
  })();

  return <div key={stepKey(step)} className="contents">{body}</div>;
}
