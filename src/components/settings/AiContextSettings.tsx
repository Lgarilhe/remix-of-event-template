/**
 * AiContextSettings — cartes du contexte IA persistant, montées séparément
 * par les rubriques des Paramètres (src/components/settings/shell/sections.tsx) :
 *  - UserContextCard (chaque user édite le sien) — « Vos consignes de rédaction »,
 *    dans Mon compte › Rédaction (#vos-consignes, sous « Votre style ») ;
 *  - OrgContextCard (propriétaire et admin) — « Consignes de l’organisation »,
 *    dans Mon organisation › Règles de l’assistant (#consignes).
 *
 * Lecture ratée : bloc d'erreur à la place du formulaire. Un formulaire vide
 * enregistré par-dessus écraserait le contexte existant.
 *
 * Le contexte sera injecté dans les prompts des appels IA user-facing
 * (génération outreach, suggestions réponses, chat IA, etc.) en Phase 2.
 *
 * Lot 12 du chantier design : un seul nom, « l’assistant », et « organisation »
 * (F-20) ; libellés reliés à leur champ (F-15) ; ton affiché par son libellé
 * seul (F-17) ; « Enregistrer » et état d'enregistrement, sans étincelle (F-09,
 * F-22) ; squelette au chargement (F-66).
 */

import React, { useEffect, useId, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { SaveStatus, type SaveState } from '@/components/ui/save-status';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, User as UserIcon, Plus, X } from 'lucide-react';
import { ErrorBox } from '@/components/layout/ErrorBox';
import {
  useUserAiContext,
  useOrgAiContext,
  type AiContext,
  type AiContextTone,
} from '@/hooks/useAiContext';

const MAX_FREE_TEXT = 1000;
const MAX_SPECIALTY = 200;
const MAX_LIST_ITEM_CHARS = 200;
const MAX_LIST_ITEMS = 10;

/**
 * Tons proposés : le libellé seul dans le champ, l'aide sous le champ (F-17).
 * Lot 5e-2 : plus de choix « Tutoiement » (les messages d'approche vouvoient
 * toujours, et leur style se règle dans « Votre style ») ; une valeur `tu` déjà
 * enregistrée reste lisible (option ajoutée seulement pour elle) et vaut pour
 * la messagerie et l'assistant.
 */
const TONE_OPTIONS: { value: AiContextTone | 'auto'; label: string; hint: string }[] = [
  { value: 'auto', label: 'Automatique', hint: 'L’assistant choisit le ton selon le contexte.' },
  { value: 'vous', label: 'Vouvoiement', hint: 'Plus formel : grands groupes, profils seniors.' },
  { value: 'casual', label: 'Décontracté', hint: 'Familier et chaleureux : jeunes marques, start-up.' },
  { value: 'formal', label: 'Formel', hint: 'Soutenu : banque, conseil, secteurs réglementés.' },
];
/** Ancienne valeur, plus proposée : montrée seulement quand elle est enregistrée. */
const LEGACY_TU_OPTION = { value: 'tu' as const, label: 'Tutoiement', hint: 'Ancien réglage, gardé pour la messagerie et l’assistant. Les messages d’approche vouvoient toujours.' };

/** Chargement d'une carte : la forme du formulaire, jamais un indicateur décoratif (F-66). */
function ContextSkeleton() {
  return (
    <div role="status" className="space-y-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-1.5" aria-hidden="true">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
      <span className="sr-only">Chargement des consignes…</span>
    </div>
  );
}

// ─── User-level card ───────────────────────────────────────────────

export const UserContextCard: React.FC = () => {
  const { aiContext, isLoading, isError, refetch, save, isSaving } = useUserAiContext();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <UserIcon className="h-4 w-4" aria-hidden="true" />
          Vos consignes de rédaction
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Dites à l’assistant qui vous êtes, comment vous écrivez, ce qu’il doit faire et éviter.
          Ces consignes s’appliquent à tout ce qu’il rédige en votre nom : messages d’approche,
          suggestions de réponse, conversations avec l’assistant. Le ton des messages d’approche se règle
          dans « Votre style », ci-dessus.
        </p>
        {isLoading ? (
          <ContextSkeleton />
        ) : isError ? (
          <ErrorBox
            title="Impossible de charger vos consignes de rédaction."
            detail="Vos consignes enregistrées ne sont pas affectées. Réessayez pour les afficher et les modifier."
            onRetry={() => { void refetch(); }}
          />
        ) : (
          <AiContextForm initial={aiContext} onSave={save} isSaving={isSaving} />
        )}
      </CardContent>
    </Card>
  );
};

// ─── Org-level card (admin only) ───────────────────────────────────

export const OrgContextCard: React.FC = () => {
  const { aiContext, isLoading, isError, refetch, save, isSaving } = useOrgAiContext();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Building2 className="h-4 w-4" aria-hidden="true" />
          Consignes de l’organisation
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Ces consignes s’appliquent à <strong className="font-medium text-foreground">tous les membres</strong> de
          l’organisation : ton de la marque, secteurs visés, ce que l’assistant fait et évite. Les consignes
          personnelles de chaque membre s’y ajoutent.
        </p>
        {isLoading ? (
          <ContextSkeleton />
        ) : isError ? (
          <ErrorBox
            title="Impossible de charger les consignes de l’organisation."
            detail="Vos consignes enregistrées ne sont pas affectées. Réessayez pour les afficher et les modifier."
            onRetry={() => { void refetch(); }}
          />
        ) : (
          <AiContextForm initial={aiContext} onSave={save} isSaving={isSaving} scope="org" />
        )}
      </CardContent>
    </Card>
  );
};

// ─── Form shared ───────────────────────────────────────────────────

interface SaveCallbacks {
  onSuccess?: () => void;
  onError?: () => void;
}

interface AiContextFormProps {
  initial: AiContext;
  /** Mutation du hook : les rappels par appel disent si l'enregistrement a réussi. */
  onSave: (next: AiContext, callbacks?: SaveCallbacks) => void;
  isSaving: boolean;
  scope?: 'user' | 'org';
}

const AiContextForm: React.FC<AiContextFormProps> = ({ initial, onSave, isSaving, scope = 'user' }) => {
  const [form, setForm] = useState<AiContext>(initial);
  const [doInput, setDoInput] = useState('');
  const [dontInput, setDontInput] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);
  const uid = useId();
  const ids = {
    tone: `${uid}-ton`,
    toneHint: `${uid}-ton-aide`,
    specialty: `${uid}-specialite`,
    specialtyCount: `${uid}-specialite-compte`,
    doInput: `${uid}-a-faire`,
    doHint: `${uid}-a-faire-aide`,
    dontInput: `${uid}-a-eviter`,
    dontHint: `${uid}-a-eviter-aide`,
    freeText: `${uid}-precisions`,
    freeTextCount: `${uid}-precisions-compte`,
  };

  // Resync si le hook recharge (ex: après save d'une autre source)
  useEffect(() => {
    setForm(initial);
  }, [initial]);

  const handleAddDo = () => {
    const v = doInput.trim().slice(0, MAX_LIST_ITEM_CHARS);
    if (!v || form.do.length >= MAX_LIST_ITEMS) return;
    setForm({ ...form, do: [...form.do, v] });
    setDoInput('');
  };
  const handleAddDont = () => {
    const v = dontInput.trim().slice(0, MAX_LIST_ITEM_CHARS);
    if (!v || form.dont.length >= MAX_LIST_ITEMS) return;
    setForm({ ...form, dont: [...form.dont, v] });
    setDontInput('');
  };

  const handleSave = () => {
    setSaveFailed(false);
    onSave(form, { onError: () => setSaveFailed(true) });
  };

  const isDirty = JSON.stringify(form) !== JSON.stringify(initial);
  const saveState: SaveState = isSaving ? 'saving' : saveFailed ? 'error' : isDirty ? 'unsaved' : 'saved';
  const toneOptions = initial.tone === 'tu' || form.tone === 'tu' ? [...TONE_OPTIONS, LEGACY_TU_OPTION] : TONE_OPTIONS;
  const tone = toneOptions.find((opt) => opt.value === (form.tone || 'auto')) ?? toneOptions[0];

  return (
    <div className="space-y-5">
      {/* Tone */}
      <div className="space-y-1.5">
        {/* Lot 5e-2 : les messages d'approche suivent « Votre style » (ce ton n'y est pas appliqué). */}
        <Label htmlFor={ids.tone} className="text-xs font-medium">Ton de la messagerie et de l’assistant</Label>
        <Select
          value={form.tone || 'auto'}
          onValueChange={(v) =>
            setForm({ ...form, tone: v === 'auto' ? null : (v as AiContextTone) })
          }
        >
          <SelectTrigger id={ids.tone} aria-describedby={ids.toneHint} className="max-md:h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {toneOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p id={ids.toneHint} className="text-xs text-muted-foreground">{tone.hint}</p>
      </div>

      {/* Specialty */}
      <div className="space-y-1.5">
        <Label htmlFor={ids.specialty} className="text-xs font-medium">
          {scope === 'org' ? 'Spécialité de l’organisation' : 'Votre spécialité'}
        </Label>
        <Input
          id={ids.specialty}
          className="max-md:h-11"
          value={form.specialty}
          onChange={(e) => setForm({ ...form, specialty: e.target.value.slice(0, MAX_SPECIALTY) })}
          placeholder={
            scope === 'org'
              ? 'Ex. : cabinet spécialisé dans les éditeurs de logiciels en France et en Europe'
              : 'Ex. : recrutement tech, développeurs confirmés et responsables techniques en télétravail'
          }
          maxLength={MAX_SPECIALTY}
          aria-describedby={form.specialty.length > 0 ? ids.specialtyCount : undefined}
        />
        {/* Design simplifié (règle 8) : le compteur apparaît dès le premier caractère, jamais « 0/200 ». */}
        {form.specialty.length > 0 && (
          <p id={ids.specialtyCount} className="text-xs tabular-nums text-muted-foreground">
            {form.specialty.length}/{MAX_SPECIALTY}
          </p>
        )}
      </div>

      <ContextList
        label="À faire"
        hint="Ce que l’assistant applique à chaque rédaction."
        items={form.do}
        inputId={ids.doInput}
        hintId={ids.doHint}
        inputValue={doInput}
        onInputChange={setDoInput}
        onAdd={handleAddDo}
        onRemove={(i) => setForm({ ...form, do: form.do.filter((_, j) => j !== i) })}
        placeholder="Ex. : toujours mentionner le télétravail possible"
      />

      <ContextList
        label="À éviter"
        hint="Formulations ou pratiques que l’assistant n’emploie jamais."
        items={form.dont}
        inputId={ids.dontInput}
        hintId={ids.dontHint}
        inputValue={dontInput}
        onInputChange={setDontInput}
        onAdd={handleAddDont}
        onRemove={(i) => setForm({ ...form, dont: form.dont.filter((_, j) => j !== i) })}
        placeholder="Ex. : jamais « belle opportunité » ni « défi passionnant »"
      />

      {/* Free text */}
      <div className="space-y-1.5">
        <Label htmlFor={ids.freeText} className="text-xs font-medium">Précisions (facultatif)</Label>
        <Textarea
          id={ids.freeText}
          value={form.free_text}
          onChange={(e) => setForm({ ...form, free_text: e.target.value.slice(0, MAX_FREE_TEXT) })}
          placeholder={
            scope === 'org'
              ? 'Tout ce qui caractérise la voix de l’organisation et n’entre pas dans les champs ci-dessus.'
              : 'Tout ce qui vous caractérise et n’entre pas dans les champs ci-dessus (anecdotes, références, style personnel…).'
          }
          rows={5}
          className="text-sm leading-relaxed"
          maxLength={MAX_FREE_TEXT}
          aria-describedby={form.free_text.length > 0 ? ids.freeTextCount : undefined}
        />
        {form.free_text.length > 0 && (
          <p id={ids.freeTextCount} className="text-xs tabular-nums text-muted-foreground">
            {form.free_text.length}/{MAX_FREE_TEXT}
          </p>
        )}
      </div>

      {/* Actions : « Enregistrer » et l'état d'enregistrement (F-09) */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <SaveStatus state={saveState} />
        <div className="flex gap-2">
          {isDirty && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { setForm(initial); setSaveFailed(false); }}
              disabled={isSaving}
              className="max-md:h-11"
            >
              Annuler
            </Button>
          )}
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleSave}
            loading={isSaving}
            disabled={!isDirty}
            className="max-md:h-11"
          >
            Enregistrer
          </Button>
        </div>
      </div>
    </div>
  );
};

interface ContextListProps {
  label: string;
  hint: string;
  items: string[];
  inputId: string;
  hintId: string;
  inputValue: string;
  onInputChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  placeholder: string;
}

/** Liste « À faire » ou « À éviter » : une consigne par ligne, retirée par un bouton nommé. */
function ContextList({
  label, hint, items, inputId, hintId, inputValue, onInputChange, onAdd, onRemove, placeholder,
}: ContextListProps) {
  const full = items.length >= MAX_LIST_ITEMS;
  return (
    <div className="space-y-1.5">
      {/* Le nombre de consignes seulement quand la liste en compte (règle 8). */}
      <Label htmlFor={inputId} className="text-xs font-medium">
        {label}
        {items.length > 0 && <span className="tabular-nums text-muted-foreground"> ({items.length}/{MAX_LIST_ITEMS})</span>}
      </Label>
      <p id={hintId} className="text-xs text-muted-foreground">{hint}</p>
      {items.length > 0 && (
        <ul className="space-y-1" aria-label={label}>
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 rounded-md bg-muted py-1 pl-2.5 pr-1 text-sm text-foreground">
              <span className="min-w-0 flex-1 break-words py-0.5 leading-relaxed">{item}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => onRemove(i)}
                    className="shrink-0 text-muted-foreground hover:text-foreground max-md:h-11 max-md:w-11"
                    aria-label={`Retirer « ${item} »`}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Retirer</TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
      {/* Champ toujours présent (le libellé reste relié) ; grisé une fois la liste pleine. */}
      <div className="flex gap-2">
        <Input
          id={inputId}
          className="max-md:h-11"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onAdd();
            }
          }}
          placeholder={full ? 'Maximum atteint : retirez une consigne pour en ajouter une.' : placeholder}
          maxLength={MAX_LIST_ITEM_CHARS}
          disabled={full}
          aria-describedby={hintId}
        />
        <Button type="button" variant="outline" onClick={onAdd} disabled={full} className="shrink-0 max-md:h-11">
          <Plus aria-hidden="true" />
          Ajouter
        </Button>
      </div>
    </div>
  );
}
