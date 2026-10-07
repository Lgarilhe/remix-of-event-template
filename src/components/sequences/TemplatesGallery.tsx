// Onglet « Modèles » de l'écran Séquences (lot 5c-2) : les modèles Konekt,
// livrés dans le code (src/lib/sequenceStarterTemplates.ts), puis ceux de
// l'organisation (sequence_templates). « Utiliser ce modèle » ouvre l'éditeur
// avec ses étapes (lot 5d-2 : /sequences/nouvelle?depart=modele:<clé>, la clé
// d'un modèle Konekt ou l'identifiant d'un modèle de l'organisation) : rien
// n'est enregistré avant « Enregistrer ».
//
// Une liste à filets, sans cartes (docs/design/06-simplicite.md, règle 3).
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/layout';
import { SequenceActionIcon } from '@/components/outreach/SequenceBadges';
import { STEP_TYPE_LABELS } from '@/components/outreach/sequence/sequenceGraph';
import { sequenceActionLabel } from '@/lib/sequenceCatalog';
import {
  STARTER_TEMPLATES,
  starterTemplateToSequence,
  templateRowToSequence,
  type TemplateRow,
} from '@/lib/sequenceStarterTemplates';
import type { Sequence } from '@/types/sequence';

const stepName = (type: string) => STEP_TYPE_LABELS[type] ?? sequenceActionLabel(type);
const stepCount = (n: number) => `${n} étape${n > 1 ? 's' : ''}`;
const PREVIEW_STEPS = 6;

function StepIcons({ types }: { types: string[] }) {
  return (
    <span className="flex items-center gap-1" aria-label={`${stepCount(types.length)} : ${types.slice(0, PREVIEW_STEPS).map(stepName).join(', ')}${types.length > PREVIEW_STEPS ? '…' : ''}`} role="img">
      {types.slice(0, PREVIEW_STEPS).map((type, i) => (
        <span key={i} className="grid h-6 w-6 place-items-center rounded-md bg-muted text-foreground" title={stepName(type)}>
          <SequenceActionIcon type={type} className="h-3.5 w-3.5" />
        </span>
      ))}
      <span className="ml-1 text-xs text-muted-foreground">{stepCount(types.length)}</span>
    </span>
  );
}

function TemplateLine({ name, konektInOrg = false, description, types, onUse }: {
  name: string;
  /** Modèle Konekt enregistré en base, rangé avec ceux de l'organisation : il le dit. */
  konektInOrg?: boolean;
  description: string | null;
  types: string[];
  onUse: () => void;
}) {
  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-md font-semibold text-foreground">{name}</h3>
          {konektInOrg && <Badge variant="muted">Modèle Konekt</Badge>}
        </div>
        {description && <p className="text-sm text-foreground-secondary">{description}</p>}
        <StepIcons types={types} />
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onUse} className="self-start sm:self-center max-md:h-11">
        Utiliser ce modèle
        <span className="sr-only"> : {name}</span>
      </Button>
    </li>
  );
}

/** Clé du modèle dans &depart=modele:<clé> : clé d'un modèle Konekt, identifiant d'un modèle de l'organisation. */
export type TemplateKey = string;

export function TemplatesGallery({ onUse }: { onUse: (sequence: Sequence, key: TemplateKey) => void }) {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const { data, error } = await supabase
        .from('sequence_templates')
        .select('id, name, description, steps_config, category, is_system, created_at')
        .order('is_system', { ascending: false })
        .order('name');
      if (error) throw error;
      setTemplates((data ?? []).map((row) => ({
        ...row,
        steps_config: Array.isArray(row.steps_config) ? (row.steps_config as Array<Record<string, unknown>>) : [],
      })));
    } catch (err) {
      console.error('Error fetching sequence templates:', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTemplates();
  }, [fetchTemplates]);

  return (
    <div className="space-y-8">
      <section aria-labelledby="templates-konekt" className="space-y-1">
        <h2 id="templates-konekt" className="eyebrow">Modèles Konekt</h2>
        <ul className="divide-y divide-border">
          {STARTER_TEMPLATES.map((template) => (
            <TemplateLine
              key={template.key}
              name={template.name}
              description={template.description}
              types={template.build().map((s) => s.actionType)}
              onUse={() => onUse(starterTemplateToSequence(template), template.key)}
            />
          ))}
        </ul>
      </section>

      <section aria-labelledby="templates-org" className="space-y-1">
        <h2 id="templates-org" className="eyebrow">Modèles de votre organisation</h2>
        {loading ? (
          <div role="status" aria-label="Chargement des modèles" className="space-y-3 py-4">
            <Skeleton className="h-4 w-1/3 rounded-sm" />
            <Skeleton className="h-3 w-1/2 rounded-sm" />
          </div>
        ) : loadError ? (
          <ErrorState
            variant="compact"
            title="Modèles indisponibles pour l’instant."
            description="Vérifiez votre connexion, puis réessayez."
            onRetry={() => { void fetchTemplates(); }}
          />
        ) : templates.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Enregistrez une séquence comme modèle depuis son menu « ... » : elle apparaîtra ici.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {templates.map((template) => (
              <TemplateLine
                key={template.id}
                name={template.name}
                konektInOrg={template.is_system}
                description={template.description}
                types={(template.steps_config ?? []).map((s) => String(s.action_type ?? s.actionType ?? 'message'))}
                onUse={() => onUse(templateRowToSequence(template), template.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
