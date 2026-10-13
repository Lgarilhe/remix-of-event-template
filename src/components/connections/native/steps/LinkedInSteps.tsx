/**
 * Étapes LinkedIn de l'assistant de connexion directe : identifiant et mot de
 * passe, puis connexion avancée par cookie.
 *
 * Le mot de passe et le cookie vivent dans le champ du navigateur : l'étape les
 * lit à l'envoi (`takeSecret`) et efface le champ dans le même geste. Ils ne
 * passent par aucun état, aucune journalisation et aucun message d'erreur.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  FLOW,
  LINKEDIN_COOKIE,
  LINKEDIN_CREDENTIALS,
  LINKEDIN_METHODS,
  NATIVE,
  startBody,
  startTitle,
} from '@/lib/connectionCopy';
import { browserUserAgent } from '../../connectionApi';
import { COUNTRIES } from '../nativeFlow';
import { Button } from '@/components/ui/button';
import { Field, FooterButton, FormError, InfoBox, SecretField, StepFrame, StepFooter, WaitLine, takeSecret } from './StepParts';

interface CountryProps {
  country: string;
  onCountry: (code: string) => void;
}

/** « Options avancées » : le pays d'où partent les actions, avec son explication. */
function AdvancedOptions({ country, onCountry, disabled }: CountryProps & { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="-ml-3 max-md:h-11" aria-expanded={open}>
          {LINKEDIN_CREDENTIALS.advanced}
          <ChevronDown className={cn('transition-transform duration-150', open && 'rotate-180')} aria-hidden="true" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-1.5 pt-1">
        <Label htmlFor="connexion-pays">{LINKEDIN_CREDENTIALS.country}</Label>
        <Select value={country} onValueChange={onCountry} disabled={disabled}>
          <SelectTrigger id="connexion-pays" aria-describedby="connexion-pays-aide" className="max-md:h-11 max-md:text-base">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COUNTRIES.map((c) => (
              <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p id="connexion-pays-aide" className="text-xs text-muted-foreground">{LINKEDIN_CREDENTIALS.countryHelp}</p>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// Identifiant et mot de passe
// ---------------------------------------------------------------------------

export interface LinkedInCredentialsStepProps extends CountryProps {
  reconnect: boolean;
  submitting: boolean;
  /** Erreur du serveur à afficher sous le formulaire. */
  error: string | null;
  onSubmit: (input: { username: string; password: string }) => void;
  onCookie: () => void;
  onCancel: () => void;
}

export function LinkedInCredentialsStep({
  reconnect,
  submitting,
  error,
  country,
  onCountry,
  onSubmit,
  onCookie,
  onCancel,
}: LinkedInCredentialsStepProps) {
  const [username, setUsername] = useState('');
  const [missing, setMissing] = useState<'username' | 'password' | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);

  // Une réponse du serveur vide le mot de passe : la personne le ressaisit.
  useEffect(() => {
    if (error) passwordRef.current?.focus();
  }, [error]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const name = username.trim();
    if (name === '') {
      setMissing('username');
      usernameRef.current?.focus();
      return;
    }
    if (!passwordRef.current?.value) {
      setMissing('password');
      passwordRef.current?.focus();
      return;
    }
    setMissing(null);
    onSubmit({ username: name, password: takeSecret(passwordRef.current) });
  };

  return (
    <StepFrame
      heading={startTitle('linkedin', reconnect)}
      description={(
        <>
          <p>{startBody('linkedin')}</p>
          {reconnect && <p className="mt-1.5">{NATIVE.reconnectOnly}</p>}
        </>
      )}
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <fieldset disabled={submitting} className="min-w-0 space-y-4 border-0 p-0">
          <Field
            ref={usernameRef}
            label={LINKEDIN_CREDENTIALS.username}
            name="username"
            type="text"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            value={username}
            onChange={(e) => { setUsername(e.target.value); if (missing === 'username') setMissing(null); }}
            error={missing === 'username' ? NATIVE.usernameMissing : null}
          />
          <SecretField
            ref={passwordRef}
            label={LINKEDIN_CREDENTIALS.password}
            name="password"
            autoComplete="new-password"
            help={NATIVE.passwordNotStored}
            onChange={() => { if (missing === 'password') setMissing(null); }}
            error={missing === 'password' ? NATIVE.passwordMissing : null}
          />
          <AdvancedOptions country={country} onCountry={onCountry} disabled={submitting} />
        </fieldset>

        {error && <FormError>{error}</FormError>}
        {submitting && <WaitLine>{LINKEDIN_CREDENTIALS.submitting}</WaitLine>}

        <StepFooter>
          <FooterButton type="button" variant="ghost" onClick={onCancel}>{FLOW.cancel}</FooterButton>
          <FooterButton type="submit" variant="primary" loading={submitting}>{LINKEDIN_CREDENTIALS.submit}</FooterButton>
        </StepFooter>
      </form>

      <div className="space-y-1 border-t border-border pt-4">
        <Button type="button" variant="ghost" size="sm" className="-ml-3 max-md:h-11" onClick={onCookie} disabled={submitting}>
          {LINKEDIN_METHODS.cookie.title}
        </Button>
        <p className="text-xs text-muted-foreground">{LINKEDIN_METHODS.cookie.body}</p>
      </div>
    </StepFrame>
  );
}

// ---------------------------------------------------------------------------
// Cookie
// ---------------------------------------------------------------------------

export interface LinkedInCookieStepProps extends CountryProps {
  submitting: boolean;
  error: string | null;
  onSubmit: (input: { accessToken: string; premiumToken: string; userAgent: string }) => void;
  onBack: () => void;
  onCancel: () => void;
}

export function LinkedInCookieStep({ submitting, error, country, onCountry, onSubmit, onBack, onCancel }: LinkedInCookieStepProps) {
  const [missing, setMissing] = useState<'access' | 'browser' | null>(null);
  const accessRef = useRef<HTMLInputElement>(null);
  const premiumRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (error) accessRef.current?.focus();
  }, [error]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const userAgent = browserUserAgent();
    if (!userAgent) {
      setMissing('browser');
      return;
    }
    if (!accessRef.current?.value.trim()) {
      setMissing('access');
      accessRef.current?.focus();
      return;
    }
    setMissing(null);
    onSubmit({
      accessToken: takeSecret(accessRef.current).trim(),
      premiumToken: takeSecret(premiumRef.current).trim(),
      userAgent,
    });
  };

  return (
    <StepFrame heading={LINKEDIN_COOKIE.title} description={<p>{LINKEDIN_COOKIE.warning}</p>}>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="group -ml-3 max-md:h-11">
            {LINKEDIN_COOKIE.guideTitle}
            <ChevronDown className="transition-transform duration-150 group-data-[state=open]:rotate-180" aria-hidden="true" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-1">
          <InfoBox>
            <ol className="list-decimal space-y-1.5 pl-4">
              {LINKEDIN_COOKIE.guideSteps.map((step) => <li key={step}>{step}</li>)}
            </ol>
          </InfoBox>
        </CollapsibleContent>
      </Collapsible>

      <form onSubmit={submit} noValidate className="space-y-4">
        <fieldset disabled={submitting} className="min-w-0 space-y-4 border-0 p-0">
          <SecretField
            ref={accessRef}
            label={LINKEDIN_COOKIE.access}
            name="li_at"
            autoComplete="off"
            className="font-mono"
            autoFocus
            onChange={() => { if (missing === 'access') setMissing(null); }}
            error={missing === 'access' ? NATIVE.cookieMissing : null}
          />
          <SecretField
            ref={premiumRef}
            label={LINKEDIN_COOKIE.premium}
            name="li_a"
            autoComplete="off"
            className="font-mono"
            help={LINKEDIN_COOKIE.premiumHelp}
          />
          <AdvancedOptions country={country} onCountry={onCountry} disabled={submitting} />
        </fieldset>

        {missing === 'browser' && <FormError>{NATIVE.browserMissing}</FormError>}
        {error && <FormError>{error}</FormError>}
        {submitting && <WaitLine>{LINKEDIN_CREDENTIALS.submitting}</WaitLine>}

        <StepFooter>
          <FooterButton type="button" variant="ghost" onClick={onCancel}>{FLOW.cancel}</FooterButton>
          <FooterButton type="button" variant="ghost" onClick={onBack} disabled={submitting}>{NATIVE.cookieSwitch}</FooterButton>
          <FooterButton type="submit" variant="primary" loading={submitting}>{LINKEDIN_COOKIE.submit}</FooterButton>
        </StepFooter>
      </form>
    </StepFrame>
  );
}
