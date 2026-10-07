/**
 * Séquence proposée par l'assistant (refonte mission, lot 5e, outil
 * create_sequence) : chaque étape avec son délai, sa condition, son objet et
 * son texte entier, sans troncature, et les formulations à relire. Montrée sur
 * chaque surface où la proposition peut être approuvée : la carte de la
 * conversation (AgentToolApprovalCard) et le Journal (AgentActionsSettings).
 * Les variables s'affichent en puces françaises (« Prénom »), comme dans
 * l'éditeur et « Proposition de l'IA », jamais en syntaxe {{prenom}}.
 */
import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { templateSegments } from '@/lib/sequenceVariables';
import {
  sequenceDraftConditionLabel,
  sequenceDraftDelayLabel,
  sequenceDraftStepTitle,
  type SequenceDraftPreviewData,
} from './sequenceDraftPreview';

/** Texte entier, variables en puces (libellé français, sinon la variable telle qu'écrite). */
const TemplateText: React.FC<{ text: string }> = ({ text }) => (
  <>
    {templateSegments(text).map((segment, i) => (segment.kind === 'text'
      ? <span key={i}>{segment.text}</span>
      : <span key={i} className="rounded-sm bg-brand/15 px-0.5 font-medium">{segment.variable.label ?? segment.variable.raw}</span>))}
  </>
);

export const SequenceDraftPreview: React.FC<{ preview: SequenceDraftPreviewData }> = ({ preview }) => (
  <section
    aria-label={`Étapes de la séquence ${preview.name}`}
    className="mt-1 flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-2.5"
  >
    <p className="text-xs font-semibold text-foreground">
      {preview.name}
      {preview.missionName ? ` · ${preview.missionName}` : ''}
    </p>
    <ol className="flex flex-col gap-2.5">
      {preview.steps.map((step, index) => {
        const condition = sequenceDraftConditionLabel(step);
        return (
          <li key={step.id} className="flex flex-col gap-1">
            <p className="text-2xs font-medium text-muted-foreground">
              {index + 1}. {sequenceDraftStepTitle(step)} · {sequenceDraftDelayLabel(step, index)}
              {condition ? ` · ${condition}` : ''}
            </p>
            {step.subject && (
              <p className="break-words text-xs text-foreground">
                <span className="font-medium">Objet : </span>
                <TemplateText text={step.subject} />
              </p>
            )}
            {step.body && (
              <p className="whitespace-pre-wrap break-words rounded-md bg-card px-2 py-1.5 text-xs leading-relaxed text-foreground">
                <TemplateText text={step.body} />
              </p>
            )}
            {step.warnings.map((warning) => (
              <p key={warning} className="flex items-start gap-1.5 text-2xs text-warning">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                {warning}
              </p>
            ))}
          </li>
        );
      })}
    </ol>
  </section>
);
