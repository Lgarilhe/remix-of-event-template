import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Shield, Save, RotateCcw, Info, Loader2, Lock, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useMemberQuotas, DEFAULT_QUOTAS } from '@/hooks/useMemberQuotas';
import { useOrganization } from '@/hooks/useOrganization';

/**
 * LinkedInSafetySettings — Plages horaires + cap journalier d'actions LinkedIn.
 *
 * Conformité LinkedIn (warning #260513-007211) : permet à chaque user de
 * configurer ses propres heures d'activité (ex : 8h-13h) + un cap global
 * cumulé d'actions/jour. Critique quand le même compte LinkedIn est aussi
 * utilisé par un autre outil — on découpe les plages pour éviter chevauchement
 * et on cap le volume cumulé.
 *
 * Stocke dans `member_quotas` (lu par process-sequences + process-inmail-queue).
 * Libre-service (migration 20260906193347) : tout membre modifie ses horaires
 * et son fuseau ; les plafonds restent réservés aux propriétaires et
 * administrateurs (trigger member_quotas_self_service_guard côté serveur).
 */

/** Mécanismes réels de protection, mêmes chiffres que _shared/linkedin-quotas.ts et process-sequences. */
const PROTECTION_MECHANISMS = [
  'Actions uniquement aux heures ouvrées, du lundi au vendredi, dans votre fuseau horaire et sur la plage définie ci-dessous.',
  '80 actions visibles par jour par défaut (messages, invitations, InMails), plafond ajustable ci-dessous et réduit pendant la montée en charge.',
  '100 invitations par période glissante de 7 jours.',
  "5 à 15 secondes entre deux actions d'une même séquence.",
  "Pause automatique de 16 heures dès 90 % d'usage ou au premier signal de limite envoyé par LinkedIn.",
  'Montée en charge sur trois semaines pour un compte nouvellement connecté : 25 %, 50 % puis 75 % des plafonds avant le plein régime.',
  'Anti-doublon dans votre organisation : un profil déjà contacté par un collègue au cours des 90 derniers jours est signalé au moment de l’inscription à une séquence.',
];

export const LinkedInSafetySettings = () => {
  const [userId, setUserId] = useState<string | null>(null);
  const { getQuotaForUser, upsertQuota, isSaving, isLoading } = useMemberQuotas();
  const { isAdmin } = useOrganization();

  const [startHour, setStartHour] = useState<number>(DEFAULT_QUOTAS.business_hours_start);
  const [endHour, setEndHour] = useState<number>(DEFAULT_QUOTAS.business_hours_end);
  const [maxActionsPerDay, setMaxActionsPerDay] = useState<number>(DEFAULT_QUOTAS.max_actions_per_day);
  const [timezone, setTimezone] = useState<string>(DEFAULT_QUOTAS.timezone);
  const [dirty, setDirty] = useState(false);

  // Get current user id
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
  }, []);

  // Hydrate form from existing quota row (or defaults)
  useEffect(() => {
    if (!userId) return;
    const existing = getQuotaForUser(userId);
    if (existing) {
      setStartHour(existing.business_hours_start ?? DEFAULT_QUOTAS.business_hours_start);
      setEndHour(existing.business_hours_end ?? DEFAULT_QUOTAS.business_hours_end);
      setMaxActionsPerDay(existing.max_actions_per_day ?? DEFAULT_QUOTAS.max_actions_per_day);
      setTimezone(existing.timezone ?? DEFAULT_QUOTAS.timezone);
    }
  }, [userId, getQuotaForUser]);

  const hoursValid = endHour > startHour;
  const capValid = maxActionsPerDay >= 0 && maxActionsPerDay <= 500;

  const handleSave = () => {
    if (!userId || !hoursValid || !capValid) return;
    upsertQuota({
      userId,
      quotas: {
        business_hours_start: startHour,
        business_hours_end: endHour,
        timezone,
        // Le plafond n'est envoyé que par un propriétaire ou administrateur :
        // le serveur refuse toute modification de plafond par un simple membre.
        ...(isAdmin ? { max_actions_per_day: maxActionsPerDay } : {}),
      },
    });
    setDirty(false);
  };

  const handleReset = () => {
    setStartHour(DEFAULT_QUOTAS.business_hours_start);
    setEndHour(DEFAULT_QUOTAS.business_hours_end);
    if (isAdmin) setMaxActionsPerDay(DEFAULT_QUOTAS.max_actions_per_day);
    setTimezone(DEFAULT_QUOTAS.timezone);
    setDirty(true);
  };

  const hours = Array.from({ length: 25 }, (_, i) => i); // 0..24
  // start: 0..23, end: 1..24
  const startOptions = hours.slice(0, 24);
  const endOptions = hours.slice(1, 25);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Shield className="w-5 h-5 text-primary" aria-hidden="true" />
          Plages & limites de sécurité
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="p-3 bg-success/5 border border-success/30 rounded space-y-2">
          <p className="text-xs font-semibold text-foreground">Comment Konekt protège votre compte LinkedIn</p>
          <ul className="space-y-1.5">
            {PROTECTION_MECHANISMS.map((mechanism) => (
              <li key={mechanism} className="flex items-start gap-2 text-xs text-muted-foreground leading-relaxed">
                <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" aria-hidden="true" />
                <span>{mechanism}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-start gap-2 p-2.5 bg-info/5 border border-info/30 rounded text-xs text-foreground">
          <Info className="w-3.5 h-3.5 text-info shrink-0 mt-0.5" aria-hidden="true" />
          <p className="leading-relaxed text-muted-foreground">
            Définissez sur quelles heures votre compte LinkedIn peut envoyer des messages, des invitations
            et des InMails depuis Konekt, et combien d'actions par jour au maximum.
            <strong className="text-foreground"> Indispensable si le même compte LinkedIn est aussi utilisé par un autre outil</strong> :
            réservez des plages séparées et capez le volume cumulé.
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            Chargement…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="start-hour" className="text-xs font-medium">Début (heure locale)</Label>
                <Select
                  value={String(startHour)}
                  onValueChange={(v) => { setStartHour(parseInt(v, 10)); setDirty(true); }}
                >
                  <SelectTrigger id="start-hour"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-[70vh]">
                    {startOptions.map(h => (
                      <SelectItem key={h} value={String(h)}>{String(h).padStart(2, '0')}:00</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="end-hour" className="text-xs font-medium">Fin (heure locale)</Label>
                <Select
                  value={String(endHour)}
                  onValueChange={(v) => { setEndHour(parseInt(v, 10)); setDirty(true); }}
                >
                  <SelectTrigger id="end-hour"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-[70vh]">
                    {endOptions.map(h => (
                      <SelectItem key={h} value={String(h)}>{String(h).padStart(2, '0')}:00</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {!hoursValid && (
              <p className="text-xs text-destructive">L'heure de fin doit être après l'heure de début.</p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="timezone" className="text-xs font-medium">Fuseau horaire</Label>
              <Select
                value={timezone}
                onValueChange={(v) => { setTimezone(v); setDirty(true); }}
              >
                <SelectTrigger id="timezone"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Europe/Paris">Europe/Paris</SelectItem>
                  <SelectItem value="Europe/London">Europe/London</SelectItem>
                  <SelectItem value="Europe/Brussels">Europe/Brussels</SelectItem>
                  <SelectItem value="Europe/Zurich">Europe/Zurich</SelectItem>
                  <SelectItem value="America/New_York">America/New_York</SelectItem>
                  <SelectItem value="America/Los_Angeles">America/Los_Angeles</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="max-actions" className="text-xs font-medium flex items-center gap-1.5">
                Cap d'actions visibles / jour
                {!isAdmin && <Lock className="w-3 h-3 text-muted-foreground" aria-hidden="true" />}
              </Label>
              <Input
                id="max-actions"
                type="number"
                min={0}
                max={500}
                value={maxActionsPerDay}
                disabled={!isAdmin}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  setMaxActionsPerDay(Number.isFinite(v) ? v : 0);
                  setDirty(true);
                }}
              />
              {isAdmin ? (
                <p className="text-xs text-muted-foreground">
                  Total cumulé messages + invitations + InMails par jour.
                  Recommandé : 60-80 si le compte est partagé avec un autre outil, 100 max si Konekt est seul.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Les plafonds sont définis par les propriétaires et administrateurs de l'organisation.
                  Vous pouvez ajuster vos horaires et votre fuseau horaire.
                </p>
              )}
              {!capValid && (
                <p className="text-xs text-destructive">Valeur entre 0 et 500.</p>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                onClick={handleSave}
                disabled={!dirty || !hoursValid || !capValid || isSaving || !userId}
                size="sm"
                className="gap-1.5"
              >
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Save className="w-3.5 h-3.5" aria-hidden="true" />}
                Enregistrer
              </Button>
              <Button
                variant="outline"
                onClick={handleReset}
                size="sm"
                className="gap-1.5"
                disabled={isSaving}
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                Valeurs par défaut
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
