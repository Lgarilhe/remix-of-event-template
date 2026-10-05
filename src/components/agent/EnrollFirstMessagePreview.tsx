/**
 * Premier message d'une inscription proposée par l'assistant (refonte mission,
 * lot 5a, outil enroll_in_sequence).
 *
 * dryRun rend dans dry_run_result.details.first_step_preview le premier
 * message construit comme le moteur (variables résolues avec la ligne du
 * candidat dans la mission). Il est montré en entier, sans troncature, sur
 * chaque surface où l'action peut être approuvée : la carte de la conversation
 * (AgentToolApprovalCard) et le Journal (AgentActionsSettings). Un candidat
 * par action : la case des destinataires (dès 5 candidats,
 * contactRecipientsGuard) ne s'applique pas ici.
 */
import React from 'react';
import { AlertTriangle } from 'lucide-react';

export interface FirstStepPreviewText {
  stepId: string;
  actionType: string | null;
  stepLabel: string;
  condition: string | null;
  subject: string | null;
  text: string;
  ai: boolean;
  missing: string[];
}

export interface FirstStepPreviewData {
  candidateName: string | null;
  candidateInMission: boolean;
  texts: FirstStepPreviewText[];
  firstAction: string | null;
}

const asText = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

/** Lecture défensive de details.first_step_preview (donnée stockée en base). */
export function readFirstStepPreview(details: Record<string, unknown> | null | undefined): FirstStepPreviewData | null {
  const raw = details?.first_step_preview;
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const texts = (Array.isArray(p.texts) ? p.texts : [])
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t, i) => ({
      stepId: asText(t.step_id) ?? String(i),
      actionType: asText(t.action_type),
      stepLabel: asText(t.step_label) ?? 'Message',
      condition: asText(t.condition),
      subject: asText(t.subject),
      text: typeof t.text === 'string' ? t.text : '',
      ai: t.ai === true,
      missing: (Array.isArray(t.missing) ? t.missing : []).filter((m): m is string => typeof m === 'string'),
    }));
  return {
    candidateName: asText(p.candidate_name),
    candidateInMission: p.candidate_in_mission !== false,
    texts,
    firstAction: asText(p.first_action),
  };
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export const EnrollFirstMessagePreview: React.FC<{ preview: FirstStepPreviewData; fallbackName: string }> = ({ preview, fallbackName }) => {
  const name = preview.candidateName ?? fallbackName;
  return (
    <section
      aria-label={`Premier message pour ${name}`}
      className="mt-1 flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-2.5"
    >
      <p className="text-xs font-semibold text-foreground">Premier message pour {name}</p>
      {!preview.candidateInMission && (
        <p className="text-xs text-muted-foreground">
          Ce candidat n'est pas encore dans la mission : aperçu construit avec son seul nom.
        </p>
      )}
      {preview.texts.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {preview.firstAction
            ? `Aucun message écrit. Première action : ${lowerFirst(preview.firstAction)}.`
            : 'Aucun message écrit dans cette séquence.'}
        </p>
      ) : (
        preview.texts.map((t) => (
          <div key={`${t.stepId}-${t.condition ?? ''}`} className="flex flex-col gap-1">
            <p className="text-2xs font-medium text-muted-foreground">
              {t.stepLabel}
              {t.condition ? ` · ${t.condition}` : ''}
            </p>
            {t.subject && (
              <p className="text-xs text-foreground">
                <span className="font-medium">Objet : </span>
                {t.subject}
              </p>
            )}
            {t.ai ? (
              <p className="text-xs text-muted-foreground">
                Message rédigé par l'IA Konekt pour ce candidat : inscrivez-le depuis l'écran pour relire son message.
              </p>
            ) : t.text ? (
              <p className="whitespace-pre-wrap break-words rounded-md bg-card px-2 py-1.5 text-xs leading-relaxed text-foreground">
                {t.text}
              </p>
            ) : (
              // Note vide une fois les variables résolues : l'invitation part sans note.
              <p className="text-xs text-muted-foreground">
                {t.actionType === 'connection_request' ? 'Invitation envoyée sans note.' : 'Sans texte.'}
              </p>
            )}
            {t.missing.map((note) => (
              <p key={note} className="flex items-start gap-1.5 text-2xs text-warning">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                {note}
              </p>
            ))}
          </div>
        ))
      )}
    </section>
  );
};
