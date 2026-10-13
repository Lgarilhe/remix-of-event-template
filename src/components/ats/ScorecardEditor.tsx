/** Vue commune des grilles réelles et d'exemple. Aucun accès aux données ou au micro. */
import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronLeft, ChevronRight, Info, MessageSquare } from 'lucide-react';
import { HIRING_VERDICTS, interviewTypeLabel } from '@/lib/verdicts';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

export interface ScorecardCriterion {
  id: string;
  label: string;
  description: string;
  category: 'technical' | 'soft_skill' | 'culture_fit' | 'motivation';
  weight: number;
  suggestedQuestions?: string[];
  ratingRubric?: Record<string, string>;
  redFlags?: string[];
}

export type ScorecardRecommendation = 'strong_yes' | 'yes' | 'maybe' | 'no' | 'strong_no';
export type ScorecardInterviewStage = 'phone_screen' | 'technique' | 'culture_fit' | 'final';

export interface ScorecardEditorValue {
  criteria: ScorecardCriterion[];
  ratings: Record<string, number>;
  comments: Record<string, string>;
  overallScore: number | null;
  jobTitle?: string;
  interviewStage?: ScorecardInterviewStage;
  recommendation?: ScorecardRecommendation;
  summary?: string;
  followUpNotes?: string;
}

interface ScorecardEditorProps {
  value: ScorecardEditorValue;
  currentCriterionIndex: number;
  onCriterionChange: (index: number) => void;
  onRate: (criterionId: string, rating: number) => void;
  onComment: (criterionId: string, comment: string) => void;
  onRecommendationChange: (recommendation: ScorecardRecommendation | undefined) => void;
  onSummaryChange: (summary: string) => void;
  onFollowUpNotesChange: (notes: string) => void;
  recommendationFromReport?: boolean;
  status?: React.ReactNode;
  onBack?: () => void;
  actions?: React.ReactNode;
  assistant?: React.ReactNode;
  assistantAutoNavigation?: { enabled: boolean; onChange: (enabled: boolean) => void };
  children?: React.ReactNode;
}

const RECOMMENDATION_KEYS: ScorecardRecommendation[] = ['strong_yes', 'yes', 'maybe', 'no', 'strong_no'];

/** Catégories d'un critère : un libellé, sans couleur (revue design E-32). */
const CATEGORY_LABELS: Record<string, string> = {
  technical: 'Technique',
  soft_skill: 'Savoir-être',
  culture_fit: 'Adéquation culturelle',
  motivation: 'Motivation',
};
const CATEGORY_ORDER = ['technical', 'soft_skill', 'culture_fit', 'motivation'];

/** Poids d'un critère, écrit en toutes lettres, sans rouge. */
const WEIGHT_LABELS: Record<number, string> = { 3: 'Critique', 2: 'Important', 1: 'Bonus' };

/** Choix sélectionné d'un groupe : aplat monochrome, comme le bouton principal (E-32). */
const CHOICE_CLASS =
  'data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:font-semibold data-[state=on]:text-background data-[state=on]:hover:bg-foreground data-[state=on]:hover:text-background';

const formatAverage = (value: number) =>
  value.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Raccourcis de la grille (1 à 5 pour noter, flèches pour changer de critère) :
 * jamais pendant une saisie, dans un menu, ou quand une autre fenêtre est
 * ouverte par-dessus la grille (la fiche candidat qui la contient est une fenêtre).
 */
function isShortcutBlocked(e: KeyboardEvent, root: HTMLElement | null): boolean {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return true;
  const el = e.target as HTMLElement | null;
  if (el?.isContentEditable) return true;
  if (el?.closest?.('input, textarea, select, [role="menu"], [role="listbox"], [role="combobox"]')) return true;
  const overlays = document.querySelectorAll(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]',
  );
  return Array.from(overlays).some((overlay) => !root || !overlay.contains(root));
}

export function ScorecardEditor({
  value, currentCriterionIndex, onCriterionChange, onRate, onComment,
  onRecommendationChange, onSummaryChange, onFollowUpNotesChange,
  recommendationFromReport, status, onBack, actions, assistant,
  assistantAutoNavigation, children,
}: ScorecardEditorProps) {
  const baseId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [showFullRubric, setShowFullRubric] = useState(false);
  useEffect(() => { setShowFullRubric(false); }, [currentCriterionIndex]);
  const criteria = value.criteria;
  const total = criteria.length;
  const criterionIdx = Math.max(0, Math.min(currentCriterionIndex, total - 1));
  const criterion = criteria[criterionIdx];
  const rating = criterion ? value.ratings[criterion.id] : undefined;
  const comment = criterion ? value.comments[criterion.id] || '' : '';
  const questions = criterion?.suggestedQuestions || [];
  const redFlags = criterion?.redFlags || [];
  const rubric = criterion?.ratingRubric || {};
  const rubricEntries = Object.entries(rubric).sort(([a], [b]) => Number(a) - Number(b));
  const overallScore = value.overallScore;
  const ratedCount = criteria.filter((c) => value.ratings[c.id] != null).length;
  const categoryAverages = CATEGORY_ORDER.map((cat) => {
    const rated = criteria.filter((c) => c.category === cat && value.ratings[c.id] != null);
    if (rated.length === 0) return null;
    const avg = rated.reduce((sum, c) => sum + value.ratings[c.id], 0) / rated.length;
    return { cat, avg };
  }).filter((item): item is { cat: string; avg: number } => item !== null);

  // Même navigation au clavier pour une grille enregistrée ou un exemple local.
  useEffect(() => {
    if (criteria.length === 0) return;
    const handler = (event: KeyboardEvent) => {
      if (isShortcutBlocked(event, rootRef.current)) return;
      if (event.key >= '1' && event.key <= '5') {
        event.preventDefault();
        if (criterion) onRate(criterion.id, Number(event.key));
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        onCriterionChange(Math.min(total - 1, criterionIdx + 1));
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        onCriterionChange(Math.max(0, criterionIdx - 1));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [criteria.length, criterion, criterionIdx, total, onRate, onCriterionChange]);

  const touch = 'max-md:min-h-11';
  const ids = {
    card: `${baseId}-critere`, rating: `${baseId}-note`, scale: `${baseId}-echelle`,
    rubric: `${baseId}-bareme`, notes: `${baseId}-notes`, verdict: `${baseId}-verdict`,
    reco: `${baseId}-reco`, summary: `${baseId}-resume`, followUp: `${baseId}-suivi`,
    autoNav: `${baseId}-suivi-auto`,
  };

  return (
    // Le conteneur s'adapte au tiroir candidat comme à la page plein écran.
    <div ref={rootRef} className="min-w-0 max-w-full space-y-4 [container-type:inline-size]">
      {(onBack || status) && <div className="flex flex-wrap items-center justify-between gap-2">
        {onBack && <Button variant="ghost" size="sm" onClick={onBack} className={cn('-ml-2', touch)}>
          <ChevronLeft aria-hidden="true" />
          Retour aux grilles
        </Button>}
        {status}
      </div>}

      {/* En-tête : moyenne, progression, actions */}
      <section
        aria-label="Synthèse de la grille"
        className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 [@container(min-width:56rem)]:flex-row [@container(min-width:56rem)]:items-center [@container(min-width:56rem)]:justify-between"
      >
        <div className="flex min-w-0 items-start gap-4">
          <div className="shrink-0">
            <p className="eyebrow">Moyenne</p>
            {overallScore != null ? (
              <p className="mt-0.5 text-2xl font-semibold tabular-nums text-foreground">
                {formatAverage(overallScore)}
                <span className="text-sm font-medium text-muted-foreground">/5</span>
              </p>
            ) : (
              <p className="mt-0.5 text-2xl font-semibold tabular-nums text-muted-foreground">
                <span className="sr-only">Pas encore de note</span>
                <span aria-hidden="true">–</span>
                <span aria-hidden="true" className="text-sm font-medium">/5</span>
              </p>
            )}
          </div>
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="text-sm font-semibold text-foreground">
                {ratedCount > 1 ? `${ratedCount} critères notés` : `${ratedCount} critère noté`} sur {total}
              </p>
              {value.interviewStage && <Badge variant="muted">{interviewTypeLabel(value.interviewStage)}</Badge>}
            </div>
            {categoryAverages.length > 0 && (
              <dl className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                {categoryAverages.map(({ cat, avg }) => (
                  <div key={cat} className="flex gap-1">
                    <dt className="text-muted-foreground">{CATEGORY_LABELS[cat]}</dt>
                    <dd className="font-medium tabular-nums text-foreground">{formatAverage(avg)}</dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="truncate text-xs text-muted-foreground">
              {value.jobTitle || 'Poste non précisé'}
            </p>
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 [@container(min-width:56rem)]:border-t-0 [@container(min-width:56rem)]:pt-0">
          {actions}
        </div>}
      </section>

      <div className="flex min-w-0 flex-wrap items-start gap-4">
        {/* Liste des critères (cadre large) */}
        <nav aria-label="Critères" className="hidden w-44 shrink-0 [@container(min-width:48rem)]:sticky [@container(min-width:48rem)]:top-4 [@container(min-width:48rem)]:block">
          <p className="eyebrow mb-2 px-2">Critères ({total})</p>
          <ol className="space-y-0.5">
            {criteria.map((c, idx) => {
              const r = value.ratings[c.id];
              const current = idx === criterionIdx;
              return (
                <li key={c.id}>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-current={current ? 'step' : undefined}
                    aria-label={`${c.label}, ${r != null ? `noté ${r} sur 5` : 'pas encore noté'}`}
                    onClick={() => onCriterionChange(idx)}
                    className={cn(
                      'h-auto w-full justify-between gap-2 whitespace-normal px-2 py-1.5 text-left text-xs font-normal text-foreground-secondary',
                      current && 'bg-accent font-semibold text-foreground',
                    )}
                  >
                    <span className="line-clamp-2 min-w-0 flex-1">{c.label}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{r ?? '–'}</span>
                  </Button>
                </li>
              );
            })}
          </ol>
          {assistantAutoNavigation && (
            <div className="mt-3 flex items-center gap-2 border-t border-border px-2 pt-3">
              <Checkbox
                id={ids.autoNav}
                checked={assistantAutoNavigation.enabled}
                onCheckedChange={(checked) => assistantAutoNavigation.onChange(checked === true)}
              />
              <Label htmlFor={ids.autoNav} className="text-xs font-normal text-muted-foreground">
                Suivre les critères abordés
              </Label>
            </div>
          )}
        </nav>

        <div className="min-w-0 flex-1 space-y-3">
          {/* Liste des critères (cadre étroit : tiroir, téléphone, tablette) */}
          <nav aria-label="Critères" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [@container(min-width:48rem)]:hidden">
            {criteria.map((c, idx) => {
              const r = value.ratings[c.id];
              const current = idx === criterionIdx;
              return (
                // Une puce grise par critère, le critère en cours en contour d'encre : six à huit contours côte à côte alourdiraient la rangée.
                <Button
                  key={c.id}
                  variant="ghost"
                  size="xs"
                  aria-current={current ? 'step' : undefined}
                  aria-label={`Critère ${idx + 1}\u00a0: ${c.label}, ${r != null ? `noté ${r} sur 5` : 'pas encore noté'}`}
                  onClick={() => onCriterionChange(idx)}
                  className={cn('shrink-0 bg-muted tabular-nums hover:bg-accent', touch, current && 'border border-foreground bg-card font-semibold dark:border-foreground/70')}
                >
                  {idx + 1}
                  {r != null && <Check aria-hidden="true" />}
                </Button>
              );
            })}
          </nav>

          {criterion && (
            <article aria-labelledby={ids.card} className="overflow-hidden rounded-xl border border-border bg-card">
              <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <Badge variant="muted">{CATEGORY_LABELS[criterion.category] ?? 'Critère'}</Badge>
                  <Badge variant={criterion.weight === 3 ? 'outline' : 'muted'}>
                    {WEIGHT_LABELS[criterion.weight] ?? 'Bonus'}
                  </Badge>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  Critère {criterionIdx + 1} sur {total}
                </span>
              </header>

              <div className="space-y-5 px-4 py-4 sm:px-5">
                <div>
                  <h3 id={ids.card} className="text-base font-semibold text-foreground">{criterion.label}</h3>
                  {criterion.description && (
                    <p className="mt-1.5 text-sm text-foreground-secondary">{criterion.description}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <p id={ids.rating} className="eyebrow">Votre note</p>
                  <ToggleGroup
                    type="single"
                    role="radiogroup"
                    aria-labelledby={ids.rating}
                    aria-describedby={ids.scale}
                    variant="outline"
                    value={rating ? String(rating) : ''}
                    onValueChange={(value) => {
                      if (value) onRate(criterion.id, Number(value));
                    }}
                    className="justify-start gap-2"
                  >
                    {[1, 2, 3, 4, 5].map((score) => (
                      <ToggleGroupItem
                        key={score}
                        value={String(score)}
                        aria-label={`Noter ${score} sur 5`}
                        className={cn('h-10 w-10 p-0 text-md tabular-nums max-md:h-11 max-md:w-11', CHOICE_CLASS)}
                      >
                        {score}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  <p id={ids.scale} className="text-xs text-muted-foreground">
                    De 1 (très faible) à 5 (exceptionnel). Touches 1 à 5 pour noter, flèches pour changer de critère.
                  </p>
                </div>

                {rating && !showFullRubric && rubric[String(rating)] && (
                  <p className="rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
                    <span className="font-semibold tabular-nums">{`${rating}/5\u00a0: `}</span>
                    {rubric[String(rating)]}
                  </p>
                )}

                {rubricEntries.length > 0 && (
                  <div>
                    <Button
                      variant="ghost"
                      size="xs"
                      aria-expanded={showFullRubric}
                      aria-controls={ids.rubric}
                      onClick={() => setShowFullRubric((v) => !v)}
                      className={cn('-ml-2', touch)}
                    >
                      <ChevronDown aria-hidden="true" className={cn('transition-transform duration-150', showFullRubric && 'rotate-180')} />
                      {showFullRubric ? "Masquer l'échelle complète" : "Voir l'échelle complète"}
                    </Button>
                    {showFullRubric && (
                      <ol id={ids.rubric} className="mt-2 space-y-1 rounded-lg border border-border p-2">
                        {rubricEntries.map(([score, desc]) => {
                          const isActive = String(rating) === score;
                          return (
                            <li
                              key={score}
                              className={cn(
                                'flex items-start gap-2.5 rounded-md px-2 py-1.5 text-xs',
                                isActive ? 'bg-accent font-medium text-foreground' : 'text-foreground-secondary',
                              )}
                            >
                              <span
                                className={cn(
                                  'grid h-5 w-5 shrink-0 place-items-center rounded-md font-semibold tabular-nums',
                                  isActive ? 'bg-foreground text-background' : 'bg-muted text-foreground',
                                )}
                              >
                                {score}
                              </span>
                              <span>{desc}</span>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </div>
                )}

                {questions.length > 0 && (
                  <section className="space-y-2 rounded-lg border border-border px-3 py-3">
                    <h4 className="eyebrow flex items-center gap-1.5">
                      <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                      À vérifier pendant l'entretien
                    </h4>
                    <ol className="space-y-1.5">
                      {questions.slice(0, 3).map((q, qi) => (
                        <li key={qi} className="flex items-start gap-2 text-sm text-foreground">
                          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-muted text-2xs font-semibold tabular-nums text-foreground-secondary">
                            {qi + 1}
                          </span>
                          <span>{q.replace(/^["«]\s*|\s*["»]$/g, '')}</span>
                        </li>
                      ))}
                    </ol>
                  </section>
                )}

                {redFlags.length > 0 && (
                  <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning-muted px-3 py-2.5">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-warning">Point d'alerte</p>
                      <p className="text-sm text-foreground">{redFlags[0]}</p>
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor={ids.notes}>Vos notes sur ce critère</Label>
                  <Textarea
                    id={ids.notes}
                    value={comment}
                    onChange={(e) => onComment(criterion.id, e.target.value)}
                    placeholder="Observations, exemples concrets, citations du candidat…"
                    className="min-h-20 resize-y"
                  />
                </div>
              </div>

              <footer className="flex items-center justify-between gap-2 border-t border-border px-2 py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onCriterionChange(Math.max(0, criterionIdx - 1))}
                  disabled={criterionIdx === 0}
                  className={touch}
                >
                  <ChevronLeft aria-hidden="true" />
                  Précédent
                </Button>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {criterionIdx + 1} / {total}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onCriterionChange(Math.min(total - 1, criterionIdx + 1))}
                  disabled={criterionIdx === total - 1}
                  className={touch}
                >
                  Suivant
                  <ChevronRight aria-hidden="true" />
                </Button>
              </footer>
            </article>
          )}
        </div>

        {assistant && <div className="order-first w-full min-w-0 [@container(min-width:64rem)]:sticky [@container(min-width:64rem)]:top-4 [@container(min-width:64rem)]:order-none [@container(min-width:64rem)]:w-80 [@container(min-width:64rem)]:shrink-0">
          {assistant}
        </div>}
      </div>

      {/* Recommandation finale */}
      <section aria-labelledby={ids.verdict} className="space-y-4 rounded-xl border border-border bg-card p-4">
        <h3 id={ids.verdict} className="text-sm font-semibold text-foreground">Recommandation finale</h3>
        <div className="space-y-2">
          <p id={ids.reco} className="eyebrow">Votre recommandation</p>
          <ToggleGroup
            type="single"
            role="radiogroup"
            aria-labelledby={ids.reco}
            variant="outline"
            value={value.recommendation ?? ''}
            onValueChange={(value) => onRecommendationChange((value || undefined) as ScorecardRecommendation | undefined)}
            className="flex-wrap justify-start gap-2"
          >
            {RECOMMENDATION_KEYS.map((key) => (
              <ToggleGroupItem key={key} value={key} className={cn('max-md:h-11', CHOICE_CLASS)}>
                {HIRING_VERDICTS[key].label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {recommendationFromReport && (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground" aria-hidden="true" />
              Proposée par le compte rendu de l'entretien&nbsp;: vérifiez-la avant de conclure.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={ids.summary}>Résumé et justification</Label>
          <Textarea
            id={ids.summary}
            value={value.summary || ''}
            onChange={(e) => onSummaryChange(e.target.value)}
            placeholder="Ce que vous retenez de l'entretien et ce qui justifie votre recommandation…"
            className="min-h-20 resize-y"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={ids.followUp}>Points de suivi pour le prochain entretien</Label>
          <Textarea
            id={ids.followUp}
            value={value.followUpNotes || ''}
            onChange={(e) => onFollowUpNotesChange(e.target.value)}
            placeholder="Questions à creuser, points à vérifier au prochain entretien…"
            className="min-h-16 resize-y"
          />
        </div>
      </section>

      {children}
    </div>
  );
}
