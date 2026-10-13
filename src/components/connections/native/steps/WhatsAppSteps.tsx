/**
 * Étapes WhatsApp de l'assistant de connexion directe : choix de la méthode,
 * QR code à scanner, numéro de téléphone puis code d'association à saisir dans
 * l'application.
 */

import { useState, type FormEvent } from 'react';
import { Copy, QrCode as QrIcon, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CHECKPOINT,
  FLOW,
  NATIVE,
  WHATSAPP,
  checkpointCopy,
  startBody,
  startTitle,
} from '@/lib/connectionCopy';
import { checkPhone, formatPairingCode } from '../nativeFlow';
import { QrCode } from '../QrCode';
import { ChoiceTile, Field, FooterButton, FormError, StepFooter, StepFrame, WaitLine } from './StepParts';

// ---------------------------------------------------------------------------
// Choix de la méthode
// ---------------------------------------------------------------------------

export function WhatsAppChoiceStep({
  reconnect,
  phoneFirst,
  starting,
  error,
  onQr,
  onPairing,
  onCancel,
}: {
  reconnect: boolean;
  /** Sur téléphone, le code d'association passe en premier : un téléphone ne scanne pas son propre écran. */
  phoneFirst: boolean;
  starting: boolean;
  error: string | null;
  onQr: () => void;
  onPairing: () => void;
  onCancel: () => void;
}) {
  const qr = (
    <ChoiceTile
      key="qr"
      icon={<QrIcon className="h-5 w-5" aria-hidden="true" />}
      title={WHATSAPP.qrTile.title}
      body={WHATSAPP.qrTile.body}
      onClick={onQr}
      loading={starting}
      disabled={starting}
    />
  );
  const pairing = (
    <ChoiceTile
      key="pairing"
      icon={<Smartphone className="h-5 w-5" aria-hidden="true" />}
      title={WHATSAPP.pairingTile.title}
      body={WHATSAPP.pairingTile.body}
      onClick={onPairing}
      disabled={starting}
    />
  );
  return (
    <StepFrame heading={startTitle('whatsapp', reconnect)} description={<p>{startBody('whatsapp')}</p>}>
      <div className="grid gap-2">{phoneFirst ? [pairing, qr] : [qr, pairing]}</div>
      {error && <FormError>{error}</FormError>}
      <StepFooter>
        <FooterButton type="button" variant="ghost" onClick={onCancel}>{FLOW.cancel}</FooterButton>
      </StepFooter>
    </StepFrame>
  );
}

// ---------------------------------------------------------------------------
// QR code
// ---------------------------------------------------------------------------

export function QrStep({
  qrcode,
  expired,
  starting,
  error,
  onNew,
  onOtherMethod,
  onCancel,
}: {
  qrcode: string | null;
  expired: boolean;
  starting: boolean;
  error: string | null;
  onNew: () => void;
  onOtherMethod: () => void;
  onCancel: () => void;
}) {
  return (
    <StepFrame heading={WHATSAPP.qrHeading} description={(
      <ol className="list-decimal space-y-1 pl-4">
        {WHATSAPP.qrSteps.map((step) => <li key={step}>{step}</li>)}
      </ol>
    )} focusHeading>
      <div className="flex flex-col items-center gap-3">
        {qrcode && !expired ? (
          <QrCode value={qrcode} alt={WHATSAPP.qrAlt} />
        ) : (
          <Skeleton className="aspect-square w-full max-w-[16rem] rounded-xl" aria-hidden="true" />
        )}
        {starting && <WaitLine>{WHATSAPP.qrGenerating}</WaitLine>}
        {!starting && !expired && qrcode && <WaitLine>{WHATSAPP.qrWaiting}</WaitLine>}
        {!starting && expired && <p role="status" className="text-sm text-muted-foreground">{WHATSAPP.qrExpired}</p>}
      </div>
      {error && <FormError>{error}</FormError>}
      <StepFooter>
        <FooterButton type="button" variant="ghost" onClick={onCancel}>{FLOW.cancel}</FooterButton>
        <FooterButton type="button" variant="ghost" onClick={onOtherMethod} disabled={starting}>{WHATSAPP.otherMethod}</FooterButton>
        {(expired || error) && (
          <FooterButton type="button" variant="primary" onClick={onNew} loading={starting}>{WHATSAPP.qrNew}</FooterButton>
        )}
      </StepFooter>
    </StepFrame>
  );
}

// ---------------------------------------------------------------------------
// Numéro de téléphone (code d'association)
// ---------------------------------------------------------------------------

export function WhatsAppPhoneStep({
  initialPhone,
  submitting,
  error,
  onSubmit,
  onBack,
  onCancel,
}: {
  initialPhone: string;
  submitting: boolean;
  error: string | null;
  /** Numéro en chiffres seuls, avec l'indicatif du pays. */
  onSubmit: (digits: string, display: string) => void;
  onBack: () => void;
  onCancel: () => void;
}) {
  const [phone, setPhone] = useState(initialPhone);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const checked = checkPhone(phone);
    if (checked.ok === false) {
      setProblem(checked.problem === 'national' ? WHATSAPP.phoneNational : WHATSAPP.phoneInvalid);
      return;
    }
    setProblem(null);
    onSubmit(checked.digits, phone.trim());
  };

  return (
    <StepFrame heading={WHATSAPP.pairingTile.title} description={<p>{WHATSAPP.pairingTile.body}</p>}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <fieldset disabled={submitting} className="min-w-0 border-0 p-0">
          <Field
            label={WHATSAPP.phoneField}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            autoFocus
            help={WHATSAPP.phoneHelp}
            value={phone}
            onChange={(e) => { setPhone(e.target.value); if (problem) setProblem(null); }}
            error={problem}
          />
        </fieldset>
        {error && <FormError>{error}</FormError>}
        <StepFooter>
          <FooterButton type="button" variant="ghost" onClick={onCancel}>{FLOW.cancel}</FooterButton>
          <FooterButton type="button" variant="ghost" onClick={onBack} disabled={submitting}>{FLOW.back}</FooterButton>
          <FooterButton type="submit" variant="primary" loading={submitting}>{WHATSAPP.getCode}</FooterButton>
        </StepFooter>
      </form>
    </StepFrame>
  );
}

// ---------------------------------------------------------------------------
// Code d'association
// ---------------------------------------------------------------------------

export function PairingStep({
  code,
  expired,
  starting,
  error,
  onNew,
  onCancel,
}: {
  code: string;
  expired: boolean;
  starting: boolean;
  error: string | null;
  onNew: () => void;
  onCancel: () => void;
}) {
  const copy = checkpointCopy({ type: 'PAIRING_CODE' }, 'whatsapp');
  const shown = formatPairingCode(code);
  const [copying, setCopying] = useState(false);

  const copyCode = async () => {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(shown);
      toast.success(CHECKPOINT.codeCopied);
    } catch {
      toast.error(NATIVE.copyFailed);
    } finally {
      setCopying(false);
    }
  };

  return (
    <StepFrame heading={copy.heading} description={<p>{copy.body}</p>} focusHeading>
      <div className="flex flex-col items-center gap-3">
        <p className="select-all rounded-xl bg-muted px-5 py-4 text-center font-mono text-2xl font-semibold tracking-[0.2em] text-foreground sm:text-3xl">
          <span className="sr-only">{WHATSAPP.pairingAria} : {shown.replace(/-/g, ' ').split('').join(' ')}</span>
          <span aria-hidden="true">{shown}</span>
        </p>
        {!expired && (
          <Button type="button" variant="ghost" size="sm" className="max-md:h-11" onClick={() => { void copyCode(); }} disabled={copying}>
            <Copy aria-hidden="true" />
            {CHECKPOINT.copyCode}
          </Button>
        )}
        {expired ? <p role="status" className="text-sm text-muted-foreground">{WHATSAPP.pairingExpired}</p> : <WaitLine>{WHATSAPP.pairingWaiting}</WaitLine>}
      </div>
      {error && <FormError>{error}</FormError>}
      <StepFooter>
        <FooterButton type="button" variant="ghost" onClick={onCancel}>{FLOW.cancel}</FooterButton>
        {expired && <FooterButton type="button" variant="primary" onClick={onNew} loading={starting}>{WHATSAPP.qrNew}</FooterButton>}
      </StepFooter>
    </StepFrame>
  );
}
