// Refonte mission, écran Cadrage : Critères (conception 5.6, un seul modèle).
// Chaque critère : libellé, importance (poids 3, 2, 1) et « Rédhibitoire »,
// enregistrés dans job_details.evaluation_criteria, que la notation lit. Les
// autres champs d'un critère (description, catégorie, niveaux, étape) sont
// gardés tels quels. Un profil déjà noté garde sa note (aucune renotation).
import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
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
    <section id="cadrage-criteres" aria-labelledby="cadrage-criteres-titre" className="flex scroll-mt-4 flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h2 id="cadrage-criteres-titre" className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          Critères
        </h2>
        <span className="text-xs text-muted-foreground">
          La notation lit ces critères, avec les compétences et la description du poste. Les profils déjà notés gardent leur note.
        </span>
      </div>

      <div className="flex flex-col rounded-xl border border-border bg-card px-4 py-1">
        {criteria.map((c, i) => {
          const name = (c.label ?? '').trim() || 'sans libellé';
          const importance = importanceOfWeight(c.weight);
          const dealId = `cadrage-critere-${c.id}-redhibitoire`;
          return (
            <div
              key={c.id}
              className={cn(
                'flex flex-wrap items-center gap-x-3.5 gap-y-2 py-1.5 sm:grid sm:min-h-11 sm:grid-cols-[minmax(0,1fr)_auto_auto_32px]',
                i > 0 && 'border-t border-border',
              )}
            >
              <Input
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
                className="h-[34px] min-w-0 basis-full sm:basis-auto"
              />
              <div
                role="group"
                aria-label={`Importance du critère ${name}`}
                className="flex rounded-lg border border-border bg-background p-0.5"
              >
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
                        'h-7 whitespace-nowrap rounded-md px-2.5 text-xs transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        'disabled:cursor-not-allowed',
                        pressed ? 'bg-accent font-semibold text-foreground' : 'font-medium text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id={dealId}
                  checked={!!c.deal_breaker}
                  onCheckedChange={(v) => patch(c.id, { deal_breaker: v === true })}
                  disabled={readOnly}
                  aria-label={`Rédhibitoire : ${name}`}
                />
                <label htmlFor={dealId} className="cursor-pointer whitespace-nowrap text-xs text-muted-foreground" aria-hidden="true">
                  Rédhibitoire
                </label>
              </div>
              {readOnly ? (
                <span className="hidden sm:block" aria-hidden="true" />
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Supprimer le critère ${name}`}
                  onClick={() => ((c.label ?? '').trim() ? setConfirm({ id: c.id, label: c.label.trim() }) : remove(c.id))}
                  className="ml-auto text-muted-foreground hover:text-destructive sm:ml-0"
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              )}
            </div>
          );
        })}

        {criteria.length === 0 && (
          <div className="flex flex-col items-start gap-2 py-4 text-sm text-muted-foreground">
            <p>
              Aucun critère.{' '}
              {skillCount > 0
                ? 'Les profils sont notés sur les compétences du poste (Plus de détails sur le poste, plus bas).'
                : "Sans critère ni compétence, la note d'un profil ne s'appuie que sur la description du poste."}
            </p>
            {!readOnly && skillCount > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => write(skillsToCriteria(jd, Date.now()))}
              >
                {skillCount > 1
                  ? `Reprendre les ${plural(skillCount, 'compétence')} comme critères`
                  : 'Reprendre la compétence comme critère'}
              </Button>
            )}
          </div>
        )}

        {!readOnly && (
          <div className={cn('py-1', criteria.length > 0 && 'border-t border-border')}>
            <Button
              ref={addButton}
              type="button"
              variant="ghost"
              size="sm"
              onClick={add}
              className="-ml-2.5 text-muted-foreground hover:text-foreground"
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
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) remove(confirm.id);
          setConfirm(null);
        }}
      />
    </section>
  );
}
