import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, Globe, Shield, CheckCircle2 } from 'lucide-react';
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
  onUpdated: (country: string) => void;
}

export const ProxyConfigPanel = ({
  accountId,
  accountName,
  currentCountry,
  onUpdated,
}: ProxyConfigPanelProps) => {
  const [selectedCountry, setSelectedCountry] = useState<string>(currentCountry || '');
  const [saving, setSaving] = useState(false);

  const currentEntry = PROXY_COUNTRIES.find(c => c.code === currentCountry);
  const isDirty = selectedCountry !== (currentCountry || '');

  const handleSave = async () => {
    if (!selectedCountry) {
      toast.error('Sélectionnez un pays');
      return;
    }

    setSaving(true);
    try {
      const { data } = await invokeEdgeFunction('unipile-accounts', {
        action: 'update_proxy',
        account_id: accountId,
        proxy_country: selectedCountry,
      });

      if (!data?.success) {
        throw new Error((data as any)?.error || 'Erreur de configuration du proxy');
      }

      toast.success(`Proxy mis à jour : ${PROXY_COUNTRIES.find(c => c.code === selectedCountry)?.label || selectedCountry}`);
      onUpdated(selectedCountry);
    } catch (e: any) {
      toast.error(e.message || 'Erreur lors de la mise à jour du proxy');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-2 mt-2">
      <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      
      {currentEntry && !isDirty ? (
        <Badge variant="outline" className="text-[10px] gap-1 font-normal">
          <Shield className="w-2.5 h-2.5" />
          {currentEntry.flag} {currentEntry.code}
        </Badge>
      ) : null}

      <Select value={selectedCountry} onValueChange={setSelectedCountry}>
        <SelectTrigger className="h-7 w-[140px] text-xs">
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

      {isDirty && (
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
      )}
    </div>
  );
};
