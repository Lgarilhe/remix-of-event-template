import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Shield, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { LINKEDIN_LIMITS } from '@/hooks/useUnipileQuota';

const STORAGE_KEY = 'konekt_linkedin_quota_overrides';

interface QuotaOverrides {
  invitations?: number;
  messages?: number;
  inmailDaily?: number;
  profileVisits?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
}

/** Read custom quota overrides from localStorage */
export function getQuotaOverrides(): QuotaOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Get effective limit: custom override > safe mode default */
export function getEffectiveLimit(
  limitType: 'INVITATIONS' | 'MESSAGES' | 'INMAIL_DAILY' | 'PROFILE_VISITS',
  apiMode: 'classic' | 'recruiter' | 'sales_navigator'
): number {
  const overrides = getQuotaOverrides();
  const mapping: Record<string, keyof QuotaOverrides> = {
    INVITATIONS: 'invitations',
    MESSAGES: 'messages',
    INMAIL_DAILY: 'inmailDaily',
    PROFILE_VISITS: 'profileVisits',
  };
  const overrideKey = mapping[limitType];
  if (overrideKey && overrides[overrideKey] !== undefined) {
    return overrides[overrideKey]!;
  }
  return LINKEDIN_LIMITS[limitType][apiMode];
}

/** Get effective delay range */
export function getEffectiveDelay(): { min: number; max: number } {
  const overrides = getQuotaOverrides();
  return {
    min: overrides.minDelayMs ?? LINKEDIN_LIMITS.MIN_DELAY_MS,
    max: overrides.maxDelayMs ?? LINKEDIN_LIMITS.MAX_DELAY_MS,
  };
}

const FIELDS = [
  { key: 'invitations' as const, label: 'Invitations / jour', default: LINKEDIN_LIMITS.INVITATIONS.recruiter, max: 40, help: 'Réel : ~150-200/semaine Recruiter. Safe : 30/jour' },
  { key: 'messages' as const, label: 'Messages / jour', default: LINKEDIN_LIMITS.MESSAGES.recruiter, max: 150, help: 'Pas de limite officielle. Safe : 100/jour' },
  { key: 'inmailDaily' as const, label: 'InMails / jour', default: LINKEDIN_LIMITS.INMAIL_DAILY.recruiter, max: 1000, help: 'Recruiter : 150 crédits/mois + Open Profiles illimités. Hard cap : 1000/jour' },
  { key: 'profileVisits' as const, label: 'Visites profils / jour', default: LINKEDIN_LIMITS.PROFILE_VISITS.recruiter, max: 1000, help: 'SN/Recruiter : 1000/jour via interface dédiée' },
  { key: 'minDelayMs' as const, label: 'Délai min entre actions (sec)', default: LINKEDIN_LIMITS.MIN_DELAY_MS / 1000, max: 300, help: 'LinkedIn détecte les patterns < 10s', isDelay: true },
  { key: 'maxDelayMs' as const, label: 'Délai max entre actions (sec)', default: LINKEDIN_LIMITS.MAX_DELAY_MS / 1000, max: 600, help: 'Varier les délais simule un comportement humain', isDelay: true },
];

export const LinkedInQuotaSettings = () => {
  const [overrides, setOverrides] = useState<QuotaOverrides>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setOverrides(getQuotaOverrides());
  }, []);

  const handleChange = (key: keyof QuotaOverrides, value: string) => {
    const num = parseInt(value);
    if (isNaN(num) || num < 0) return;
    setOverrides((prev) => ({ ...prev, [key]: num }));
    setDirty(true);
  };

  const handleSave = () => {
    // Convert delay seconds back to ms for storage
    const toSave = { ...overrides };
    if (toSave.minDelayMs !== undefined) toSave.minDelayMs = toSave.minDelayMs * 1000;
    if (toSave.maxDelayMs !== undefined) toSave.maxDelayMs = toSave.maxDelayMs * 1000;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
      toast.success('Quotas LinkedIn mis à jour');
      setDirty(false);
    } catch {
      toast.error('Erreur de sauvegarde');
    }
  };

  const handleReset = () => {
    localStorage.removeItem(STORAGE_KEY);
    setOverrides({});
    setDirty(false);
    toast.success('Quotas réinitialisés aux valeurs safe mode');
  };

  const getValue = (key: keyof QuotaOverrides, defaultVal: number, isDelay?: boolean) => {
    const raw = overrides[key];
    if (raw !== undefined) {
      // If stored as ms but displaying as seconds
      if (isDelay && raw > 1000) return Math.round(raw / 1000);
      return raw;
    }
    return defaultVal;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
          <Shield className="w-4 h-4" />
          Quotas LinkedIn (Safe mode)
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Ajustez les limites quotidiennes. Les valeurs par défaut sont conservatrices pour protéger votre compte LinkedIn.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {FIELDS.map((field) => (
            <div key={field.key}>
              <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1">
                {field.label}
              </label>
              <Input
                type="number"
                min={0}
                max={field.max}
                value={getValue(field.key, field.default, field.isDelay)}
                onChange={(e) => handleChange(field.key, e.target.value)}
                className="h-8 text-sm"
              />
              <p className="text-xs text-muted-foreground mt-0.5">{field.help} (max: {field.max})</p>
            </div>
          ))}
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            onClick={handleSave}
            disabled={!dirty}
            size="sm"
            className="gap-1.5"
          >
            Enregistrer
          </Button>
          <Button
            variant="outline"
            onClick={handleReset}
            size="sm"
            className="gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Réinitialiser
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
