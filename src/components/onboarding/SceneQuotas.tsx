import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMemberQuotas } from '@/hooks/useMemberQuotas';
import { supabase } from '@/integrations/supabase/client';
import { EditorialChoiceList } from './EditorialChoiceList';

interface RhythmPreset {
  value: string;
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
    label: 'Prudent',
    description: 'Compte récent ou peu actif. Zéro risque.',
    quotas: { max_messages_per_day: 15, max_inmails_per_day: 10, max_profile_visits_per_day: 60, max_actions_per_day: 40 },
  },
  {
    value: 'balanced',
    label: 'Équilibré',
    description: 'Le bon rythme pour la plupart des recruteurs.',
    quotas: { max_messages_per_day: 30, max_inmails_per_day: 25, max_profile_visits_per_day: 120, max_actions_per_day: 80 },
  },
  {
    value: 'intensive',
    label: 'Soutenu',
    description: 'Compte ancien, très actif, licence Recruiter.',
    quotas: { max_messages_per_day: 50, max_inmails_per_day: 50, max_profile_visits_per_day: 200, max_actions_per_day: 120 },
  },
];

const START_HOURS = [6, 7, 8, 9, 10, 11, 12];
const END_HOURS = [16, 17, 18, 19, 20, 21, 22];

interface Props {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

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
    <div className="w-full">
      <div className="mb-8">
        <h2 className="font-editorial font-normal italic text-4xl sm:text-5xl leading-[1.08]">
          À quel rythme prospecter ?
        </h2>
        <p className="text-muted-foreground text-[15px] leading-relaxed mt-3 max-w-md">
          LinkedIn n'aime pas les comptes trop pressés. Konekt plafonne vos envois
          automatiques pour protéger votre compte — et un rythme naturel répond mieux.
        </p>
      </div>

      <EditorialChoiceList
        options={PRESETS.map(({ value, label, description }) => ({ value, label, description }))}
        selected={[preset]}
        mode="single"
        onSelect={setPreset}
      />

      {/* Détail du preset — une ligne, pas une carte */}
      <AnimatePresence mode="wait">
        <motion.p
          key={preset}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="font-mono text-xs text-muted-foreground mt-5 tabular-nums"
        >
          {selectedPreset.quotas.max_messages_per_day} messages · {selectedPreset.quotas.max_inmails_per_day} InMails ·{' '}
          {selectedPreset.quotas.max_profile_visits_per_day} visites de profil — par jour, maximum.
        </motion.p>
      </AnimatePresence>

      {/* Horaires — une phrase */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="flex items-center gap-2 flex-wrap mt-7 text-[15px] text-foreground/85"
      >
        <span>Envois automatiques entre</span>
        <Select value={startHour} onValueChange={setStartHour}>
          <SelectTrigger className="w-[84px] h-8 text-sm border-border bg-background/50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {START_HOURS.map((h) => (
              <SelectItem key={h} value={String(h)}>{h}h00</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span>et</span>
        <Select value={endHour} onValueChange={setEndHour}>
          <SelectTrigger className="w-[84px] h-8 text-sm border-border bg-background/50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {END_HOURS.map((h) => (
              <SelectItem key={h} value={String(h)}>{h}h00</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span>— jamais la nuit, jamais le dimanche à 3h.</span>
      </motion.div>

      {/* Navigation */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.45 }}
        className="flex items-center justify-between mt-8"
      >
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Retour
        </button>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-border transition-colors"
          >
            Régler plus tard
          </button>
          <Button
            onClick={handleSubmit}
            disabled={isSaving}
            className="gap-2 bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            Continuer
          </Button>
        </div>
      </motion.div>
    </div>
  );
};
