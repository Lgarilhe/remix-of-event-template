/**
 * Vérifications demandées pendant la connexion, une étape par type du serveur :
 * code reçu (OTP, 2FA), validation sur le téléphone (IN_APP_VALIDATION), l'un
 * ou l'autre (OTP_OR_IN_APP_VALIDATION), choix d'une méthode
 * (CHALLENGE_SELECTION), du contrat (CONTRACT_SELECTION), des offres
 * (CONSENT_SCREEN) et finalisation (LOADING). Le code d'association WhatsApp
 * (PAIRING_CODE) est dans WhatsAppSteps.tsx. CAPTCHA et tout type inconnu ne
 * passent pas ici : l'assistant bascule sur la page de connexion standard.
 *
 * Le texte de chaque étape vient de `checkpointCopy` (src/lib/connectionCopy.ts).
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  CHECKPOINT,
  CHECKPOINT_EYEBROW,
  FLOW,
  NATIVE,
  challengeLabel,
  checkpointCopy,
  contractLabel,
  productLabel,
  safeServerMessage,
  type ConnectionProviderId,
} from '@/lib/connectionCopy';
import type { CheckpointStep } from '../../connectionApi';
import {
  RESEND_COOLDOWN_MS,
  codePlausible,
  consentCode,
  defaultProductSelection,
  hasExclusiveProducts,
  normalizeCode,
  resendSecondsLeft,
  toggleProduct,
} from '../nativeFlow';
import { Field, FooterButton, FormError, InfoBox, OPTION_ROW, StepFrame, StepFooter, WaitLine } from './StepParts';

interface CommonProps {
  provider: ConnectionProviderId;
  checkpoint: CheckpointStep;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
}

/** Secondes avant de pouvoir renvoyer, recalculées chaque seconde tant qu'il en reste. */
function useSecondsLeft(sentAt: number): number {
  const [, tick] = useState(0);
  const left = resendSecondsLeft(sentAt, Date.now(), RESEND_COOLDOWN_MS);
  useEffect(() => {
    if (left <= 0) return undefined;
    const timer = window.setTimeout(() => tick((n) => n + 1), 1000);
    return () => window.clearTimeout(timer);
  }, [left]);
  return left;
}

/** « Renvoyer le code » (ou la notification), avec le décompte avant le prochain envoi. */
function ResendButton({
  notification,
  sentAt,
  busy,
  onResend,
}: {
  notification: boolean;
  sentAt: number;
  busy: boolean;
  onResend: () => void;
}) {
  const left = useSecondsLeft(sentAt);
  const label = left > 0 ? CHECKPOINT.resendIn(left) : notification ? CHECKPOINT.resendNotification : CHECKPOINT.resend;
  return (
    <FooterButton type="button" variant="ghost" onClick={onResend} disabled={left > 0 || busy}>
      {label}
    </FooterButton>
  );
}

// ---------------------------------------------------------------------------
// Code reçu (OTP, 2FA, OTP_OR_IN_APP_VALIDATION)
// ---------------------------------------------------------------------------

export interface CodeStepProps extends CommonProps {
  /** Renvoie le code ; vrai si le serveur l'a renvoyé. */
  onResend: () => Promise<boolean>;
  onSubmit: (code: string) => void;
  /** Une autre méthode a été proposée plus tôt : le lien y ramène. */
  onChangeMethod?: () => void;
  /** Le délai de validation sur le téléphone est écoulé. */
  expired: boolean;
}

export function CodeStep({ provider, checkpoint, submitting, error, expired, onResend, onSubmit, onChangeMethod, onCancel }: CodeStepProps) {
  const copy = checkpointCopy(checkpoint, provider);
  const both = checkpoint.type.toUpperCase() === 'OTP_OR_IN_APP_VALIDATION';
  const [code, setCode] = useState('');
  const [missing, setMissing] = useState(false);
  const [sentAt, setSentAt] = useState(() => Date.now());
  const [resending, setResending] = useState(false);

  // Un code refusé se ressaisit : le champ est vidé et reprend le focus.
  useEffect(() => {
    if (error) {
      setCode('');
      document.getElementById('connexion-code')?.focus();
    }
  }, [error]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (!codePlausible(code)) {
      setMissing(true);
      return;
    }
    setMissing(false);
    onSubmit(normalizeCode(code));
  };

  const resend = async () => {
    setResending(true);
    const sent = await onResend();
    setResending(false);
    if (sent) setSentAt(Date.now());
  };

  return (
    <StepFrame eyebrow={CHECKPOINT_EYEBROW(provider)} heading={copy.heading} description={<p>{copy.body}</p>}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {both && !expired && <WaitLine>{CHECKPOINT.waiting}</WaitLine>}
        {both && !expired && <p className="text-xs text-muted-foreground" aria-hidden="true">{CHECKPOINT.or}</p>}
        {both && expired && <p className="text-sm text-muted-foreground">{NATIVE.waitingTooLong}</p>}
        <fieldset disabled={submitting} className="min-w-0 border-0 p-0">
          <Field
            id="connexion-code"
            label={CHECKPOINT.codeField}
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            maxLength={16}
            autoFocus
            className="font-mono tracking-widest"
            value={code}
            onChange={(e) => { setCode(e.target.value); if (missing) setMissing(false); }}
            error={missing ? NATIVE.codeMissing : null}
          />
        </fieldset>
        {error && <FormError>{error}</FormError>}

        <StepFooter>
          <FooterButton type="button" variant="ghost" onClick={onCancel}>{FLOW.cancel}</FooterButton>
          {copy.canResend && <ResendButton notification={false} sentAt={sentAt} busy={resending || submitting} onResend={() => { void resend(); }} />}
          <FooterButton type="submit" variant="primary" loading={submitting}>{copy.primary}</FooterButton>
        </StepFooter>
      </form>
      {onChangeMethod && (
        <FooterButton type="button" variant="ghost" size="sm" className="-ml-3 w-auto self-start" onClick={onChangeMethod} disabled={submitting}>
          {CHECKPOINT.anotherMethod}
        </FooterButton>
      )}
    </StepFrame>
  );
}

// ---------------------------------------------------------------------------
// Validation sur le téléphone (IN_APP_VALIDATION)
// ---------------------------------------------------------------------------

export function WaitStep({
  provider,
  checkpoint,
  expired,
  onResend,
  onCancel,
}: Omit<CommonProps, 'submitting' | 'error'> & { expired: boolean; onResend: () => Promise<boolean> }) {
  const copy = checkpointCopy(checkpoint, provider);
  const [sentAt, setSentAt] = useState(() => Date.now());
  const [resending, setResending] = useState(false);

  const resend = async () => {
    setResending(true);
    const sent = await onResend();
    setResending(false);
    if (sent) setSentAt(Date.now());
  };

  return (
    <StepFrame eyebrow={CHECKPOINT_EYEBROW(provider)} heading={copy.heading} description={<p>{copy.body}</p>} focusHeading>
      {expired ? <p className="text-sm text-muted-foreground">{NATIVE.waitingTooLong}</p> : <WaitLine>{CHECKPOINT.waiting}</WaitLine>}
      <StepFooter>
        <FooterButton type="button" variant="ghost" onClick={onCancel}>{FLOW.cancel}</FooterButton>
        <ResendButton notification sentAt={sentAt} busy={resending} onResend={() => { void resend(); }} />
      </StepFooter>
    </StepFrame>
  );
}

// ---------------------------------------------------------------------------
// Choix d'une méthode de vérification (CHALLENGE_SELECTION)
// ---------------------------------------------------------------------------

export function ChallengeStep({ provider, checkpoint, submitting, error, onSubmit, onCancel }: CommonProps & { onSubmit: (id: string) => void }) {
  const copy = checkpointCopy(checkpoint, provider);
  const challenges = checkpoint.challenges ?? [];
  const [selected, setSelected] = useState('');

  return (
    <StepFrame eyebrow={CHECKPOINT_EYEBROW(provider)} heading={copy.heading} description={<p>{copy.body}</p>} focusHeading>
      <RadioGroup value={selected} onValueChange={setSelected} aria-label={copy.heading} disabled={submitting} className="gap-2">
        {challenges.map((c) => {
          const id = `connexion-methode-${c.id}`;
          return (
            <Label key={c.id} htmlFor={id} className={OPTION_ROW}>
              <RadioGroupItem id={id} value={c.id} className="mt-0.5" />
              <span className="min-w-0 space-y-0.5">
                <span className="block text-sm font-medium text-foreground">{challengeLabel(c.id, c.label)}</span>
                {safeServerMessage(c.description) && <span className="block text-xs font-normal text-muted-foreground">{safeServerMessage(c.description)}</span>}
              </span>
            </Label>
          );
        })}
      </RadioGroup>
      {error && <FormError>{error}</FormError>}
      <StepFooter>
        <FooterButton type="button" variant="ghost" onClick={onCancel}>{FLOW.cancel}</FooterButton>
        <FooterButton type="button" variant="primary" loading={submitting} disabled={selected === ''} onClick={() => onSubmit(selected)}>
          {copy.primary}
        </FooterButton>
      </StepFooter>
    </StepFrame>
  );
}

// ---------------------------------------------------------------------------
// Choix du contrat (CONTRACT_SELECTION)
// ---------------------------------------------------------------------------

export function ContractStep({ provider, checkpoint, submitting, error, onSubmit, onCancel }: CommonProps & { onSubmit: (id: string) => void }) {
  const copy = checkpointCopy(checkpoint, provider);
  const contracts = checkpoint.contracts ?? [];
  const [selected, setSelected] = useState('');

  return (
    <StepFrame eyebrow={CHECKPOINT_EYEBROW(provider)} heading={copy.heading} description={<p>{copy.body}</p>} focusHeading>
      <RadioGroup value={selected} onValueChange={setSelected} aria-label={copy.heading} disabled={submitting} className="gap-2">
        {contracts.map((c) => {
          const id = `connexion-contrat-${c.id}`;
          return (
            <Label key={c.id} htmlFor={id} className={OPTION_ROW}>
              <RadioGroupItem id={id} value={c.id} className="mt-0.5" />
              <span className="min-w-0 break-words text-sm font-medium text-foreground">{contractLabel(c.name)}</span>
            </Label>
          );
        })}
      </RadioGroup>
      {error && <FormError>{error}</FormError>}
      <StepFooter>
        <FooterButton type="button" variant="ghost" onClick={onCancel}>{FLOW.cancel}</FooterButton>
        <FooterButton type="button" variant="primary" loading={submitting} disabled={selected === ''} onClick={() => onSubmit(selected)}>
          {copy.primary}
        </FooterButton>
      </StepFooter>
    </StepFrame>
  );
}

// ---------------------------------------------------------------------------
// Choix des offres (CONSENT_SCREEN)
// ---------------------------------------------------------------------------

export function ConsentStep({ provider, checkpoint, submitting, error, onSubmit, onCancel }: CommonProps & { onSubmit: (code: string) => void }) {
  const copy = checkpointCopy(checkpoint, provider);
  const products = checkpoint.products ?? [];
  const [selected, setSelected] = useState<string[]>(() => defaultProductSelection(products));
  const exclusive = hasExclusiveProducts(products);

  return (
    <StepFrame eyebrow={CHECKPOINT_EYEBROW(provider)} heading={copy.heading} description={<p>{copy.body}</p>} focusHeading>
      <div role="group" aria-label={copy.heading} className="grid gap-2">
        {products.map((p) => {
          const id = `connexion-offre-${p.id}`;
          return (
            <Label key={p.id} htmlFor={id} className={OPTION_ROW}>
              <Checkbox
                id={id}
                className="mt-0.5"
                checked={selected.includes(p.id)}
                disabled={submitting}
                onCheckedChange={(checked) => setSelected((current) => toggleProduct(current, p.id, checked === true, products))}
              />
              <span className="min-w-0 text-sm font-medium text-foreground">{productLabel(p.id, p.display_name)}</span>
            </Label>
          );
        })}
      </div>
      {exclusive && <InfoBox><p>{CHECKPOINT.oneProduct}</p></InfoBox>}
      {selected.length === 0 && <p className="text-sm text-muted-foreground">{CHECKPOINT.noProduct}</p>}
      {error && <FormError>{error}</FormError>}
      <StepFooter>
        <FooterButton type="button" variant="ghost" onClick={onCancel}>{FLOW.cancel}</FooterButton>
        <FooterButton
          type="button"
          variant="primary"
          loading={submitting}
          disabled={selected.length === 0}
          onClick={() => onSubmit(consentCode(selected, products))}
        >
          {copy.primary}
        </FooterButton>
      </StepFooter>
    </StepFrame>
  );
}

// ---------------------------------------------------------------------------
// Finalisation (LOADING)
// ---------------------------------------------------------------------------

export function LoadingStep({ provider, onCancel }: { provider: ConnectionProviderId; onCancel: () => void }) {
  const copy = checkpointCopy({ type: 'LOADING' }, provider);
  return (
    <StepFrame heading={copy.heading} description={<p>{copy.body}</p>} focusHeading>
      <WaitLine>{FLOW.working}</WaitLine>
      <StepFooter>
        <FooterButton type="button" variant="ghost" onClick={onCancel}>{FLOW.cancel}</FooterButton>
      </StepFooter>
    </StepFrame>
  );
}
