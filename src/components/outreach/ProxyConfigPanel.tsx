import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Loader2, Globe, Shield, CheckCircle2, AlertCircle, Wifi, WifiOff } from 'lucide-react';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';

const PROXY_COUNTRIES = [
  { code: 'FR', label: 'France', flag: '🇫🇷' },
  { code: 'US', label: 'États-Unis', flag: '🇺🇸' },
  { code: 'GB', label: 'Royaume-Uni', flag: '🇬🇧' },
  { code: 'DE', label: 'Allemagne', flag: '🇩🇪' },
  { code: 'ES', label: 'Espagne', flag: '🇪🇸' },
  { code: 'IT', label: 'Italie', flag: '🇮🇹' },
  { code: 'NL', label: 'Pays-Bas', flag: '🇳🇱' },
  { code: 'BE', label: 'Belgique', flag: '🇧🇪' },
  { code: 'CH', label: 'Suisse', flag: '🇨🇭' },
  { code: 'CA', label: 'Canada', flag: '🇨🇦' },
  { code: 'PT', label: 'Portugal', flag: '🇵🇹' },
  { code: 'IE', label: 'Irlande', flag: '🇮🇪' },
  { code: 'SE', label: 'Suède', flag: '🇸🇪' },
  { code: 'NO', label: 'Norvège', flag: '🇳🇴' },
  { code: 'DK', label: 'Danemark', flag: '🇩🇰' },
  { code: 'AT', label: 'Autriche', flag: '🇦🇹' },
  { code: 'PL', label: 'Pologne', flag: '🇵🇱' },
  { code: 'LU', label: 'Luxembourg', flag: '🇱🇺' },
  { code: 'SG', label: 'Singapour', flag: '🇸🇬' },
  { code: 'AU', label: 'Australie', flag: '🇦🇺' },
  { code: 'JP', label: 'Japon', flag: '🇯🇵' },
  { code: 'BR', label: 'Brésil', flag: '🇧🇷' },
  { code: 'IN', label: 'Inde', flag: '🇮🇳' },
];

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

  const getStatusBadge = () => {
    if (!currentMode || resolvedMode === 'none') {
      return (
        <Badge variant="outline" className="text-xs gap-1 font-normal text-muted-foreground">
          <Globe className="w-2.5 h-2.5" />
          Aucun proxy
        </Badge>
      );
    }
    if (currentMode === 'country' && currentCountry) {
      const entry = PROXY_COUNTRIES.find(c => c.code === currentCountry);
      return (
        <Badge variant="outline" className="text-xs gap-1 font-normal">
          <Shield className="w-2.5 h-2.5" />
          {entry ? `${entry.flag} ${entry.code}` : currentCountry}
        </Badge>
      );
    }
    if (currentMode === 'ip') {
      return (
        <Badge variant="outline" className="text-xs gap-1 font-normal">
          <Shield className="w-2.5 h-2.5" />
          IP: {currentCountry}
        </Badge>
      );
    }
    if (currentMode === 'custom') {
      return (
        <Badge variant="outline" className="text-xs gap-1 font-normal">
          <Shield className="w-2.5 h-2.5" />
          Custom
        </Badge>
      );
    }
    return null;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        action: 'update_proxy',
        account_id: accountId,
        proxy_mode: mode,
      };

      if (mode === 'country') {
        if (!selectedCountry) { toast.error('Sélectionnez un pays'); setSaving(false); return; }
        payload.proxy_country = selectedCountry;
      } else if (mode === 'ip') {
        if (!ipAddress) { toast.error('Entrez une adresse IP'); setSaving(false); return; }
        payload.proxy_ip = ipAddress;
      } else if (mode === 'custom') {
        if (!customHost || !customPort) { toast.error('Host et port requis'); setSaving(false); return; }
        payload.proxy_protocol = customProtocol;
        payload.proxy_host = customHost;
        payload.proxy_port = Number(customPort);
        if (customUsername) payload.proxy_username = customUsername;
        if (customPassword) payload.proxy_password = customPassword;
      }

      const { data } = await invokeEdgeFunction('unipile-accounts', payload);

      if (!data?.success) {
        throw new Error((data as any)?.error || 'Erreur de configuration du proxy');
      }

      toast.success('Proxy mis à jour');
      onUpdated(
        mode === 'country' ? selectedCountry : mode === 'ip' ? ipAddress : null,
        mode,
      );
    } catch (e: any) {
      toast.error(e.message || 'Erreur lors de la mise à jour du proxy');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      {/* Status row */}
      <div className="flex items-center gap-2">
        <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        {getStatusBadge()}
        {currentMode && resolvedMode !== 'none' && (
          proxyIsActive ? (
            <Wifi className="w-3.5 h-3.5 text-green-500" />
          ) : (
            <WifiOff className="w-3.5 h-3.5 text-destructive" />
          )
        )}
      </div>

      {/* Error display */}
      {proxyLastError && (
        <div className="flex items-start gap-1.5 text-destructive text-xs bg-destructive/10 rounded px-2 py-1.5">
          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>{proxyLastError}</span>
        </div>
      )}

      {/* Mode selector */}
      <RadioGroup value={mode} onValueChange={setMode} className="flex gap-3">
        <div className="flex items-center gap-1.5">
          <RadioGroupItem value="country" id={`${accountId}-country`} className="w-3 h-3" />
          <Label htmlFor={`${accountId}-country`} className="text-xs cursor-pointer">Pays</Label>
        </div>
        <div className="flex items-center gap-1.5">
          <RadioGroupItem value="ip" id={`${accountId}-ip`} className="w-3 h-3" />
          <Label htmlFor={`${accountId}-ip`} className="text-xs cursor-pointer">IP</Label>
        </div>
        <div className="flex items-center gap-1.5">
          <RadioGroupItem value="custom" id={`${accountId}-custom`} className="w-3 h-3" />
          <Label htmlFor={`${accountId}-custom`} className="text-xs cursor-pointer">Custom</Label>
        </div>
      </RadioGroup>

      {/* Mode-specific fields */}
      <div className="flex items-end gap-2">
        {mode === 'country' && (
          <Select value={selectedCountry} onValueChange={setSelectedCountry}>
            <SelectTrigger className="h-7 w-[160px] text-xs">
              <SelectValue placeholder="Pays proxy" />
            </SelectTrigger>
            <SelectContent>
              {PROXY_COUNTRIES.map((c) => (
                <SelectItem key={c.code} value={c.code} className="text-xs">
                  {c.flag} {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {mode === 'ip' && (
          <Input
            value={ipAddress}
            onChange={(e) => setIpAddress(e.target.value)}
            placeholder="192.168.1.1"
            className="h-7 w-[160px] text-xs"
          />
        )}

        {mode === 'custom' && (
          <div className="flex flex-wrap gap-2 flex-1">
            <Select value={customProtocol} onValueChange={setCustomProtocol}>
              <SelectTrigger className="h-7 w-[90px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="https" className="text-xs">HTTPS</SelectItem>
                <SelectItem value="http" className="text-xs">HTTP</SelectItem>
                <SelectItem value="socks5" className="text-xs">SOCKS5</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={customHost}
              onChange={(e) => setCustomHost(e.target.value)}
              placeholder="proxy.example.com"
              className="h-7 w-[140px] text-xs"
            />
            <Input
              value={customPort}
              onChange={(e) => setCustomPort(e.target.value)}
              placeholder="8080"
              className="h-7 w-[70px] text-xs"
              type="number"
            />
            <Input
              value={customUsername}
              onChange={(e) => setCustomUsername(e.target.value)}
              placeholder="User (opt.)"
              className="h-7 w-[100px] text-xs"
            />
            <Input
              value={customPassword}
              onChange={(e) => setCustomPassword(e.target.value)}
              placeholder="Pass (opt.)"
              type="password"
              className="h-7 w-[100px] text-xs"
            />
          </div>
        )}

        <Button
          size="sm"
          variant="outline"
          onClick={handleSave}
          disabled={saving}
          className="h-7 text-xs px-2"
        >
          {saving ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <CheckCircle2 className="w-3 h-3" />
          )}
        </Button>
      </div>
    </div>
  );
};
