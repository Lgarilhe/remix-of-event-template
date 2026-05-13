/**
 * AiContextSettings — UI pour configurer le contexte IA persistant.
 *
 * 2 niveaux :
 *  - User (chaque user édite le sien) — Mon contexte IA
 *  - Org (admin/owner only) — Contexte IA agence
 *
 * Le contexte sera injecté dans les prompts des appels IA user-facing
 * (génération outreach, suggestions réponses, chat IA, etc.) en Phase 2.
 */

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkles, Building2, User as UserIcon, Plus, X, Info } from 'lucide-react';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import {
  useUserAiContext,
  useOrgAiContext,
  type AiContext,
  type AiContextTone,
  EMPTY_AI_CONTEXT,
} from '@/hooks/useAiContext';
import { useOrganization } from '@/hooks/useOrganization';

const MAX_FREE_TEXT = 1000;
const MAX_SPECIALTY = 200;
const MAX_LIST_ITEM_CHARS = 200;
const MAX_LIST_ITEMS = 10;

const TONE_OPTIONS: { value: AiContextTone; label: string; hint: string }[] = [
  { value: 'tu', label: 'Tutoiement', hint: 'Direct, candidat-friendly (tech, scale-up)' },
  { value: 'vous', label: 'Vouvoiement', hint: 'Plus formel (corporate, profils seniors)' },
  { value: 'casual', label: 'Décontracté', hint: 'Familier, ton "pote" (DTC, startup early)' },
  { value: 'formal', label: 'Formel', hint: 'Soutenu (banque, conseil, secteurs régulés)' },
];

export const AiContextSettings: React.FC = () => {
  const { isAdmin } = useOrganization();

  return (
    <div className="space-y-6">
      <UserContextCard />
      {isAdmin && <OrgContextCard />}
    </div>
  );
};

// ─── User-level card ───────────────────────────────────────────────

const UserContextCard: React.FC = () => {
  const { aiContext, isLoading, save, isSaving } = useUserAiContext();
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            <UserIcon className="w-4 h-4" />
            Mon contexte IA
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Décrivez à l'IA Konekt qui vous êtes, comment vous vous exprimez, vos do/don't.
          Ce contexte est injecté dans toutes les générations IA qui vous représentent
          (messages outreach, suggestions réponses, assistant IA…).
        </p>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <BrutalLoader compact />
          </div>
        ) : (
          <AiContextForm initial={aiContext} onSave={save} isSaving={isSaving} />
        )}
      </CardContent>
    </Card>
  );
};

// ─── Org-level card (admin only) ───────────────────────────────────

const OrgContextCard: React.FC = () => {
  const { aiContext, isLoading, save, isSaving } = useOrgAiContext();
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            <Building2 className="w-4 h-4" />
            Contexte IA agence
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2 rounded-md border border-border bg-muted/20 p-3">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-foreground" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Ce contexte s'applique à <strong>tous les membres</strong> de l'agence
            (voix de marque, secteurs cibles, do/don't communs). Le contexte
            personnel de chaque user vient s'ajouter par-dessus.
          </p>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <BrutalLoader compact />
          </div>
        ) : (
          <AiContextForm initial={aiContext} onSave={save} isSaving={isSaving} scope="org" />
        )}
      </CardContent>
    </Card>
  );
};

// ─── Form shared ───────────────────────────────────────────────────

interface AiContextFormProps {
  initial: AiContext;
  onSave: (next: AiContext) => void;
  isSaving: boolean;
  scope?: 'user' | 'org';
}

const AiContextForm: React.FC<AiContextFormProps> = ({ initial, onSave, isSaving, scope = 'user' }) => {
  const [form, setForm] = useState<AiContext>(initial);
  const [doInput, setDoInput] = useState('');
  const [dontInput, setDontInput] = useState('');

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

  const isDirty = JSON.stringify(form) !== JSON.stringify(initial);

  return (
    <div className="space-y-5">
      {/* Tone */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Ton</Label>
        <Select
          value={form.tone || 'auto'}
          onValueChange={(v) =>
            setForm({ ...form, tone: v === 'auto' ? null : (v as AiContextTone) })
          }
        >
          <SelectTrigger className="h-9 text-sm">
            <SelectValue placeholder="Auto (l'IA décide)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">
              <div>
                <div className="text-sm">Auto</div>
                <div className="text-[10px] text-muted-foreground">L'IA décide selon le contexte</div>
              </div>
            </SelectItem>
            {TONE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                <div>
                  <div className="text-sm">{opt.label}</div>
                  <div className="text-[10px] text-muted-foreground">{opt.hint}</div>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Specialty */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">
          {scope === 'org' ? "Spécialité de l'agence" : 'Ma spécialité'}
        </Label>
        <Input
          value={form.specialty}
          onChange={(e) => setForm({ ...form, specialty: e.target.value.slice(0, MAX_SPECIALTY) })}
          placeholder={
            scope === 'org'
              ? 'Ex: Cabinet tech specialiste scale-ups SaaS FR/EU'
              : 'Ex: Tech recruiter senior, focus IC & lead Dev FR remote'
          }
          className="h-9 text-sm"
          maxLength={MAX_SPECIALTY}
        />
        <p className="text-[10px] text-muted-foreground">
          {form.specialty.length}/{MAX_SPECIALTY}
        </p>
      </div>

      {/* Do list */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">À faire ({form.do.length}/{MAX_LIST_ITEMS})</Label>
        <p className="text-[10px] text-muted-foreground -mt-1">
          Patterns à appliquer systématiquement dans les générations
        </p>
        {form.do.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {form.do.map((item, i) => (
              <div
                key={i}
                className="inline-flex items-start gap-1 px-2 py-1 text-xs rounded-md bg-foreground/5 border border-foreground/15"
              >
                <span className="leading-relaxed">{item}</span>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, do: form.do.filter((_, j) => j !== i) })}
                  className="shrink-0 -mr-0.5 hover:text-destructive transition-colors"
                  aria-label="Supprimer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {form.do.length < MAX_LIST_ITEMS && (
          <div className="flex gap-1.5">
            <Input
              value={doInput}
              onChange={(e) => setDoInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddDo();
                }
              }}
              placeholder="Ex: toujours mentionner la flexibilité remote"
              className="h-8 text-sm"
              maxLength={MAX_LIST_ITEM_CHARS}
            />
            <Button type="button" size="sm" variant="outline" onClick={handleAddDo} className="h-8 gap-1">
              <Plus className="w-3 h-3" />
              Ajouter
            </Button>
          </div>
        )}
      </div>

      {/* Dont list */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">À éviter ({form.dont.length}/{MAX_LIST_ITEMS})</Label>
        <p className="text-[10px] text-muted-foreground -mt-1">
          Formulations ou pratiques à proscrire dans les générations
        </p>
        {form.dont.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {form.dont.map((item, i) => (
              <div
                key={i}
                className="inline-flex items-start gap-1 px-2 py-1 text-xs rounded-md bg-destructive/5 border border-destructive/20"
              >
                <span className="leading-relaxed">{item}</span>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, dont: form.dont.filter((_, j) => j !== i) })}
                  className="shrink-0 -mr-0.5 hover:text-destructive transition-colors"
                  aria-label="Supprimer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {form.dont.length < MAX_LIST_ITEMS && (
          <div className="flex gap-1.5">
            <Input
              value={dontInput}
              onChange={(e) => setDontInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddDont();
                }
              }}
              placeholder="Ex: jamais 'belle opportunité' ou 'défi passionnant'"
              className="h-8 text-sm"
              maxLength={MAX_LIST_ITEM_CHARS}
            />
            <Button type="button" size="sm" variant="outline" onClick={handleAddDont} className="h-8 gap-1">
              <Plus className="w-3 h-3" />
              Ajouter
            </Button>
          </div>
        )}
      </div>

      {/* Free text */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Nuances additionnelles (optionnel)</Label>
        <Textarea
          value={form.free_text}
          onChange={(e) => setForm({ ...form, free_text: e.target.value.slice(0, MAX_FREE_TEXT) })}
          placeholder={
            scope === 'org'
              ? 'Tout ce qui caractérise la voix de l\'agence et ne rentre pas dans les champs ci-dessus.'
              : 'Tout ce qui vous caractérise et ne rentre pas dans les champs ci-dessus (anecdotes, références, style perso…).'
          }
          rows={5}
          className="text-sm leading-relaxed"
          maxLength={MAX_FREE_TEXT}
        />
        <p className="text-[10px] text-muted-foreground">
          {form.free_text.length}/{MAX_FREE_TEXT}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <p className="text-[10px] text-muted-foreground italic">
          {isDirty ? 'Modifications non enregistrées' : 'À jour'}
        </p>
        <div className="flex gap-2">
          {isDirty && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setForm(initial)}
              disabled={isSaving}
            >
              Annuler
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            onClick={() => onSave(form)}
            disabled={!isDirty || isSaving}
            className="gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {isSaving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      </div>
    </div>
  );
};

// Re-export to avoid unused-import warning if not consumed elsewhere
export { EMPTY_AI_CONTEXT };
