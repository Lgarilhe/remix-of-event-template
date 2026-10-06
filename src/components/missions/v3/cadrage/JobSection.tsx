// Refonte mission, écran Cadrage : Le poste (conception 5.6). Intitulé, client,
// contrat, lieu et télétravail, rémunération, contexte, interlocuteur, « Qui
// recrute » en une ligne ; puis « Vos messages » (rôle de l'expéditeur, lien de prise
// de rendez-vous, anonymisation du client) ; « Plus de détails sur le poste »
// (JobMoreDetails) vient en bas de la section, passé par l'écran.
// Tout passe par updateField (une seule instance de useJobDetailsAutosave),
// sauf le lien de rendez-vous, colonne de la mission, enregistré à la sortie
// du champ par onCalendlyCommit.
//
// Design simplifié (04/10/2026) : pas de carte autour de la section, des
// champs qui gardent leur bordure, « Qui recrute » en une ligne (« Préciser »
// ou « Modifier » montre les deux choix, qui se referment une fois choisis).
import { forwardRef, useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { ChevronDown } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, type InputProps } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useOrganization } from '@/hooks/useOrganization';
import type { JobDetails, SenderRole } from '@/types/jobDetails';
import { cn } from '@/lib/utils';
import {
  CONTRACT_OPTIONS,
  RECRUITMENT_MODE_OPTIONS,
  REMOTE_OPTIONS,
  SALARY_TYPE_OPTIONS,
  SENDER_ROLE_OPTIONS,
  anonymizeHelp,
  parseAmount,
  recruitmentModeHelp,
  recruitmentModeLine,
} from './cadrageModel';
import { SectionHeader } from './SectionHeader';
import { SECTION_CLASS, TOUCH_FIELD } from './sectionUi';

// ------------------------------------------------------------ briques de champ

export const FIELD_LABEL_CLASS = 'text-sm text-muted-foreground';

/** Libellé au-dessus du champ ; `htmlFor` relie le libellé au champ principal. */
export function Field({
  label,
  htmlFor,
  className,
  children,
  hint,
}: {
  label: string;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className={FIELD_LABEL_CLASS}>
          {label}
        </label>
      ) : (
        <span className={FIELD_LABEL_CLASS}>{label}</span>
      )}
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

/** Menu natif aux couleurs des champs (clavier et téléphone natifs). */
export function NativeSelect({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <span className={cn('relative block min-w-0', className)}>
      <select
        {...props}
        className={cn(
          'peer h-9 w-full min-w-0 appearance-none rounded-lg border border-input bg-background py-1.5 pl-3 pr-8 text-base text-foreground md:text-sm',
          TOUCH_FIELD,
          'transition-[border-color,box-shadow] duration-150 hover:border-muted-foreground',
          'focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground',
        )}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground peer-disabled:text-muted-foreground"
        aria-hidden="true"
      />
    </span>
  );
}

/** Champ de saisie du Cadrage : le même que partout, 44 px de haut sur téléphone. */
export const FieldInput = forwardRef<HTMLInputElement, InputProps>(function FieldInput({ className, ...props }, ref) {
  return <Input ref={ref} className={cn(TOUCH_FIELD, className)} {...props} />;
});

/**
 * Texte enregistré à la sortie du champ (colonne de la mission, hors job_details).
 * Suit la valeur du serveur tant que le champ n'a pas le focus.
 */
function CommitInput({
  value,
  onCommit,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);
  const commit = () => {
    if (draft.trim() !== value.trim()) onCommit(draft.trim());
  };
  return (
    <FieldInput
      {...props}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

// ------------------------------------------------------------------ section

export interface JobSectionProps {
  jd: JobDetails;
  updateField: (patch: Partial<JobDetails>) => void;
  readOnly: boolean;
  calendlyLink: string;
  onCalendlyCommit: (value: string) => void;
  /** Bas de la section : « Plus de détails sur le poste ». */
  children?: ReactNode;
}

/**
 * Qui recrute, en une ligne. Les deux choix (les seuls que la donnée porte)
 * n'apparaissent que sous « Préciser » ou « Modifier », et se referment une
 * fois l'un choisi ; le focus revient au lien. Même écriture en base qu'avant
 * (outreach_config.recruitment_mode).
 */
function RecruitmentModeLine({
  mode,
  readOnly,
  onChange,
}: {
  mode: unknown;
  readOnly: boolean;
  onChange: (mode: 'internal' | 'client') => void;
}) {
  const { orgType } = useOrganization();
  const uid = useId();
  const [choosing, setChoosing] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const help = recruitmentModeHelp(mode);
  const close = () => {
    setChoosing(false);
    window.requestAnimationFrame(() => trigger.current?.focus());
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-foreground-secondary">
        {recruitmentModeLine(mode, orgType)}
        {!readOnly && (
          <>
            {' '}
            <button
              ref={trigger}
              type="button"
              aria-expanded={choosing}
              aria-controls={`${uid}-choix`}
              onClick={() => setChoosing((v) => !v)}
              className={cn(
                'relative rounded-md px-1 text-brand underline-offset-4 hover:underline',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                // Cible de 44 px sur téléphone sans grossir l'interligne de la phrase.
                'max-sm:before:absolute max-sm:before:-inset-x-2 max-sm:before:-inset-y-3',
              )}
            >
              {mode === 'internal' || mode === 'client' ? 'Modifier' : 'Préciser'}
            </button>
          </>
        )}
      </p>
      {choosing && !readOnly && (
        <div id={`${uid}-choix`} className="flex flex-col gap-2">
          <RadioGroupPrimitive.Root
            aria-label="Qui recrute ?"
            aria-describedby={help ? `${uid}-aide` : undefined}
            value={typeof mode === 'string' ? mode : ''}
            onValueChange={(v) => {
              onChange(v as 'internal' | 'client');
              close();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
            }}
            orientation="horizontal"
            className="flex w-fit max-w-full flex-wrap gap-0.5 rounded-lg bg-muted/60 p-0.5"
          >
            {RECRUITMENT_MODE_OPTIONS.map((o) => (
              <RadioGroupPrimitive.Item
                key={o.value}
                value={o.value}
                className={cn(
                  'inline-flex h-7 items-center whitespace-nowrap rounded-md px-3 text-sm transition-colors duration-150 max-sm:min-h-11',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'text-muted-foreground hover:text-foreground',
                  'data-[state=checked]:bg-background data-[state=checked]:font-semibold data-[state=checked]:text-foreground',
                )}
              >
                {o.label}
              </RadioGroupPrimitive.Item>
            ))}
          </RadioGroupPrimitive.Root>
          {help && (
            <span id={`${uid}-aide`} className="text-sm text-muted-foreground">
              {help}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function JobSection({ jd, updateField, readOnly, calendlyLink, onCalendlyCommit, children }: JobSectionProps) {
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const client = jd.client ?? {};
  const manager = client.hiring_manager ?? {};
  const config = jd.outreach_config ?? {};
  const clientName = (client.name ?? '').trim();
  const anonymize = !!config.anonymize_client;

  const setClient = (change: Partial<NonNullable<JobDetails['client']>>) => updateField({ client: { ...client, ...change } });
  const setManager = (change: Partial<NonNullable<NonNullable<JobDetails['client']>['hiring_manager']>>) =>
    updateField({ client: { ...client, hiring_manager: { ...manager, ...change } } });
  const setConfig = (change: Partial<NonNullable<JobDetails['outreach_config']>>) =>
    updateField({ outreach_config: { ...config, ...change } });

  return (
    <section id="cadrage-poste" aria-labelledby="cadrage-poste-titre" className={SECTION_CLASS}>
      <SectionHeader
        id="cadrage-poste-titre"
        title="Le poste"
        help="Ce que l'IA lit pour chercher, noter et écrire aux candidats."
      />
      <div className="flex flex-col gap-8">
        <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-4">
          <Field label="Intitulé du poste" htmlFor={id('intitule')} className="sm:col-span-2">
            <FieldInput
              id={id('intitule')}
              value={jd.title ?? ''}
              onChange={(e) => updateField({ title: e.target.value })}
              disabled={readOnly}
              autoComplete="off"
            />
          </Field>
          <Field label="Client" htmlFor={id('client')}>
            <FieldInput
              id={id('client')}
              value={client.name ?? ''}
              onChange={(e) => setClient({ name: e.target.value })}
              disabled={readOnly}
              autoComplete="off"
            />
          </Field>
          <Field label="Contrat" htmlFor={id('contrat')}>
            <NativeSelect
              id={id('contrat')}
              value={jd.contract_type ?? ''}
              onChange={(e) => updateField({ contract_type: (e.target.value || undefined) as JobDetails['contract_type'] })}
              disabled={readOnly}
            >
              <option value="">Non précisé</option>
              {CONTRACT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field label="Lieu et télétravail" htmlFor={id('lieu')} className="sm:col-span-2">
            <div className="flex flex-wrap gap-2">
              <FieldInput
                id={id('lieu')}
                value={jd.location ?? ''}
                onChange={(e) => updateField({ location: e.target.value })}
                disabled={readOnly}
                autoComplete="off"
                placeholder="Ville"
                className="min-w-0 flex-[1_1_9rem]"
              />
              <NativeSelect
                aria-label="Télétravail"
                value={jd.remote_policy ?? ''}
                onChange={(e) => updateField({ remote_policy: (e.target.value || undefined) as JobDetails['remote_policy'] })}
                disabled={readOnly}
                className="flex-[1_1_8rem]"
              >
                <option value="">Télétravail non précisé</option>
                {REMOTE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {jd.remote_policy === 'hybrid' && (
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <FieldInput
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={5}
                  aria-label="Jours de télétravail par semaine"
                  value={typeof jd.remote_days === 'number' ? String(jd.remote_days) : ''}
                  onChange={(e) => updateField({ remote_days: parseAmount(e.target.value) })}
                  disabled={readOnly}
                  className="h-8 w-16 tabular-nums"
                />
                jours de télétravail par semaine
              </span>
            )}
          </Field>

          <Field label="Rémunération" htmlFor={id('remu-min')} className="sm:col-span-2">
            <div className="flex flex-wrap items-center gap-2">
              <FieldInput
                id={id('remu-min')}
                type="number"
                inputMode="numeric"
                min={0}
                aria-label="Rémunération minimale"
                placeholder="Minimum"
                value={typeof jd.salary_min === 'number' ? String(jd.salary_min) : ''}
                onChange={(e) => updateField({ salary_min: parseAmount(e.target.value) })}
                disabled={readOnly}
                className="min-w-0 flex-[1_1_6rem] tabular-nums"
              />
              <span className="text-sm text-muted-foreground" aria-hidden="true">
                à
              </span>
              <FieldInput
                type="number"
                inputMode="numeric"
                min={0}
                aria-label="Rémunération maximale"
                placeholder="Maximum"
                value={typeof jd.salary_max === 'number' ? String(jd.salary_max) : ''}
                onChange={(e) => updateField({ salary_max: parseAmount(e.target.value) })}
                disabled={readOnly}
                className="min-w-0 flex-[1_1_6rem] tabular-nums"
              />
              {jd.salary_currency && jd.salary_currency !== 'EUR' && (
                <span className="text-sm text-muted-foreground">{jd.salary_currency}</span>
              )}
              <NativeSelect
                aria-label="Période de la rémunération"
                value={jd.salary_type ?? ''}
                onChange={(e) => updateField({ salary_type: (e.target.value || undefined) as JobDetails['salary_type'] })}
                disabled={readOnly}
                className="flex-[0_1_8rem]"
              >
                <option value="">Période</option>
                {SALARY_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </Field>

          <Field label="Contexte" htmlFor={id('contexte')} className="sm:col-span-2">
            <Textarea
              id={id('contexte')}
              rows={3}
              value={jd.context ?? ''}
              onChange={(e) => updateField({ context: e.target.value })}
              disabled={readOnly}
              className="min-h-0 resize-none"
            />
          </Field>

          <div role="group" aria-labelledby={id('interlocuteur')} className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
            <span id={id('interlocuteur')} className={FIELD_LABEL_CLASS}>
              Interlocuteur chez le client
            </span>
            <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <FieldInput
                aria-label="Nom de l'interlocuteur"
                placeholder="Nom"
                value={manager.name ?? ''}
                onChange={(e) => setManager({ name: e.target.value })}
                disabled={readOnly}
                autoComplete="off"
              />
              <FieldInput
                type="email"
                aria-label="E-mail de l'interlocuteur"
                placeholder="E-mail"
                value={manager.email ?? ''}
                onChange={(e) => setManager({ email: e.target.value })}
                disabled={readOnly}
                autoComplete="off"
              />
            </div>
          </div>
        </div>

        <RecruitmentModeLine
          mode={config.recruitment_mode}
          readOnly={readOnly}
          onChange={(mode) => setConfig({ recruitment_mode: mode })}
        />

        {/* Vos messages : ce que la rédaction des messages lit (outreach_config, calendly_link). */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-md font-semibold text-foreground">Vos messages</h3>
            <p className="text-sm text-muted-foreground">L'IA s'en sert pour rédiger les messages de cette mission.</p>
          </div>
          <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-4">
            <Field label="Rôle de l'expéditeur" htmlFor={id('role')} className="sm:col-span-2">
              <NativeSelect
                id={id('role')}
                value={config.sender_role ?? ''}
                onChange={(e) => setConfig({ sender_role: (e.target.value || undefined) as SenderRole | undefined })}
                disabled={readOnly}
              >
                <option value="">Non précisé</option>
                {SENDER_ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Lien de prise de rendez-vous" htmlFor={id('rdv')} className="sm:col-span-2">
              <CommitInput
                id={id('rdv')}
                type="url"
                inputMode="url"
                placeholder="https://"
                value={calendlyLink}
                onCommit={onCalendlyCommit}
                disabled={readOnly}
                autoComplete="off"
              />
            </Field>
          </div>
          <div className="flex items-start gap-2.5">
            <Checkbox
              id={id('anon')}
              checked={anonymize}
              onCheckedChange={(v) => setConfig({ anonymize_client: v === true })}
              disabled={readOnly || (!clientName && !anonymize)}
              aria-describedby={id('anon-aide')}
              className="mt-0.5 max-sm:mt-3.5"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <label htmlFor={id('anon')} className="cursor-pointer text-sm text-foreground max-sm:py-3">
                Anonymiser le client
              </label>
              <span id={id('anon-aide')} className="text-sm text-muted-foreground">
                {anonymizeHelp(anonymize, config.anonymized_alias, client.name)}
              </span>
              {anonymize && (
                <div className="mt-1.5 flex max-w-md flex-col gap-1.5">
                  <label htmlFor={id('alias')} className={FIELD_LABEL_CLASS}>
                    Nom utilisé à la place du client
                  </label>
                  <FieldInput
                    id={id('alias')}
                    value={config.anonymized_alias ?? ''}
                    onChange={(e) => setConfig({ anonymized_alias: e.target.value })}
                    disabled={readOnly}
                    placeholder="Par exemple : un groupe industriel familial"
                    autoComplete="off"
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {children}
      </div>
    </section>
  );
}
