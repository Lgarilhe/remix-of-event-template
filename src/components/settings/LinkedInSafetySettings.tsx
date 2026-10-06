import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { SaveStatus, type SaveState } from '@/components/ui/save-status';
import { Shield, RotateCcw, Lock, Check, ChevronDown } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import {
  useMemberQuotas,
  DEFAULT_QUOTAS,
  MAX_ACTIONS_PER_DAY_MIN,
  MAX_ACTIONS_PER_DAY_MAX,
  isValidMaxActionsPerDay,
} from '@/hooks/useMemberQuotas';
import { useOrganization } from '@/hooks/useOrganization';
import { ErrorBox } from '@/components/layout/ErrorBox';
import { cn } from '@/lib/utils';

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
 *
 * Lot 12 du chantier design : fuseaux affichés par leur ville (F-25), bouton
 * « Enregistrer » et état d'enregistrement (F-09), encart de protections neutre (F-14).
 */

/** Mécanismes réels de protection, mêmes chiffres que _shared/linkedin-quotas.ts et process-sequences. */
const PROTECTION_MECHANISMS = [
  'Actions uniquement aux heures ouvrées, du lundi au vendredi, dans votre fuseau horaire et sur la plage définie ci-dessous.',
  '80 actions visibles par jour par défaut (messages, invitations, InMails), plafond ajustable ci-dessous et réduit pendant la montée en charge.',
  '100 invitations par période glissante de 7 jours.',
  "5 à 15 secondes entre deux actions d'une même séquence.",
  "Pause automatique de 16 heures dès 90 % d'usage ou au premier signal de limite envoyé par LinkedIn.",
  'Montée en charge sur trois semaines pour un compte nouvellement connecté : 25 %, 50 % puis 75 % des plafonds avant le plein régime.',
  'Anti-doublon dans votre organisation : un candidat déjà contacté au cours des 90 derniers jours, en séquence ou par InMail groupé, est signalé et écarté par défaut au moment de l’inscription à une séquence ou de la planification d’un InMail groupé.',
];

/** Fuseaux proposés : ville en français ; l'identifiant IANA reste la valeur enregistrée (F-25). */
const TIME_ZONES: { value: string; city: string }[] = [
  { value: 'Europe/Paris', city: 'Paris' },
  { value: 'Europe/London', city: 'Londres' },
  { value: 'Europe/Brussels', city: 'Bruxelles' },
  { value: 'Europe/Zurich', city: 'Zurich' },
  { value: 'America/New_York', city: 'New York' },
  { value: 'America/Los_Angeles', city: 'Los Angeles' },
];

/** Décalage UTC du fuseau aujourd'hui (« UTC+2 »), null si le navigateur ne sait pas le dire. */
function utcOffset(timeZone: string): string | null {
  try {
    const part = new Intl.DateTimeFormat('fr-FR', { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName');
    return part?.value ?? null;
  } catch {
    return null;
  }
}

/** « Paris (UTC+2) » : jamais l'identifiant technique à l'écran. Fuseau hors liste : sa ville. */
function timeZoneLabel(timeZone: string): string {
  const known = TIME_ZONES.find((z) => z.value === timeZone);
  const city = known?.city ?? (timeZone.split('/').pop() || timeZone).replace(/_/g, ' ');
  const offset = utcOffset(timeZone);
  return offset ? `${city} (${offset})` : city;
}

/** Nom d'un fuseau à l'écran, repris par la carte « Plafonds du jour ». */
export function TimeZoneName({ timeZone }: { timeZone: string }) {
  return <>{timeZoneLabel(timeZone)}</>;
}

export const LinkedInSafetySettings = () => {
  const [userId, setUserId] = useState<string | null>(null);
  const { getQuotaForUser, upsertQuota, isSaving, isLoading, isError, refetch } = useMemberQuotas();
  const { isAdmin } = useOrganization();

  const [startHour, setStartHour] = useState<number>(DEFAULT_QUOTAS.business_hours_start);
  const [endHour, setEndHour] = useState<number>(DEFAULT_QUOTAS.business_hours_end);
  const [maxActionsPerDay, setMaxActionsPerDay] = useState<number>(DEFAULT_QUOTAS.max_actions_per_day);
  const [timezone, setTimezone] = useState<string>(DEFAULT_QUOTAS.timezone);
  const [dirty, setDirty] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [protectionsOpen, setProtectionsOpen] = useState(false);

  // Get current user id
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
  }, []);

  // Hydrate depuis la ligne enregistrée de l'organisation courante, sinon depuis les défauts. Dépendances primitives : getQuotaForUser change d'identité à chaque rendu et ré-hydratait le formulaire après chaque saisie.
  const saved = userId ? getQuotaForUser(userId) : null;
  const savedStart = saved?.business_hours_start ?? DEFAULT_QUOTAS.business_hours_start;
  const savedEnd = saved?.business_hours_end ?? DEFAULT_QUOTAS.business_hours_end;
  const savedCap = saved?.max_actions_per_day ?? DEFAULT_QUOTAS.max_actions_per_day;
  const savedTz = saved?.timezone ?? DEFAULT_QUOTAS.timezone;
  useEffect(() => {
    setStartHour(savedStart);
    setEndHour(savedEnd);
    setMaxActionsPerDay(savedCap);
    setTimezone(savedTz);
    setDirty(false);
    setSaveFailed(false);
  }, [savedStart, savedEnd, savedCap, savedTz]);

  const hoursValid = endHour > startHour;
  // Un membre n'envoie pas le plafond : il n'est pas bloqué par une valeur qu'il ne peut pas modifier.
  const capValid = !isAdmin || isValidMaxActionsPerDay(maxActionsPerDay);

  const handleSave = () => {
    if (!userId || !hoursValid || !capValid) return;
    setSaveFailed(false);
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
    }, {
      // « Enregistrer » ne se grise qu'après un succès : sur erreur, il reste
      // actif pour réessayer, et l'état le dit.
      onSuccess: () => setDirty(false),
      onError: () => setSaveFailed(true),
    });
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
  // Un fuseau enregistré hors de la liste (réglé par l'assistant) reste choisi et lisible.
  const zoneOptions = TIME_ZONES.some((z) => z.value === timezone)
    ? TIME_ZONES.map((z) => z.value)
    : [...TIME_ZONES.map((z) => z.value), timezone];
  const saveState: SaveState = isSaving ? 'saving' : saveFailed ? 'error' : dirty ? 'unsaved' : 'saved';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Shield className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Plages horaires et limites
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Choisissez les heures pendant lesquelles votre compte LinkedIn peut envoyer des messages, des invitations
          et des InMails depuis Konekt, et combien d'actions par jour au plus.{' '}
          <strong className="font-medium text-foreground">Indispensable si le même compte LinkedIn sert aussi à un autre outil</strong> :
          réservez des plages séparées et plafonnez le volume cumulé.
        </p>

        {/* Design simplifié : les sept protections se lisent à la demande, sans encadré. */}
        <Collapsible open={protectionsOpen} onOpenChange={setProtectionsOpen}>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="-ml-2 max-md:h-11">
              <ChevronDown className={cn('transition-transform duration-150', protectionsOpen && 'rotate-180')} aria-hidden="true" />
              Comment Konekt protège votre compte LinkedIn
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-2 space-y-1.5">
              {PROTECTION_MECHANISMS.map((mechanism) => (
                <li key={mechanism} className="flex items-start gap-2 text-xs leading-relaxed text-foreground-secondary">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span>{mechanism}</span>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>

        {isLoading ? (
          <div role="status" className="space-y-3">
            <div className="grid grid-cols-2 gap-3" aria-hidden="true">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
            <Skeleton className="h-9" aria-hidden="true" />
            <Skeleton className="h-9 w-32" aria-hidden="true" />
            <span className="sr-only">Chargement de vos plages horaires et limites…</span>
          </div>
        ) : isError ? (
          // Lecture ratée : ni champ ni « Enregistrer », sinon l'enregistrement
          // écraserait la ligne existante par les valeurs par défaut.
          <ErrorBox
            title="Impossible de charger vos plages horaires et limites LinkedIn."
            detail="Vos réglages enregistrés ne sont pas affectés. Réessayez pour les afficher et les modifier."
            onRetry={() => { void refetch(); }}
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="start-hour" className="text-xs font-medium">Début (heure locale)</Label>
                <Select
                  value={String(startHour)}
                  onValueChange={(v) => { setStartHour(parseInt(v, 10)); setDirty(true); }}
                >
                  <SelectTrigger id="start-hour" className="max-md:h-11"><SelectValue /></SelectTrigger>
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
                  <SelectTrigger
                    id="end-hour"
                    className="max-md:h-11"
                    aria-invalid={!hoursValid}
                    aria-describedby={hoursValid ? undefined : 'end-hour-erreur'}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-[70vh]">
                    {endOptions.map(h => (
                      <SelectItem key={h} value={String(h)}>{String(h).padStart(2, '0')}:00</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {!hoursValid && (
              <p id="end-hour-erreur" className="text-xs text-danger">L'heure de fin doit être après l'heure de début.</p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="timezone" className="text-xs font-medium">Fuseau horaire</Label>
              <Select
                value={timezone}
                onValueChange={(v) => { setTimezone(v); setDirty(true); }}
              >
                <SelectTrigger id="timezone" className="max-md:h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {zoneOptions.map((zone) => (
                    <SelectItem key={zone} value={zone}>{timeZoneLabel(zone)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="max-actions" className="flex items-center gap-1.5 text-xs font-medium">
                Plafond d'actions visibles par jour
                {!isAdmin && <Lock className="h-3 w-3 text-muted-foreground" aria-hidden="true" />}
              </Label>
              <Input
                id="max-actions"
                className="max-md:h-11"
                type="number"
                min={MAX_ACTIONS_PER_DAY_MIN}
                max={MAX_ACTIONS_PER_DAY_MAX}
                value={maxActionsPerDay}
                disabled={!isAdmin}
                aria-invalid={!capValid}
                aria-describedby={capValid ? 'max-actions-aide' : 'max-actions-erreur max-actions-aide'}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  setMaxActionsPerDay(Number.isFinite(v) ? v : 0);
                  setDirty(true);
                }}
              />
              {!capValid && (
                <p id="max-actions-erreur" className="text-xs text-danger">Valeur entre {MAX_ACTIONS_PER_DAY_MIN} et {MAX_ACTIONS_PER_DAY_MAX}.</p>
              )}
              {isAdmin ? (
                <p id="max-actions-aide" className="text-xs text-muted-foreground">
                  Total cumulé des messages, invitations et InMails par jour.
                  Recommandé : 60 à 80 si le compte sert aussi à un autre outil, 100 au plus si Konekt est seul.
                </p>
              ) : (
                <p id="max-actions-aide" className="text-xs text-muted-foreground">
                  Les plafonds sont fixés par les propriétaires et administrateurs de l'organisation.
                  Vous pouvez ajuster vos horaires et votre fuseau horaire.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                variant="primary"
                size="sm"
                onClick={handleSave}
                loading={isSaving}
                disabled={!dirty || !hoursValid || !capValid || !userId}
                className="max-md:h-11"
              >
                Enregistrer
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                disabled={isSaving}
                className="max-md:h-11"
              >
                <RotateCcw aria-hidden="true" />
                Rétablir les valeurs par défaut
              </Button>
              <SaveStatus state={saveState} className="sm:ml-auto" />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
