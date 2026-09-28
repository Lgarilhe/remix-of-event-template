import React, { useId, useState } from 'react';
import { Check, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

interface PortalCandidate {
  id: string;
  candidate_name: string | null;
  candidate_headline: string | null;
  pipeline_stage: string | null;
}

interface PortalCandidateScoringProps {
  candidate: PortalCandidate;
  projectId: string;
  clientName: string;
  canFillScorecard: boolean;
  portalToken: string;
  /** Date d'envoi d'une évaluation depuis ce navigateur (le serveur ne la renvoie pas). */
  submittedAt?: string | null;
  onSubmitted?: (iso: string) => void;
}

const CRITERIA = [
  { key: 'technical', label: 'Compétences techniques', description: 'Maîtrise des outils et technologies requises' },
  { key: 'experience', label: 'Expérience pertinente', description: 'Adéquation du parcours avec le poste' },
  { key: 'soft_skills', label: 'Savoir-être', description: 'Communication, leadership, travail en équipe' },
  { key: 'culture_fit', label: 'Adéquation culturelle', description: "Affinité avec les valeurs et l'environnement de l'équipe" },
  { key: 'motivation', label: 'Motivation', description: 'Intérêt pour le poste et le projet' },
];

const RECOMMENDATIONS = [
  { key: 'strong_yes', label: 'Oui, absolument' },
  { key: 'yes', label: 'Oui' },
  { key: 'maybe', label: 'À revoir' },
  { key: 'no', label: 'Non' },
];

/** Choix sélectionné : filet et fond d'accent (sélection), comme une case cochée. */
const CHOICE_CLASS =
  'border border-border text-sm data-[state=on]:border-brand data-[state=on]:bg-brand/15 data-[state=on]:font-semibold data-[state=on]:text-foreground';

/** Erreurs de l'envoi, en français : jamais le message technique du serveur. */
function submitErrorMessage(status: number): string {
  if (status === 403) return "Ce lien ne permet plus d'évaluer ce candidat : il a expiré ou l'évaluation a été désactivée.";
  if (status === 404) return "Ce candidat n'est plus disponible dans le portail.";
  return "L'évaluation n'a pas pu être enregistrée. Réessayez dans un instant.";
}

class SubmitError extends Error {}

export const PortalCandidateScoring: React.FC<PortalCandidateScoringProps> = ({
  candidate, projectId, clientName, canFillScorecard, portalToken, submittedAt = null, onSubmitted,
}) => {
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const [recommendation, setRecommendation] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [sentAt, setSentAt] = useState<string | null>(submittedAt);
  const [editing, setEditing] = useState(false);
  const formId = useId();

  if (!canFillScorecard) return null;

  const ratedCount = Object.keys(ratings).length;

  if (sentAt && !editing) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-sm text-foreground" role="status">
          <Check className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
          Évaluation envoyée le {new Date(sentAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
        </p>
        <Button
          variant="link"
          size="xs"
          className="h-auto justify-start px-0 max-md:min-h-11"
          onClick={() => {
            setRatings({});
            setComment('');
            setRecommendation('');
            setEditing(true);
          }}
        >
          Envoyer une nouvelle évaluation
        </Button>
      </div>
    );
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (ratedCount === 0) {
      toast.error('Aucune note', { description: 'Donnez au moins une note avant d’envoyer votre évaluation.' });
      return;
    }
    setSubmitting(true);
    try {
      const totalScore = Object.values(ratings).reduce((sum, r) => sum + r, 0);
      const overallScore = Math.round((totalScore / ratedCount) * 10) / 10;

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      let res: Response;
      try {
        res = await fetch(`${supabaseUrl}/functions/v1/client-portal-data`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${anonKey}`,
            'apikey': anonKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            token: portalToken,
            evaluation: {
              candidate_id: candidate.id,
              criteria: CRITERIA.map((c) => ({
                id: c.key,
                label: c.label,
                description: c.description,
                category: c.key,
                weight: 2,
              })),
              ratings,
              comments: comment ? { general: comment } : {},
              overall_score: overallScore,
              recommendation: recommendation || null,
              summary: `Évaluation de ${clientName}, note moyenne ${overallScore.toLocaleString('fr-FR')}/5`,
            },
          }),
        });
      } catch {
        throw new SubmitError("L'évaluation n'a pas pu être envoyée. Vérifiez votre connexion, puis réessayez.");
      }

      if (!res.ok) throw new SubmitError(submitErrorMessage(res.status));

      const iso = new Date().toISOString();
      setSentAt(iso);
      setEditing(false);
      onSubmitted?.(iso);
      toast.success('Évaluation envoyée', { description: 'Merci : votre recruteur la reçoit avec vos notes.' });
    } catch (err) {
      toast.error('Évaluation non envoyée', {
        description: err instanceof SubmitError ? err.message : "L'évaluation n'a pas pu être enregistrée. Réessayez dans un instant.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5" aria-busy={submitting}>
      {CRITERIA.map((criterion) => (
        <fieldset key={criterion.key} className="space-y-1.5">
          <legend className="text-sm font-medium text-foreground">{criterion.label}</legend>
          <p id={`${formId}-${criterion.key}`} className="text-xs text-muted-foreground">
            {criterion.description}
          </p>
          <ToggleGroup
            type="single"
            value={ratings[criterion.key] ? String(ratings[criterion.key]) : ''}
            onValueChange={(value) => {
              if (value) setRatings((prev) => ({ ...prev, [criterion.key]: Number(value) }));
            }}
            aria-describedby={`${formId}-${criterion.key}`}
            className="justify-start gap-1.5 pt-1"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <ToggleGroupItem
                key={n}
                value={String(n)}
                aria-label={`${n} sur 5`}
                className={`h-9 w-9 p-0 tabular-nums max-md:h-11 max-md:w-11 ${CHOICE_CLASS}`}
              >
                {n}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </fieldset>
      ))}

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium text-foreground">Recommandation</legend>
        <ToggleGroup
          type="single"
          value={recommendation}
          onValueChange={(value) => { if (value) setRecommendation(value); }}
          className="flex-wrap justify-start gap-1.5 pt-1"
        >
          {RECOMMENDATIONS.map((option) => (
            <ToggleGroupItem key={option.key} value={option.key} className={`h-9 px-3 max-md:h-11 ${CHOICE_CLASS}`}>
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor={`${formId}-commentaire`}>
          Commentaire <span className="font-normal text-muted-foreground">(facultatif)</span>
        </Label>
        <Textarea
          id={`${formId}-commentaire`}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Vos impressions sur ce candidat…"
          className="min-h-[80px] resize-y"
        />
      </div>

      <div className="space-y-2">
        <Button type="submit" variant="primary" loading={submitting} disabled={ratedCount === 0} className="w-full max-md:h-11">
          {!submitting && <Send aria-hidden="true" />}
          {submitting ? 'Envoi…' : 'Envoyer mon évaluation'}
        </Button>
        {ratedCount === 0 && (
          <p className="text-center text-xs text-muted-foreground">Donnez au moins une note pour envoyer l'évaluation.</p>
        )}
        {editing && (
          <Button type="button" variant="ghost" size="sm" className="w-full max-md:h-11" onClick={() => setEditing(false)}>
            Annuler
          </Button>
        )}
      </div>
    </form>
  );
};
