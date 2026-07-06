import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, Loader2, ShieldCheck, Gauge, Flame } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMemberQuotas } from '@/hooks/useMemberQuotas';
import { supabase } from '@/integrations/supabase/client';

interface RhythmPreset {
  value: string;
  icon: LucideIcon;
  label: string;
  description: string;
  quotas: {
    max_messages_per_day: number;
    max_inmails_per_day: number;
    max_profile_visits_per_day: number;
    max_actions_per_day: number;
  };
}

const PRESETS: RhythmPreset[] = [
  {
    value: 'prudent',
    icon: ShieldCheck,
    label: 'Prudent',
    description: 'Compte récent ou peu actif. Zéro risque.',
    quotas: { max_messages_per_day: 15, max_inmails_per_day: 10, max_profile_visits_per_day: 60, max_actions_per_day: 40 },
  },
  {
    value: 'balanced',
    icon: Gauge,
    label: 'Équilibré',
    description: 'Le bon rythme pour la plupart des recruteurs.',
    quotas: { max_messages_per_day: 30, max_inmails_per_day: 25, max_profile_visits_per_day: 120, max_actions_per_day: 80 },
  },
  {
    value: 'intensive',
    icon: Flame,
    label: 'Soutenu',
    description: 'Compte ancien, très actif, licence Recruiter.',
    quotas: { max_messages_per_day: 50, max_inmails_per_day: 50, max_profile_visits_per_day: 200, max_actions_per_day: 120 },
  },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => h);

interface Props {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

/**
 * Étape onboarding : rythme de prospection + horaires d'envoi.
 * Écrit member_quotas pour l'utilisateur courant (mêmes plafonds que
 * Réglages > sécurité LinkedIn).
 */
export const SceneQuotas: React.FC<Props> = ({ onNext, onBack, onSkip }) => {
  const { upsertQuota, isSaving } = useMemberQuotas();
  const [preset, setPreset] = useState('balanced');
  const [startHour, setStartHour] = useState('8');
  const [endHour, setEndHour] = useState('19');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setCurrentUserId(user?.id ?? null));
  }, []);

  const selectedPreset = PRESETS.find((p) => p.value === preset)!;

  const handleSubmit = () => {
    if (!currentUserId) {
      onNext();
      return;
    }
    upsertQuota({
      userId: currentUserId,
      quotas: {
        ...selectedPreset.quotas,
        business_hours_start: parseInt(startHour, 10),
        business_hours_end: parseInt(endHour, 10),
      },
    });
    onNext();
  };

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-5">
      {/* Header */}
      <div className="text-center space-y-2">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Votre rythme de prospection</h2>
        <p className="text-muted-foreground text-sm">
          LinkedIn n’aime pas les comptes trop pressés. On plafonne vos envois automatiques pour protéger votre compte.
        </p>
      </div>

      {/* Presets */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {PRESETS.map((p, index) => {
          const Icon = p.icon;
          const isSelected = preset === p.value;
          return (
            <motion.button
              key={p.value}
              type="button"
              onClick={() => setPreset(p.value)}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 + index * 0.07, duration: 0.35 }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              className={`text-left p-3 rounded-lg border transition-all duration-200 ${
                isSelected ? 'border-foreground/40 bg-accent/60 shadow-sm' : 'border-border hover:bg-accent/30'
              }`}
              aria-pressed={isSelected}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className={`w-6 h-6 flex items-center justify-center rounded-md transition-colors ${
                    isSelected ? 'bg-emerald-500/30' : 'bg-emerald-500/15'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 text-foreground" strokeWidth={2} />
                </span>
                <span className="text-sm font-semibold">{p.label}</span>
                {isSelected && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="ml-auto text-success"
                  >
                    <Check className="w-3.5 h-3.5" strokeWidth={3} />
                  </motion.span>
                )}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{p.description}</p>
            </motion.button>
          );
        })}
      </div>

      {/* Détail du preset sélectionné */}
      <motion.div
        key={preset}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="rounded-lg border border-border bg-card/60 backdrop-blur-sm p-3 grid grid-cols-3 gap-2 text-center"
      >
        <div>
          <span className="block text-lg font-bold font-mono tabular-nums">{selectedPreset.quotas.max_messages_per_day}</span>
          <span className="block text-2xs text-muted-foreground">messages / jour</span>
        </div>
        <div>
          <span className="block text-lg font-bold font-mono tabular-nums">{selectedPreset.quotas.max_inmails_per_day}</span>
          <span className="block text-2xs text-muted-foreground">InMails / jour</span>
        </div>
        <div>
          <span className="block text-lg font-bold font-mono tabular-nums">{selectedPreset.quotas.max_profile_visits_per_day}</span>
          <span className="block text-2xs text-muted-foreground">visites / jour</span>
        </div>
      </motion.div>

      {/* Horaires d'envoi */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="space-y-1.5"
      >
        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Horaires d’envoi automatique
        </label>
        <div className="flex items-center gap-2">
          <Select value={startHour} onValueChange={setStartHour}>
            <SelectTrigger className="border border-border h-10 text-sm flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOUR_OPTIONS.slice(5, 13).map((h) => (
                <SelectItem key={h} value={String(h)}>{h}h00</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground shrink-0">à</span>
          <Select value={endHour} onValueChange={setEndHour}>
            <SelectTrigger className="border border-border h-10 text-sm flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOUR_OPTIONS.slice(15, 24).map((h) => (
                <SelectItem key={h} value={String(h)}>{h}h00</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          Vos séquences n’enverront rien en dehors de ces horaires — plus naturel, plus efficace.
        </p>
      </motion.div>

      {/* Navigation */}
      <motion.div
        className="flex items-center justify-between pt-1"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <Button variant="ghost" onClick={onBack} className="gap-2 text-sm">
          <ArrowLeft className="w-4 h-4" /> Retour
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onSkip} className="text-sm text-muted-foreground">
            Passer
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSaving}
            className="gap-2 border border-border bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            Suivant
          </Button>
        </div>
      </motion.div>
    </div>
  );
};
