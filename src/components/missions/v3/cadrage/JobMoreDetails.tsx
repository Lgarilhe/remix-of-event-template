// Refonte mission, écran Cadrage : « Plus de détails sur le poste », replié.
// Les champs du poste que la maquette ne montre pas mais que du code lit
// encore (poste de la recherche, notation, messages) : rien n'est rendu
// inaccessible. Référence interne, urgence et transcription de la dictée ne
// sont plus affichées (aucun lecteur) ; leurs données restent en base.
// Design simplifié (04/10/2026) : ni filet ni cadre autour du lien de dépli,
// des mots sans bordure, des cibles de 44 px sur téléphone.
import { useId, useState, type KeyboardEvent } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Textarea } from '@/components/ui/textarea';
import type { JobDetails } from '@/types/jobDetails';
import { cn } from '@/lib/utils';
import { CLIENT_SIZE_OPTIONS, parseAmount } from './cadrageModel';
import { FIELD_LABEL_CLASS, Field, FieldInput, NativeSelect } from './JobSection';
import { TOUCH } from './sectionUi';

/** Liste de mots (compétences, certifications) : Entrée ajoute, la croix retire. */
function TagsField({
  label,
  values,
  onChange,
  readOnly,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  readOnly: boolean;
  placeholder: string;
}) {
  const inputId = useId();
  const [draft, setDraft] = useState('');
  const add = () => {
    const t = draft.trim();
    setDraft('');
    if (!t || values.some((v) => v.toLowerCase() === t.toLowerCase())) return;
    onChange([...values, t]);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {readOnly ? (
        <span className={FIELD_LABEL_CLASS}>{label}</span>
      ) : (
        <label htmlFor={inputId} className={FIELD_LABEL_CLASS}>
          {label}
        </label>
      )}
      <div className="flex flex-wrap items-center gap-1.5 empty:hidden">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted py-0.5 pl-3 pr-1 text-sm text-foreground"
          >
            <span className="truncate">{v}</span>
            {!readOnly && (
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                aria-label={`Retirer ${v}`}
                className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:h-8 max-sm:w-8"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
          </span>
        ))}
        {values.length === 0 && readOnly && <span className="text-sm text-muted-foreground">Aucune</span>}
      </div>
      {!readOnly && (
        <FieldInput
          id={inputId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={add}
          placeholder={placeholder}
          autoComplete="off"
          className="h-8"
        />
      )}
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  readOnly,
  id,
  label,
}: {
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  readOnly: boolean;
  id?: string;
  label?: string;
}) {
  return (
    <FieldInput
      id={id}
      aria-label={label}
      type="number"
      inputMode="numeric"
      min={0}
      value={typeof value === 'number' ? String(value) : ''}
      onChange={(e) => onChange(parseAmount(e.target.value))}
      disabled={readOnly}
      className="tabular-nums"
    />
  );
}

export interface JobMoreDetailsProps {
  jd: JobDetails;
  updateField: (patch: Partial<JobDetails>) => void;
  readOnly: boolean;
}

export function JobMoreDetails({ jd, updateField, readOnly }: JobMoreDetailsProps) {
  const [open, setOpen] = useState(false);
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const client = jd.client ?? {};
  const languages = Array.isArray(jd.languages) ? jd.languages : [];
  const setClient = (change: Partial<NonNullable<JobDetails['client']>>) => updateField({ client: { ...client, ...change } });
  const setLanguage = (i: number, change: Partial<{ language: string; level: string }>) =>
    updateField({ languages: languages.map((l, j) => (j === i ? { ...l, ...change } : l)) });

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className={cn(
          'group -ml-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm font-medium text-muted-foreground',
          'hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          TOUCH,
        )}
      >
        Plus de détails sur le poste
        <ChevronDown
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-4">
        <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-4">
          <Field
            label="Description des missions"
            htmlFor={id('missions')}
            className="sm:col-span-4"
            hint="Reprise dans le poste de la recherche et dans la notation des profils."
          >
            <Textarea
              id={id('missions')}
              rows={4}
              value={jd.mission_description ?? ''}
              onChange={(e) => updateField({ mission_description: e.target.value })}
              disabled={readOnly}
              className="resize-y"
            />
          </Field>
          <Field
            label="Description libre"
            htmlFor={id('libre')}
            className="sm:col-span-4"
            hint="Texte de la dictée, ou collé. Il sert à la notation des profils."
          >
            <Textarea
              id={id('libre')}
              rows={3}
              value={jd.raw_brief ?? ''}
              onChange={(e) => updateField({ raw_brief: e.target.value })}
              disabled={readOnly}
              className="resize-y"
            />
          </Field>

          <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:col-span-4 sm:grid-cols-2">
            <TagsField
              label="Compétences indispensables"
              values={jd.skills_must_have ?? []}
              onChange={(v) => updateField({ skills_must_have: v })}
              readOnly={readOnly}
              placeholder="Ajouter, puis Entrée"
            />
            <TagsField
              label="Compétences souhaitées"
              values={jd.skills_should_have ?? []}
              onChange={(v) => updateField({ skills_should_have: v })}
              readOnly={readOnly}
              placeholder="Ajouter, puis Entrée"
            />
            <TagsField
              label="Compétences bonus"
              values={jd.skills_nice_to_have ?? []}
              onChange={(v) => updateField({ skills_nice_to_have: v })}
              readOnly={readOnly}
              placeholder="Ajouter, puis Entrée"
            />
            <TagsField
              label="Compétences à éviter"
              values={jd.skills_to_avoid ?? []}
              onChange={(v) => updateField({ skills_to_avoid: v })}
              readOnly={readOnly}
              placeholder="Ajouter, puis Entrée"
            />
          </div>

          <Field label="Séniorité" htmlFor={id('seniorite')} className="sm:col-span-2">
            <FieldInput
              id={id('seniorite')}
              value={jd.seniority ?? ''}
              onChange={(e) => updateField({ seniority: e.target.value })}
              disabled={readOnly}
              autoComplete="off"
            />
          </Field>
          <Field label="Expérience minimale (ans)" htmlFor={id('exp-min')}>
            <NumberInput
              id={id('exp-min')}
              value={jd.experience_min}
              onChange={(v) => updateField({ experience_min: v })}
              readOnly={readOnly}
            />
          </Field>
          <Field label="Expérience maximale (ans)" htmlFor={id('exp-max')}>
            <NumberInput
              id={id('exp-max')}
              value={jd.experience_max}
              onChange={(v) => updateField({ experience_max: v })}
              readOnly={readOnly}
            />
          </Field>

          <div role="group" aria-labelledby={id('langues')} className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
            <span id={id('langues')} className={FIELD_LABEL_CLASS}>
              Langues
            </span>
            {languages.length === 0 && <span className="text-sm text-muted-foreground">Aucune langue demandée.</span>}
            {languages.map((l, i) => (
              <div key={i} className="flex gap-2">
                <FieldInput
                  aria-label={`Langue ${i + 1}`}
                  placeholder="Langue"
                  value={l?.language ?? ''}
                  onChange={(e) => setLanguage(i, { language: e.target.value })}
                  disabled={readOnly}
                  autoComplete="off"
                  className="min-w-0 flex-1"
                />
                <FieldInput
                  aria-label={`Niveau de la langue ${i + 1}`}
                  placeholder="Niveau"
                  value={l?.level ?? ''}
                  onChange={(e) => setLanguage(i, { level: e.target.value })}
                  disabled={readOnly}
                  autoComplete="off"
                  className="min-w-0 flex-1"
                />
                {!readOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Retirer la langue ${i + 1}`}
                    onClick={() => updateField({ languages: languages.filter((_, j) => j !== i) })}
                    className="shrink-0 text-muted-foreground hover:text-destructive max-sm:min-h-11 max-sm:min-w-11"
                  >
                    <X aria-hidden="true" />
                  </Button>
                )}
              </div>
            ))}
            {!readOnly && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => updateField({ languages: [...languages, { language: '', level: '' }] })}
                className={cn('-ml-3 self-start text-muted-foreground hover:text-foreground', TOUCH)}
              >
                <Plus aria-hidden="true" />
                Ajouter une langue
              </Button>
            )}
          </div>
          <div className="sm:col-span-2">
            <TagsField
              label="Certifications"
              values={jd.certifications ?? []}
              onChange={(v) => updateField({ certifications: v })}
              readOnly={readOnly}
              placeholder="Ajouter, puis Entrée"
            />
          </div>

          <Field label="Avantages" htmlFor={id('avantages')} className="sm:col-span-2">
            <FieldInput
              id={id('avantages')}
              value={jd.benefits ?? ''}
              onChange={(e) => updateField({ benefits: e.target.value })}
              disabled={readOnly}
              autoComplete="off"
            />
          </Field>
          <Field label="Participation au capital" htmlFor={id('capital')}>
            <FieldInput
              id={id('capital')}
              value={jd.equity ?? ''}
              onChange={(e) => updateField({ equity: e.target.value })}
              disabled={readOnly}
              autoComplete="off"
            />
          </Field>
          <Field label="Date de démarrage" htmlFor={id('demarrage')}>
            <FieldInput
              id={id('demarrage')}
              value={jd.start_date ?? ''}
              onChange={(e) => updateField({ start_date: e.target.value })}
              disabled={readOnly}
              autoComplete="off"
            />
          </Field>

          <Field label="Secteur du client" htmlFor={id('secteur')}>
            <FieldInput
              id={id('secteur')}
              value={client.sector ?? ''}
              onChange={(e) => setClient({ sector: e.target.value })}
              disabled={readOnly}
              autoComplete="off"
            />
          </Field>
          <Field label="Taille du client" htmlFor={id('taille')}>
            <NativeSelect
              id={id('taille')}
              value={client.size ?? ''}
              onChange={(e) =>
                setClient({ size: (e.target.value || undefined) as NonNullable<JobDetails['client']>['size'] })
              }
              disabled={readOnly}
            >
              <option value="">Non précisée</option>
              {CLIENT_SIZE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Site du client" htmlFor={id('site')} className="sm:col-span-2">
            <FieldInput
              id={id('site')}
              type="url"
              inputMode="url"
              placeholder="https://"
              value={client.website ?? ''}
              onChange={(e) => setClient({ website: e.target.value })}
              disabled={readOnly}
              autoComplete="off"
            />
          </Field>
          <Field label="Culture du client" htmlFor={id('culture')} className="sm:col-span-4">
            <Textarea
              id={id('culture')}
              rows={2}
              value={client.culture_notes ?? ''}
              onChange={(e) => setClient({ culture_notes: e.target.value })}
              disabled={readOnly}
              className="min-h-0 resize-y"
            />
          </Field>

          <Field label="Rattachement" htmlFor={id('rattachement')} className="sm:col-span-2">
            <FieldInput
              id={id('rattachement')}
              value={jd.reports_to ?? ''}
              onChange={(e) => updateField({ reports_to: e.target.value })}
              disabled={readOnly}
              autoComplete="off"
            />
          </Field>
          <Field label="Taille de l'équipe" htmlFor={id('equipe')}>
            <NumberInput
              id={id('equipe')}
              value={jd.team_size}
              onChange={(v) => updateField({ team_size: v })}
              readOnly={readOnly}
            />
          </Field>
          <Field label="Personnes managées" htmlFor={id('manages')}>
            <NumberInput
              id={id('manages')}
              value={jd.manages}
              onChange={(v) => updateField({ manages: v })}
              readOnly={readOnly}
            />
          </Field>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
