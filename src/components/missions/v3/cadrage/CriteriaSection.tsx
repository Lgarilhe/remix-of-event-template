// Refonte mission, écran Cadrage : Critères (conception 5.6, un seul modèle).
// Chaque critère : libellé, importance (poids 3, 2, 1) et « Rédhibitoire »,
// enregistrés dans job_details.evaluation_criteria, que la notation lit. Les
// autres champs d'un critère (description, catégorie, niveaux, étape) sont
// gardés tels quels. Un profil déjà noté garde sa note (aucune renotation).
//
// Design simplifié (04/10/2026) : pas de carte, des filets fins entre les
// lignes. L'essentiel d'abord (libellé et importance) ; « Rédhibitoire » et la
// corbeille n'apparaissent qu'au survol, au focus clavier ou sur écran tactile
// (REVEAL_ON_ROW : l'opacité seule change, ils restent dans l'ordre de
// tabulation). Un critère rédhibitoire garde sa case visible : c'est une
// information, pas un réglage.
import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { JobDetails } from '@/types/jobDetails';
import { plural } from '@/lib/plural';
import { cn } from '@/lib/utils';
import { ConfirmDeleteDialog } from '../panels/ConfirmDeleteDialog';
import {
  IMPORTANCE_OPTIONS,
  convertibleSkillCount,
  importanceOfWeight,
  newCriterion,
  skillsToCriteria,
  weightOfImportance,
  type Criterion,
} from './cadrageModel';
import { FieldInput } from './JobSection';
import { SectionHeader } from './SectionHeader';
import { REVEAL_ON_ROW, SECTION_CLASS, TOUCH, useReturnFocus } from './sectionUi';

export interface CriteriaSectionProps {
  jd: JobDetails;
  updateField: (patch: Partial<JobDetails>) => void;
  readOnly: boolean;
}

export function CriteriaSection({ jd, updateField, readOnly }: CriteriaSectionProps) {
  const criteria: Criterion[] = Array.isArray(jd.evaluation_criteria) ? jd.evaluation_criteria : [];
  const [confirm, setConfirm] = useState<{ id: string; label: string } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useReturnFocus();

  // Nouveau critère : le curseur va dans son libellé.
  useEffect(() => {
    if (!focusId) return;
    const input = inputs.current.get(focusId);
    if (input) {
      input.focus();
      setFocusId(null);
    }
  }, [focusId, criteria.length]);

  const write = (next: Criterion[]) => updateField({ evaluation_criteria: next });
  const patch = (id: string, change: Partial<Criterion>) =>
    write(criteria.map((c) => (c.id === id ? { ...c, ...change } : c)));
  const remove = (id: string) => {
    write(criteria.filter((c) => c.id !== id));
    // Le bouton supprimé disparaît : le focus revient à l'ajout.
    window.requestAnimationFrame(() => addButton.current?.focus());
  };
  const add = () => {
    const c = newCriterion(Date.now());
    write([...criteria, c]);
    setFocusId(c.id);
  };

  const skillCount = convertibleSkillCount(jd);

  return (
    <section id="cadrage-criteres" aria-labelledby="cadrage-criteres-titre" className={SECTION_CLASS}>
      <SectionHeader
        id="cadrage-criteres-titre"
        title="Critères"
        help="La notation lit ces critères, avec les compétences et la description du poste. Les profils déjà notés gardent leur note."
      />

      <div className="flex flex-col">
        {criteria.map((c, i) => {
          const name = (c.label ?? '').trim() || 'sans libellé';
          const importance = importanceOfWeight(c.weight);
          const dealBreaker = !!c.deal_breaker;
          return (
            <div
              key={c.id}
              className={cn(
                'group flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-x-4',
                i > 0 && 'border-t border-border',
              )}
            >
              <FieldInput
                ref={(el) => {
                  if (el) inputs.current.set(c.id, el);
                  else inputs.current.delete(c.id);
                }}
                value={c.label ?? ''}
                onChange={(e) => patch(c.id, { label: e.target.value })}
                disabled={readOnly}
                aria-label={`Libellé du critère ${i + 1}`}
                placeholder="Nouveau critère"
                autoComplete="off"
                className="min-w-0 basis-full sm:basis-auto"
              />
              <div role="group" aria-label={`Importance du critère ${name}`} className="inline-flex rounded-lg bg-muted p-0.5">
                {IMPORTANCE_OPTIONS.map((o) => {
                  const pressed = importance === o.value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      aria-pressed={pressed}
                      disabled={readOnly}
                      onClick={() => {
                        if (!pressed) patch(c.id, { weight: weightOfImportance(o.value) });
                      }}
                      className={cn(
                        'h-7 whitespace-nowrap rounded-md px-2.5 text-sm transition-colors duration-150 max-sm:h-11',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        'disabled:cursor-not-allowed',
                        pressed ? 'bg-card font-semibold text-foreground dark:bg-background' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
              <div className="ml-auto flex items-center gap-1 sm:ml-0 sm:min-w-[9.5rem] sm:justify-end">
                {(!readOnly || dealBreaker) && (
                  <label
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md px-1.5 text-sm text-muted-foreground',
                      readOnly && 'cursor-default',
                      TOUCH,
                      dealBreaker ? 'text-foreground' : REVEAL_ON_ROW,
                    )}
                  >
                    <Checkbox
                      checked={dealBreaker}
                      onCheckedChange={(v) => patch(c.id, { deal_breaker: v === true })}
                      disabled={readOnly}
                      aria-label={`Rédhibitoire : ${name}`}
                    />
                    <span aria-hidden="true">Rédhibitoire</span>
                  </label>
                )}
                {!readOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Supprimer le critère ${name}`}
                    onClick={() => {
                      if (!(c.label ?? '').trim()) return remove(c.id);
                      returnFocus.remember();
                      setConfirm({ id: c.id, label: c.label.trim() });
                    }}
                    className={cn('text-muted-foreground hover:text-destructive max-sm:min-h-11 max-sm:min-w-11', REVEAL_ON_ROW)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}

        {criteria.length === 0 && (
          <div className="flex flex-col items-start gap-2 py-2 text-sm text-muted-foreground">
            <p>
              Aucun critère.{' '}
              {skillCount > 0
                ? 'Les profils sont notés sur les compétences du poste (Plus de détails sur le poste, plus bas).'
                : "Sans critère ni compétence, la note d'un profil ne s'appuie que sur la description du poste."}
            </p>
            {!readOnly && skillCount > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => write(skillsToCriteria(jd, Date.now()))}
                className={cn('-ml-3 text-foreground', TOUCH)}
              >
                {skillCount > 1
                  ? `Reprendre les ${plural(skillCount, 'compétence')} comme critères`
                  : 'Reprendre la compétence comme critère'}
              </Button>
            )}
          </div>
        )}

        {!readOnly && (
          <div className={cn('pt-1', criteria.length > 0 && 'border-t border-border')}>
            <Button
              ref={addButton}
              type="button"
              variant="ghost"
              size="sm"
              onClick={add}
              className={cn('-ml-3 mt-1', TOUCH)}
            >
              <Plus aria-hidden="true" />
              Ajouter un critère
            </Button>
          </div>
        )}
      </div>

      <ConfirmDeleteDialog
        open={!!confirm}
        title={confirm ? `Supprimer le critère « ${confirm.label} » ?` : ''}
        // Annuler ou Échap : le focus revient à la corbeille qui a ouvert la fenêtre.
        onCancel={() => {
          setConfirm(null);
          returnFocus.restore();
        }}
        onConfirm={() => {
          returnFocus.forget();
          if (confirm) remove(confirm.id);
          setConfirm(null);
        }}
      />
    </section>
  );
}
