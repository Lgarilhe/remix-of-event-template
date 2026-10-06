// Aperçu réel sous le message d'une étape (lot 5d-2) : le texte qui partira
// pour un vrai candidat, rendu par renderTemplatePreviewSegments
// (src/lib/templatePreview.ts, copie du moteur) avec les valeurs de
// preview_values (useSequencePreview). Candidats : les inscrits, puis les
// Retenus de la mission, puis l'exemple fictif ; ‹ › pour passer de l'un à
// l'autre. Une donnée absente est surlignée là où la variable sera retirée.
// Note d'invitation : compteur de 300 caractères sur le texte rendu, coupé
// comme le moteur le coupe. Étape rédigée par l'IA : le modèle sert de
// structure, le message est rédigé et relu pour chaque candidat.
// Pendant le chargement, un squelette : jamais un texte faux.
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { INVITE_NOTE_MAX, inviteNoteText, renderTemplatePreviewSegments, type PreviewSegment } from '@/lib/templatePreview';
import { templateSegments, variableLabel } from '@/lib/sequenceVariables';
import type { PreviewSubject, SequencePreview } from '@/hooks/useSequencePreview';
import { cn } from '@/lib/utils';

/** Phrase de l'aperçu d'une étape rédigée par l'IA (plan 5d-2). */
export const AI_PREVIEW_NOTICE = 'Rédigé et relu pour chaque candidat avant l’inscription.';
export const EXAMPLE_ONLY_NOTICE = 'Aperçu sur un exemple. Retenez des candidats dans la mission pour voir leurs vrais messages.';

const KIND_LABEL: Record<PreviewSubject['kind'], string> = {
  enrolled: 'Inscrit à la séquence',
  retained: 'Retenu dans la mission',
  example: 'Exemple fictif',
};

function Segments({ segments }: { segments: PreviewSegment[] }) {
  return (
    <>
      {segments.map((segment, i) => (segment.kind === 'text'
        ? <span key={i}>{segment.text}</span>
        : (
          <mark key={i} className="rounded-sm bg-warning-muted px-0.5 text-warning">
            <span className="sr-only">Donnée absente, retirée du message : </span>
            [{variableLabel(segment.key) ?? segment.key}]
          </mark>
        )))}
    </>
  );
}

interface MessagePreviewProps {
  preview: SequencePreview;
  index: number;
  onIndexChange: (index: number) => void;
  template: string;
  /** Objet d'un InMail (ou d'un Message IA qui part en InMail). */
  subject?: string | null;
  isInvite: boolean;
  usesAi: boolean;
}

export function MessagePreview({ preview, index, onIndexChange, template, subject, isInvite, usesAi }: MessagePreviewProps) {
  const { subjects, status } = preview;
  const count = subjects.length;
  const current = subjects[((index % count) + count) % count];
  const loading = status === 'loading';
  const position = ((index % count) + count) % count;

  let body: ReactNode;
  let counter: ReactNode = null;
  let missingCount = 0;
  if (usesAi) {
    body = (
      <div className="space-y-2">
        <p className="font-medium text-foreground">{AI_PREVIEW_NOTICE}</p>
        {template.trim() && (
          <p className="whitespace-pre-wrap break-words text-foreground-secondary">
            <span className="text-muted-foreground">Structure donnée à l’IA Konekt : </span>
            {templateSegments(template).map((s, i) => (s.kind === 'text'
              ? <span key={i}>{s.text}</span>
              : <span key={i} className="rounded-sm bg-brand/15 px-0.5 font-medium">{s.variable.label ?? s.variable.raw}</span>))}
          </p>
        )}
      </div>
    );
  } else if (loading) {
    body = (
      <div role="status" aria-label="Préparation de l’aperçu" className="space-y-2">
        <Skeleton className="h-3.5 w-11/12 rounded-sm" />
        <Skeleton className="h-3.5 w-full rounded-sm" />
        <Skeleton className="h-3.5 w-2/3 rounded-sm" />
      </div>
    );
  } else if (current.entry.status !== 'ready') {
    const entry = current.entry;
    body = (
      <div className="space-y-2">
        <p className="text-foreground-secondary">{entry.status === 'unavailable' ? entry.message : 'Aperçu indisponible pour l’instant.'}</p>
        {entry.status === 'unavailable' && entry.retryable && (
          <Button type="button" variant="outline" size="xs" onClick={preview.retry} className="max-md:h-11">Réessayer</Button>
        )}
      </div>
    );
  } else {
    const values = { ...current.entry.values, ...preview.sendTime, ...current.entry.atSend };
    const rendered = renderTemplatePreviewSegments(template, values);
    const renderedSubject = subject != null ? renderTemplatePreviewSegments(subject, values) : null;
    missingCount = rendered.missing.length + (renderedSubject?.missing.length ?? 0);
    const sentText = rendered.segments.map((s) => (s.kind === 'text' ? s.text : '')).join('');
    const tooLong = isInvite && sentText.trim().length > INVITE_NOTE_MAX;
    const shown = tooLong ? inviteNoteText(sentText) : null;
    body = (
      <div className="space-y-2">
        {renderedSubject && (
          <p className="break-words text-foreground">
            <span className="text-muted-foreground">Objet : </span>
            {subject?.trim() ? <Segments segments={renderedSubject.segments} /> : <span className="text-muted-foreground">objet à renseigner</span>}
          </p>
        )}
        <p className="whitespace-pre-wrap break-words text-foreground">
          {!template.trim()
            ? <span className="text-muted-foreground">Le message est vide.</span>
            : shown ?? <Segments segments={rendered.segments} />}
        </p>
      </div>
    );
    if (isInvite) {
      const length = (shown ?? sentText.trim()).length;
      counter = (
        <p className={cn('text-xs tabular-nums', tooLong ? 'font-medium text-danger' : 'text-muted-foreground')}>
          {tooLong
            ? `${sentText.trim().length} caractères pour ce candidat : la note sera coupée à ${INVITE_NOTE_MAX} caractères à l’envoi, comme ci-dessus.`
            : `${length} sur ${INVITE_NOTE_MAX} caractères pour ce candidat`}
        </p>
      );
    }
  }

  // Étape rédigée par l'IA : le même texte pour tous (la structure), ni candidat ni navigation.
  if (usesAi) {
    return (
      <section aria-label="Aperçu du message" className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Structure du message</h3>
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm">{body}</div>
      </section>
    );
  }

  return (
    <section aria-label="Aperçu du message" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {loading && !usesAi
          ? <Skeleton className="h-4 w-40 rounded-sm" aria-label="Chargement des candidats" />
          : <h3 className="min-w-0 text-sm font-medium text-foreground">Aperçu pour {current.name}</h3>}
        {count > 1 && !loading && (
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon-xs" aria-label="Candidat précédent" onClick={() => onIndexChange(position - 1 < 0 ? count - 1 : position - 1)} className="max-md:h-11 max-md:w-11">
              <ChevronLeft aria-hidden="true" />
            </Button>
            <span className="text-xs tabular-nums text-muted-foreground">{position + 1} / {count}</span>
            <Button type="button" variant="ghost" size="icon-xs" aria-label="Candidat suivant" onClick={() => onIndexChange((position + 1) % count)} className="max-md:h-11 max-md:w-11">
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
      {!loading && <p className="text-xs text-muted-foreground">{KIND_LABEL[current.kind]}</p>}
      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm">{body}</div>
      {counter}
      {missingCount > 0 && <p className="text-xs text-muted-foreground">Donnée absente surlignée : la variable sera retirée du message envoyé.</p>}
      {status === 'error' && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-secondary">
          <span>Aperçu sur les candidats indisponible pour l’instant.</span>
          <Button type="button" variant="link" size="xs" onClick={preview.retry} className="h-auto p-0 max-md:min-h-11">Réessayer</Button>
        </div>
      )}
      {status === 'ready' && preview.exampleOnly && <p className="text-xs text-muted-foreground">{EXAMPLE_ONLY_NOTICE}</p>}
    </section>
  );
}
