// Onglet « Étapes » de la page d'une séquence (lot 5c-2) : le fil vertical des
// étapes, en lecture, rendu en DOM (listes imbriquées par branche) : départ,
// délais (« Attendre 5 jours », « Aussitôt »), fourches « Connecté (1er
// degré) / Non connecté » et « Acceptée / Pas acceptée », fin de séquence.
// « Modifier les étapes » ouvre l'éditeur actuel jusqu'au lot 5d-2.
import { useMemo } from 'react';
import { Check, Clock, CornerDownRight, Flag, Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/layout';
import { SequenceActionIcon } from '@/components/outreach/SequenceBadges';
import type { SequenceStepRow } from '@/components/outreach/sequence/sequenceGraph';
import { buildSequenceFlow, type FlowNode } from '@/lib/sequenceFlow';
import { plural } from '@/lib/plural';
import { cn } from '@/lib/utils';

interface StepsReadOnlyProps {
  steps: readonly SequenceStepRow[];
  /** Étapes illisibles : l'onglet le dit au lieu d'afficher un fil vide. */
  stepsUnavailable?: boolean;
  canEdit: boolean;
  /** Inscrits de la séquence (avertissement avant de modifier). */
  enrolledCount: number;
  onEdit: () => void;
}

function Connector() {
  return <div className="mx-auto h-4 w-px bg-border" aria-hidden="true" />;
}

function DelayPill({ text }: { text: string }) {
  return (
    <div className="flex justify-center">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground">
        <Clock className="h-3 w-3 text-foreground" aria-hidden="true" />
        {text}
      </span>
    </div>
  );
}

function StepCard({ node }: { node: Extract<FlowNode, { kind: 'step' | 'fork' }> }) {
  const excerpt = node.kind === 'step' ? node.excerpt : null;
  const description = node.description;
  return (
    <div className="mx-auto w-full max-w-md rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <span className="grid h-6 min-w-6 place-items-center rounded-md bg-muted px-1 text-xs tabular-nums text-muted-foreground" aria-hidden="true">
          {node.number}
        </span>
        <SequenceActionIcon type={node.actionType} className="h-4 w-4 text-foreground" />
        <h3 className="min-w-0 text-sm font-semibold text-foreground">
          <span className="sr-only">Étape {node.number} : </span>
          {node.title}
        </h3>
      </div>
      {excerpt && <p className="mt-1.5 line-clamp-2 text-sm text-foreground-secondary">{excerpt}</p>}
      {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
      {node.badges.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {node.badges.map((badge) => (
            <Badge key={badge} variant="muted">{badge}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function FlowList({ nodes, label }: { nodes: FlowNode[]; label?: string }) {
  return (
    <ol className="space-y-0" aria-label={label}>
      {nodes.map((node, index) => {
        const key = node.kind === 'step' || node.kind === 'fork' ? node.id : `${node.kind}-${index}`;
        return (
          <li key={key}>
            {index > 0 && <Connector />}
            {node.kind === 'end' ? (
              <div className="flex justify-center">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                  <Flag className="h-3 w-3 text-foreground" aria-hidden="true" />
                  Fin de la séquence
                </span>
              </div>
            ) : node.kind === 'join' ? (
              <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <CornerDownRight className="h-3.5 w-3.5 text-foreground" aria-hidden="true" />
                Rejoint l’étape {node.number} : {node.title}
              </p>
            ) : (
              <>
                {index > 0 && (
                  <>
                    <DelayPill text={node.delay} />
                    <Connector />
                  </>
                )}
                <StepCard node={node} />
                {node.kind === 'fork' && (
                  <div className="mt-4 grid gap-6 md:grid-cols-2" role="group" aria-label={`Branches de l’étape ${node.number}`}>
                    {node.branches.map((branch, b) => (
                      <section key={branch.label} aria-label={`Branche : ${branch.label}`} className="min-w-0">
                        <p className={cn('mb-2 flex items-center justify-center gap-1.5 text-xs font-medium', b === 0 ? 'text-foreground' : 'text-foreground-secondary')}>
                          {b === 0 ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <X className="h-3.5 w-3.5 text-foreground" aria-hidden="true" />}
                          {branch.label}
                        </p>
                        <FlowList nodes={branch.nodes} />
                      </section>
                    ))}
                  </div>
                )}
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function StepsReadOnly({ steps, stepsUnavailable = false, canEdit, enrolledCount, onEdit }: StepsReadOnlyProps) {
  const flow = useMemo(() => buildSequenceFlow(steps), [steps]);
  const editButton = canEdit && (
    <Button type="button" variant="outline" size="sm" onClick={onEdit} className="max-md:h-11">
      <Pencil aria-hidden="true" />
      Modifier les étapes
    </Button>
  );

  if (stepsUnavailable && steps.length === 0) {
    return <p role="alert" className="text-sm text-muted-foreground">Étapes indisponibles pour l’instant. Actualisez la page dans un instant.</p>;
  }
  if (flow.nodes.length === 0) {
    return (
      <EmptyState
        illustration="envoi"
        title="Commencer par ajouter une étape"
        description="La plupart des séquences de recrutement commencent par une visite de profil ou une invitation."
        action={editButton || undefined}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-foreground-secondary">{plural(flow.stepCount, 'étape', 'étapes')}, jouées dans cet ordre pour chaque candidat.</p>
          {enrolledCount > 0 && canEdit && (
            <p className="max-w-2xl text-xs text-muted-foreground">
              {plural(enrolledCount, 'candidat est inscrit', 'candidats sont inscrits')}. Vos changements de texte et de délai valent pour les étapes pas encore envoyées. Une étape déjà envoyée ne peut pas être supprimée.
            </p>
          )}
        </div>
        {editButton}
      </div>

      <div className="mx-auto w-full max-w-3xl">
        <div className="flex justify-center">
          <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">{flow.start}</span>
        </div>
        <Connector />
        <FlowList nodes={flow.nodes} label="Étapes de la séquence" />
      </div>
    </div>
  );
}
