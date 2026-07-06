import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, GraduationCap, Loader2, Plus, Target, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { PedigreeRequirements, SeniorityLevel } from '@/types/pedigreePreset';

/**
 * SceneIcp — étape onboarding « Votre candidat idéal ».
 *
 * Crée le premier ICP société (client_pedigree_presets) : consommé par le
 * scoring IA (bloc « priorité absolue » du prompt de score-profile-job) et
 * par les filtres de recherche. Rempli ici, le tri des candidats est calibré
 * dès la première recherche au lieu d'être générique. Entièrement passable.
 */

interface Props {
  orgId: string | null;
  onNext: () => void;
  onBack: () => void;
}

const SENIORITY_OPTIONS: { value: SeniorityLevel; label: string }[] = [
  { value: 'junior', label: 'Junior' },
  { value: 'mid', label: 'Confirmé' },
  { value: 'senior', label: 'Senior' },
  { value: 'lead', label: 'Lead+' },
];

/** Champ à puces : tape + Entrée → chip animée. */
const ChipsInput: React.FC<{
  icon: React.ReactNode;
  label: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
}> = ({ icon, label, placeholder, values, onChange }) => {
  const [draft, setDraft] = useState('');

  const add = () => {
    const v = draft.trim();
    if (!v || values.some((x) => x.toLowerCase() === v.toLowerCase())) { setDraft(''); return; }
    onChange([...values, v]);
    setDraft('');
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        {icon} {label}
      </p>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={placeholder}
          className="text-sm h-9 rounded-xl"
        />
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={!draft.trim()} className="h-9 w-9 p-0 shrink-0">
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <AnimatePresence>
            {values.map((v) => (
              <motion.span
                key={v}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className="inline-flex items-center gap-1 rounded-full bg-foreground/[0.08] px-2.5 py-1 text-xs font-medium"
              >
                {v}
                <button onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Retirer ${v}`} className="text-muted-foreground hover:text-foreground">
                  <X className="w-3 h-3" />
                </button>
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};

export const SceneIcp: React.FC<Props> = ({ orgId, onNext, onBack }) => {
  const [schools, setSchools] = useState<string[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [seniority, setSeniority] = useState<SeniorityLevel | null>(null);
  const [strict, setStrict] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [saving, setSaving] = useState(false);

  const hasContent = schools.length > 0 || companies.length > 0 || !!seniority || strict || !!instructions.trim();

  const handleSave = async () => {
    if (!hasContent || !orgId) { onNext(); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');

      const requirements: PedigreeRequirements = {
        ...(schools.length ? { schools_required: schools } : {}),
        ...(companies.length ? { companies_specific_required: companies } : {}),
        ...(seniority ? { min_seniority: seniority } : {}),
        strict_mode: strict,
        ...(instructions.trim() ? { custom_instructions: instructions.trim() } : {}),
      };

      const { error } = await (supabase as any).from('client_pedigree_presets').insert({
        organization_id: orgId,
        created_by: user.id,
        name: 'Mon candidat idéal',
        description: "Créé pendant l'onboarding",
        pedigree_requirements: requirements,
      });
      if (error) throw error;
      toast.success('Profil candidat enregistré — le tri est calibré.');
      onNext();
    } catch (err: any) {
      console.error('[SceneIcp] Save failed:', err);
      toast.error(err?.message || "Erreur lors de l'enregistrement");
      setSaving(false);
    }
  };

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-4">
      {/* Header */}
      <div className="text-center space-y-1.5">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Votre candidat idéal</p>
        <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">À quoi ressemble un bon profil ?</h2>
        <p className="text-muted-foreground text-sm">
          Konekt note chaque candidat trouvé. Vos critères calibrent ce tri dès la première recherche.
        </p>
      </div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border bg-card p-4 space-y-4">
        <ChipsInput
          icon={<GraduationCap className="w-3 h-3" />}
          label="Écoles ou formations cibles"
          placeholder="Ex. Centrale, 42, HEC… puis Entrée"
          values={schools}
          onChange={setSchools}
        />
        <ChipsInput
          icon={<Target className="w-3 h-3" />}
          label="Entreprises dont vous aimez les profils"
          placeholder="Ex. Datadog, BlaBlaCar… puis Entrée"
          values={companies}
          onChange={setCompanies}
        />

        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Séniorité minimale</p>
          <div className="flex flex-wrap gap-1.5">
            {SENIORITY_OPTIONS.map((opt) => {
              const active = seniority === opt.value;
              return (
                <motion.button
                  key={opt.value}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setSeniority(active ? null : opt.value)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-medium border transition-colors ${
                    active ? 'bg-foreground text-background border-foreground' : 'border-border bg-transparent hover:bg-accent'
                  }`}
                >
                  {opt.label}
                </motion.button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg bg-foreground/[0.04] px-3 py-2.5">
          <div>
            <p className="text-sm font-medium">Mode strict</p>
            <p className="text-[11px] text-muted-foreground">Un candidat hors critères ne pourra pas dépasser 50/100.</p>
          </div>
          <Switch checked={strict} onCheckedChange={setStrict} />
        </div>

        <Textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Autre chose qui compte pour vous ? (ex. « expérience startup obligatoire », « anglais courant »…)"
          rows={2}
          className="text-sm rounded-xl"
        />
      </motion.div>

      {/* Navigation */}
      <div className="flex flex-col items-end gap-1.5 pt-1">
        <div className="flex items-center justify-between w-full">
          <Button variant="outline" onClick={onBack} className="gap-2">
            <ArrowLeft className="w-4 h-4" /> Retour
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving} className="gap-2 px-6">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            {hasContent ? 'Enregistrer et continuer' : 'Continuer'}
          </Button>
        </div>
        <button onClick={onNext} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
          Passer — réglable plus tard dans Réglages → ICP sociétés
        </button>
      </div>
    </div>
  );
};
