/**
 * Étapes de messagerie de l'assistant de connexion directe : choix de la boîte,
 * redirection vers Google ou Microsoft, formulaire IMAP et SMTP.
 *
 * Le mot de passe vit dans le champ du navigateur (voir StepParts.tsx).
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChannelIcon } from '@/components/ui/ChannelIcon';
import { cn } from '@/lib/utils';
import {
  EMAIL,
  FLOW,
  HOSTED,
  NATIVE,
  REDIRECTING,
  startBody,
  startTitle,
  type ConnectionProviderId,
} from '@/lib/connectionCopy';
import {
  DEFAULT_IMAP_SERVER,
  DEFAULT_SMTP_SERVER,
  ENCRYPTIONS,
  checkServers,
  type Encryption,
  type ServerFields,
} from '../nativeFlow';
import { ChoiceTile, Field, FooterButton, FormError, SecretField, StepFooter, StepFrame, takeSecret } from './StepParts';

// ---------------------------------------------------------------------------
// Choix de la messagerie
// ---------------------------------------------------------------------------

export function EmailChoiceStep({
  choices,
  onChoose,
  onCancel,
}: {
  choices: readonly ('google' | 'outlook' | 'imap')[];
  onChoose: (provider: 'google' | 'outlook' | 'imap') => void;
  onCancel: () => void;
}) {
  return (
    <StepFrame heading={startTitle('imap', false)} description={<p>{EMAIL.chooserHint}</p>}>
      <div className="grid gap-2">
        {choices.map((provider) => (
          <ChoiceTile
            key={provider}
            icon={provider === 'imap' ? <Mail className="h-5 w-5" aria-hidden="true" /> : <ChannelIcon channel="email" size="md" decorative />}
            title={EMAIL.tiles[provider].title}
            body={EMAIL.tiles[provider].body}
            onClick={() => onChoose(provider)}
          />
        ))}
      </div>
      <StepFooter>
        <FooterButton type="button" variant="ghost" onClick={onCancel}>{FLOW.cancel}</FooterButton>
      </StepFooter>
    </StepFrame>
  );
}

// ---------------------------------------------------------------------------
// Gmail et Outlook : redirection
// ---------------------------------------------------------------------------

export function OAuthStep({
  provider,
  reconnect,
  busy,
  redirecting,
  error,
  onContinue,
  onBack,
  onCancel,
}: {
  provider: Extract<ConnectionProviderId, 'google' | 'outlook'>;
  reconnect: boolean;
  busy: boolean;
  redirecting: boolean;
  error: string | null;
  onContinue: () => void;
  onBack: (() => void) | null;
  onCancel: () => void;
}) {
  return (
    <StepFrame heading={startTitle(provider, reconnect)} description={<p>{HOSTED[provider].body}</p>}>
      {error && <FormError>{error}</FormError>}
      <StepFooter>
        <FooterButton type="button" variant="ghost" onClick={onCancel} disabled={redirecting}>{FLOW.cancel}</FooterButton>
        {onBack && <FooterButton type="button" variant="ghost" onClick={onBack} disabled={busy}>{FLOW.back}</FooterButton>}
        <FooterButton type="button" variant="primary" loading={busy} onClick={onContinue}>
          {redirecting ? REDIRECTING : HOSTED[provider].action}
        </FooterButton>
      </StepFooter>
    </StepFrame>
  );
}

// ---------------------------------------------------------------------------
// Autre messagerie (IMAP et SMTP)
// ---------------------------------------------------------------------------

export interface ImapSubmit {
  user: string;
  password: string;
  imap?: { host: string; port: number; encryption: Encryption };
  smtp?: { host: string; port: number; encryption: Encryption };
}

function ServerBlock({
  title,
  prefix,
  value,
  onChange,
  disabled,
  error,
}: {
  title: string;
  prefix: string;
  value: ServerFields;
  onChange: (next: ServerFields) => void;
  disabled: boolean;
  error: string | null;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <Field
        label={EMAIL.host}
        id={`${prefix}-hote`}
        type="text"
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoComplete="off"
        disabled={disabled}
        value={value.host}
        onChange={(e) => onChange({ ...value, host: e.target.value })}
        error={error}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field
          label={EMAIL.port}
          id={`${prefix}-port`}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          value={value.port}
          onChange={(e) => onChange({ ...value, port: e.target.value })}
        />
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-chiffrement`}>{EMAIL.encryption}</Label>
          <Select value={value.encryption} onValueChange={(next) => onChange({ ...value, encryption: next as Encryption })} disabled={disabled}>
            <SelectTrigger id={`${prefix}-chiffrement`} className="max-md:h-11 max-md:text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENCRYPTIONS.map((e) => (
                <SelectItem key={e} value={e}>{EMAIL.encryptionOptions[e]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

export function ImapStep({
  reconnect,
  submitting,
  error,
  onSubmit,
  onBack,
  onCancel,
}: {
  reconnect: boolean;
  submitting: boolean;
  error: string | null;
  onSubmit: (input: ImapSubmit) => void;
  onBack: (() => void) | null;
  onCancel: () => void;
}) {
  const [address, setAddress] = useState('');
  const [missing, setMissing] = useState<'address' | 'password' | null>(null);
  const [open, setOpen] = useState(false);
  const [imap, setImap] = useState<ServerFields>(DEFAULT_IMAP_SERVER);
  const [smtp, setSmtp] = useState<ServerFields>(DEFAULT_SMTP_SERVER);
  const [serverError, setServerError] = useState<{ which: 'imap' | 'smtp' | 'both'; text: string } | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (error) passwordRef.current?.focus();
  }, [error]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const user = address.trim();
    if (user === '') {
      setMissing('address');
      return;
    }
    if (!passwordRef.current?.value) {
      setMissing('password');
      passwordRef.current?.focus();
      return;
    }
    const checked = checkServers(imap, smtp);
    if (checked.ok === false) {
      setOpen(true);
      setServerError({
        which: checked.which,
        text: checked.problem === 'host' ? EMAIL.hostMissing : checked.problem === 'port' ? EMAIL.portInvalid : EMAIL.serverPair,
      });
      return;
    }
    setMissing(null);
    setServerError(null);
    onSubmit({ user, password: takeSecret(passwordRef.current), ...(checked.servers ?? {}) });
  };

  return (
    <StepFrame
      heading={startTitle('imap', reconnect)}
      description={(
        <>
          <p>{startBody('imap')}</p>
          {reconnect && <p className="mt-1.5">{NATIVE.reconnectOnly}</p>}
        </>
      )}
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <fieldset disabled={submitting} className="min-w-0 space-y-4 border-0 p-0">
          <Field
            label={EMAIL.address}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            value={address}
            onChange={(e) => { setAddress(e.target.value); if (missing === 'address') setMissing(null); }}
            error={missing === 'address' ? NATIVE.addressMissing : null}
          />
          <SecretField
            ref={passwordRef}
            label={EMAIL.password}
            name="password"
            autoComplete="new-password"
            help={EMAIL.imapHelp}
            onChange={() => { if (missing === 'password') setMissing(null); }}
            error={missing === 'password' ? NATIVE.passwordMissing : null}
          />
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="-ml-3 max-md:h-11" aria-expanded={open}>
                {EMAIL.serverSettings}
                <ChevronDown className={cn('transition-transform duration-150', open && 'rotate-180')} aria-hidden="true" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-5 pt-2">
              <ServerBlock
                title={EMAIL.incoming}
                prefix="connexion-imap"
                value={imap}
                onChange={setImap}
                disabled={submitting}
                error={serverError && serverError.which !== 'smtp' ? serverError.text : null}
              />
              <ServerBlock
                title={EMAIL.outgoing}
                prefix="connexion-smtp"
                value={smtp}
                onChange={setSmtp}
                disabled={submitting}
                error={serverError?.which === 'smtp' ? serverError.text : null}
              />
            </CollapsibleContent>
          </Collapsible>
        </fieldset>

        {error && (
          <div className="space-y-1">
            <FormError>{error}</FormError>
            {!open && <p className="text-xs text-muted-foreground">{EMAIL.settingsHint}</p>}
          </div>
        )}

        <StepFooter>
          <FooterButton type="button" variant="ghost" onClick={onCancel}>{FLOW.cancel}</FooterButton>
          {onBack && <FooterButton type="button" variant="ghost" onClick={onBack} disabled={submitting}>{FLOW.back}</FooterButton>}
          <FooterButton type="submit" variant="primary" loading={submitting}>{EMAIL.submit}</FooterButton>
        </StepFooter>
      </form>
    </StepFrame>
  );
}
