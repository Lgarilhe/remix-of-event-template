/**
 * « Niveau de l'IA qui rédige » (lot 5e-2), dans Paramètres › Règles de
 * l'assistant (#niveau-ia) : niveau proposé à chaque rédaction et niveau
 * maximal de l'organisation, pour les messages d'approche rédigés par l'IA.
 *
 * - Propriétaire : chaque changement s'enregistre aussitôt (updateOrganization,
 *   agency_permissions relu puis fusionné) et l'annonce sur sa ligne. Baisser
 *   le plafond sous le niveau par défaut écrit les deux valeurs ensemble.
 * - Administrateur : valeurs en texte, « Réglé par le propriétaire de
 *   l'organisation. » (le garde organizations_update_guard refuse son
 *   écriture, HINT ORG_OWNER_ONLY).
 * - Membre : la rubrique est « gérée par » (sectionAccess), cette carte n'est
 *   pas montée.
 * Le serveur relit ces valeurs à chaque rédaction et refuse un niveau
 * au-dessus du plafond. Aucun nom de modèle n'est affiché.
 */
import { useState } from 'react';
import { Gauge } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SaveStatus, type SaveState } from '@/components/ui/save-status';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { ErrorBox } from '@/components/layout/ErrorBox';
import { useOrganization } from '@/hooks/useOrganization';
import { useWritingPreferences } from '@/hooks/useWritingPreferences';
import { AI_LEVELS, AI_LEVEL_LABELS, levelCostsSentence, levelRank, type AiLevel } from '@/lib/writingStyle';

const LEVEL_OPTIONS = AI_LEVELS.map((l) => ({ value: l, label: AI_LEVEL_LABELS[l] }));

export function AiLevelSettings() {
  const { isOwner } = useOrganization();
  const { prefs, isLoading, isError, refetch, saveOrgLevels } = useWritingPreferences();
  const [saveState, setSaveState] = useState<{ field: 'level' | 'max'; state: SaveState } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const write = async (field: 'level' | 'max', next: { level: AiLevel; max: AiLevel }) => {
    setSaveState({ field, state: 'saving' });
    setNotice(null);
    try {
      const saved = await saveOrgLevels(next);
      setSaveState({ field, state: 'saved' });
      if (field === 'max' && levelRank(next.level) > levelRank(next.max)) {
        setNotice(`Le niveau par défaut suit le niveau maximal : ${AI_LEVEL_LABELS[saved.defaultLevel]}.`);
      }
    } catch (err) {
      setSaveState({ field, state: 'error' });
      toast.error(err instanceof Error ? err.message : 'Le réglage n’a pas été enregistré. Réessayez.');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Gauge className="h-4 w-4" aria-hidden="true" />
          Niveau de l’IA qui rédige
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Le niveau choisit l’IA qui rédige les messages d’approche. Plus il est élevé, mieux elle écrit et plus elle
          coûte de crédits.
        </p>
        {isLoading ? (
          <div role="status" className="space-y-3">
            <Skeleton className="h-8 w-72 max-w-full" aria-hidden="true" />
            <Skeleton className="h-8 w-72 max-w-full" aria-hidden="true" />
            <span className="sr-only">Chargement du niveau de l’IA…</span>
          </div>
        ) : isError || !prefs ? (
          <ErrorBox title="Impossible de charger le niveau de l’IA." onRetry={() => { void refetch(); }} />
        ) : (
          <div className="space-y-5">
            <LevelRow
              label="Niveau par défaut"
              hint="Proposé à chaque rédaction. Chacun peut le changer, dans la limite ci-dessous."
              value={prefs.defaultLevel}
              editable={isOwner}
              allowedMax={prefs.maxLevel}
              state={saveState?.field === 'level' ? saveState.state : null}
              onChange={(level) => { void write('level', { level, max: prefs.maxLevel }); }}
            />
            <LevelRow
              label="Niveau maximal"
              hint="Personne ne peut faire rédiger un message d’approche au-dessus de ce niveau."
              value={prefs.maxLevel}
              editable={isOwner}
              state={saveState?.field === 'max' ? saveState.state : null}
              onChange={(max) => { void write('max', { level: prefs.defaultLevel, max }); }}
            />
            {notice && <p role="status" className="text-sm text-foreground-secondary">{notice}</p>}
            <p className="text-sm text-muted-foreground">{levelCostsSentence('outreach_message')}</p>
            {!isOwner && <p className="text-sm text-muted-foreground">Réglé par le propriétaire de l’organisation.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface LevelRowProps {
  label: string;
  hint: string;
  value: AiLevel;
  editable: boolean;
  /** Niveau par défaut : seuls les niveaux sous le plafond sont proposés. */
  allowedMax?: AiLevel;
  state: SaveState | null;
  onChange: (level: AiLevel) => void;
}

function LevelRow({ label, hint, value, editable, allowedMax, state, onChange }: LevelRowProps) {
  const options = allowedMax ? LEVEL_OPTIONS.filter((o) => levelRank(o.value) <= levelRank(allowedMax)) : LEVEL_OPTIONS;
  // Un seul niveau permis (plafond Rapide) : rien à choisir, la valeur s'écrit en texte.
  const fixed = editable && options.length === 1;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {state && <SaveStatus state={state} />}
      </div>
      {fixed ? (
        <p className="text-sm text-foreground">{AI_LEVEL_LABELS[value]} (fixé par le niveau maximal)</p>
      ) : editable ? (
        <SegmentedControl<AiLevel>
          aria-label={label}
          variant="quiet"
          value={value}
          onValueChange={(next) => { if (next !== value) onChange(next); }}
          options={options}
          className="max-sm:flex max-sm:w-full max-sm:flex-col max-sm:items-stretch"
        />
      ) : (
        <p className="text-sm text-foreground">{AI_LEVEL_LABELS[value]}</p>
      )}
      {!fixed && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
