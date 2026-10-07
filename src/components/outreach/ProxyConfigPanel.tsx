/**
 * Proxy d'un compte LinkedIn (Paramètres, Intégrations). Montré seulement quand
 * un proxy est posé : un état en mot (01-direction.md, § 10), le type de proxy
 * et ses champs, « Enregistrer ».
 *
 * Le message technique d'un refus reste dans les journaux du serveur : l'écran
 * dit ce qui s'est passé et quoi faire (§ 9).
 */
import { useId, useState } from 'react';
import { AlertCircle, Globe } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { cn } from '@/lib/utils';

const PROXY_COUNTRIES = [
  { code: 'FR', label: 'France' },
  { code: 'US', label: 'États-Unis' },
  { code: 'GB', label: 'Royaume-Uni' },
  { code: 'DE', label: 'Allemagne' },
  { code: 'ES', label: 'Espagne' },
  { code: 'IT', label: 'Italie' },
  { code: 'NL', label: 'Pays-Bas' },
  { code: 'BE', label: 'Belgique' },
  { code: 'CH', label: 'Suisse' },
  { code: 'CA', label: 'Canada' },
  { code: 'PT', label: 'Portugal' },
  { code: 'IE', label: 'Irlande' },
  { code: 'SE', label: 'Suède' },
  { code: 'NO', label: 'Norvège' },
  { code: 'DK', label: 'Danemark' },
  { code: 'AT', label: 'Autriche' },
  { code: 'PL', label: 'Pologne' },
  { code: 'LU', label: 'Luxembourg' },
  { code: 'SG', label: 'Singapour' },
  { code: 'AU', label: 'Australie' },
  { code: 'JP', label: 'Japon' },
  { code: 'BR', label: 'Brésil' },
  { code: 'IN', label: 'Inde' },
];

const MODES = [
  { value: 'country', label: 'Pays' },
  { value: 'ip', label: 'Adresse IP' },
  { value: 'custom', label: 'Personnalisé' },
] as const;

interface ProxyConfigPanelProps {
  accountId: string;
  accountName: string;
  currentCountry: string | null;
  currentMode?: string | null;
  currentHost?: string | null;
  currentPort?: number | null;
  currentProtocol?: string | null;
  proxyIsActive?: boolean | null;
  proxyLastError?: string | null;
  onUpdated: (country: string | null, mode: string) => void;
}

export const ProxyConfigPanel = ({
  accountId,
  accountName,
  currentCountry,
  currentMode,
  currentHost,
  currentPort,
  currentProtocol,
  proxyIsActive,
  proxyLastError,
  onUpdated,
}: ProxyConfigPanelProps) => {
  const fieldId = useId();
  const resolvedMode = currentMode || (currentCountry ? 'country' : 'none');
  const [mode, setMode] = useState<string>(resolvedMode === 'none' ? 'country' : resolvedMode);
  const [selectedCountry, setSelectedCountry] = useState<string>(currentCountry || '');
  const [ipAddress, setIpAddress] = useState<string>(currentMode === 'ip' ? (currentCountry || '') : '');
  const [customProtocol, setCustomProtocol] = useState<string>(currentProtocol || 'https');
  const [customHost, setCustomHost] = useState<string>(currentHost || '');
  const [customPort, setCustomPort] = useState<string>(currentPort?.toString() || '');
  const [customUsername, setCustomUsername] = useState<string>('');
  const [customPassword, setCustomPassword] = useState<string>('');
  const [saving, setSaving] = useState(false);
  // Issue du dernier enregistrement fait ici : le serveur vient de marquer le proxy
  // actif, ou refusé ; proxyIsActive et proxyLastError datent du chargement.
  const [outcome, setOutcome] = useState<'ok' | 'refused' | null>(null);
  const active = outcome === 'ok' ? true : outcome === 'refused' ? false : proxyIsActive;
  const refused = outcome === 'refused' || (outcome === null && !!proxyLastError);

  // Réglage enregistré, en mots : jamais un code pays ni un mode brut.
  const configured = resolvedMode !== 'none';
  const summary = !configured
    ? 'Aucun proxy'
    : resolvedMode === 'country' && currentCountry
      ? `Proxy : ${PROXY_COUNTRIES.find((c) => c.code === currentCountry)?.label ?? currentCountry}`
      : resolvedMode === 'ip'
        ? `Proxy : adresse IP ${currentCountry ?? ''}`.trim()
        : currentHost
          ? `Proxy : ${currentHost}${currentPort ? `:${currentPort}` : ''}`
          : 'Proxy personnalisé';
  const state = !configured || active == null
    ? null
    : active
      ? { label: 'Actif', dot: 'bg-success' }
      : { label: 'En échec', dot: 'bg-danger' };

  const handleSave = async () => {
    const payload: Record<string, unknown> = {
      action: 'update_proxy',
      account_id: accountId,
      proxy_mode: mode,
    };

    if (mode === 'country') {
      if (!selectedCountry) { toast.error('Choisissez un pays.'); return; }
      payload.proxy_country = selectedCountry;
    } else if (mode === 'ip') {
      if (!ipAddress.trim()) { toast.error('Saisissez l’adresse IP du proxy.'); return; }
      payload.proxy_ip = ipAddress.trim();
    } else if (mode === 'custom') {
      if (!customHost.trim() || !customPort) { toast.error('Indiquez l’hôte et le port du proxy.'); return; }
      payload.proxy_protocol = customProtocol;
      payload.proxy_host = customHost.trim();
      payload.proxy_port = Number(customPort);
      if (customUsername) payload.proxy_username = customUsername;
      if (customPassword) payload.proxy_password = customPassword;
    }

    setSaving(true);
    let failure: string | null = null;
    try {
      const { data, error } = await invokeEdgeFunction('unipile-accounts', payload);
      if (error) {
        // Refus du serveur ou panne réseau : phrase déjà en français.
        failure = error.message;
      } else if (!data?.success) {
        // Refus du service de connexion LinkedIn, noté sur le compte par le
        // serveur : son message reste dans les journaux.
        failure = 'Vérifiez son réglage, puis réessayez.';
        if (typeof data?.status === 'number') setOutcome('refused');
      }
    } catch {
      failure = 'Vérifiez votre connexion, puis réessayez.';
    } finally {
      setSaving(false);
    }
    if (failure) {
      toast.error('Le proxy n’a pas été enregistré.', { description: failure });
      return;
    }
    setOutcome('ok');
    toast.success('Proxy enregistré');
    onUpdated(
      mode === 'country' ? selectedCountry : mode === 'ip' ? ipAddress.trim() : null,
      mode,
    );
  };

  const fieldClass = 'h-8 max-md:h-11';

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {summary}
        </span>
        {state && (
          <span className="inline-flex items-center gap-1.5">
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', state.dot)} aria-hidden="true" />
            {state.label}
          </span>
        )}
      </p>

      {refused && (
        <p className="flex items-start gap-1.5 text-xs text-danger">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Le dernier réglage a été refusé. Vérifiez-le, puis enregistrez de nouveau.
        </p>
      )}

      <RadioGroup
        value={mode}
        onValueChange={setMode}
        aria-label={`Type de proxy du compte ${accountName}`}
        className="flex flex-wrap gap-x-4 gap-y-0"
      >
        {MODES.map((m) => (
          <div key={m.value} className="flex items-center gap-2">
            <RadioGroupItem value={m.value} id={`${fieldId}-${m.value}`} />
            <Label htmlFor={`${fieldId}-${m.value}`} className="flex cursor-pointer items-center text-xs font-normal max-md:min-h-11">
              {m.label}
            </Label>
          </div>
        ))}
      </RadioGroup>

      <div className="flex flex-wrap items-end gap-2">
        {mode === 'country' && (
          <Select value={selectedCountry} onValueChange={setSelectedCountry}>
            <SelectTrigger aria-label="Pays du proxy" className={cn(fieldClass, 'w-44')}>
              <SelectValue placeholder="Choisir un pays" />
            </SelectTrigger>
            <SelectContent>
              {PROXY_COUNTRIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {mode === 'ip' && (
          <Input
            value={ipAddress}
            onChange={(e) => setIpAddress(e.target.value)}
            aria-label="Adresse IP du proxy"
            placeholder="203.0.113.10"
            inputMode="decimal"
            className={cn(fieldClass, 'w-44')}
          />
        )}

        {mode === 'custom' && (
          <>
            <div className="space-y-1">
              <Label htmlFor={`${fieldId}-protocol`} className="text-xs">Protocole</Label>
              <Select value={customProtocol} onValueChange={setCustomProtocol}>
                <SelectTrigger id={`${fieldId}-protocol`} className={cn(fieldClass, 'w-28')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="https">HTTPS</SelectItem>
                  <SelectItem value="http">HTTP</SelectItem>
                  <SelectItem value="socks5">SOCKS5</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${fieldId}-host`} className="text-xs">Hôte</Label>
              <Input
                id={`${fieldId}-host`}
                value={customHost}
                onChange={(e) => setCustomHost(e.target.value)}
                placeholder="proxy.exemple.fr"
                autoComplete="off"
                className={cn(fieldClass, 'w-44')}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${fieldId}-port`} className="text-xs">Port</Label>
              <Input
                id={`${fieldId}-port`}
                value={customPort}
                onChange={(e) => setCustomPort(e.target.value)}
                placeholder="8080"
                type="number"
                inputMode="numeric"
                className={cn(fieldClass, 'w-24')}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${fieldId}-user`} className="text-xs">Identifiant (facultatif)</Label>
              <Input
                id={`${fieldId}-user`}
                value={customUsername}
                onChange={(e) => setCustomUsername(e.target.value)}
                autoComplete="off"
                className={cn(fieldClass, 'w-40')}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${fieldId}-password`} className="text-xs">Mot de passe (facultatif)</Label>
              <Input
                id={`${fieldId}-password`}
                value={customPassword}
                onChange={(e) => setCustomPassword(e.target.value)}
                type="password"
                // Jamais le mot de passe Konekt proposé par le navigateur.
                autoComplete="new-password"
                className={cn(fieldClass, 'w-40')}
              />
            </div>
          </>
        )}

        <Button type="button" size="sm" variant="outline" onClick={handleSave} loading={saving} className="max-md:h-11">
          Enregistrer
        </Button>
      </div>
    </div>
  );
};
