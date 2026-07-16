import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { EditorialChoiceList } from './EditorialChoiceList';

const DISCOVERY_SOURCES = [
  { value: 'linkedin', label: 'LinkedIn (post / pub)' },
  { value: 'linkedin-dm', label: 'LinkedIn (message privé)' },
  { value: 'google', label: 'Recherche Google' },
  { value: 'word-of-mouth', label: 'Bouche-à-oreille' },
  { value: 'community', label: 'Communauté Slack / Discord' },
  { value: 'podcast', label: 'Podcast' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'newsletter', label: 'Newsletter' },
  { value: 'blog', label: 'Article / Blog' },
  { value: 'event', label: 'Événement / Meetup' },
  { value: 'product-hunt', label: 'Product Hunt' },
  { value: 'appsumo', label: 'AppSumo' },
  { value: 'comparison', label: 'Comparatifs (G2, Capterra…)' },
  { value: 'referral', label: 'Parrainage' },
  { value: 'social-twitter', label: 'X (Twitter)' },
  { value: 'social-instagram', label: 'Instagram / TikTok' },
  { value: 'partner', label: 'Partenaire / Intégrateur' },
  { value: 'other', label: 'Autre' },
];

interface Props {
  onSubmit: (source: string) => void;
  onSkip: () => void;
  onBack: () => void;
  savedValue?: string;
}

export const SceneDiscovery: React.FC<Props> = ({ onSubmit, onSkip, onBack, savedValue }) => {
  const [selected, setSelected] = useState<string[]>(savedValue ? [savedValue] : []);
  const firedRef = useRef(false);

  const handlePick = (value: string) => {
    if (firedRef.current) return;
    firedRef.current = true;
    setSelected([value]);
    setTimeout(() => onSubmit(value), 420);
  };

  return (
    <div className="w-full">
      <div className="mb-8">
        <h2 className="font-editorial font-normal italic text-4xl sm:text-5xl leading-[1.08]">
          Comment nous avez-vous trouvé ?
        </h2>
        <p className="text-muted-foreground text-[15px] leading-relaxed mt-3 max-w-md">
          Simple curiosité — ça nous aide à rendre Konekt visible au bon endroit.
        </p>
      </div>

      <EditorialChoiceList
        options={DISCOVERY_SOURCES}
        selected={selected}
        mode="single"
        onSelect={handlePick}
        columns={2}
        dense
      />

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="flex items-center gap-5 mt-8"
      >
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Retour
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-border transition-colors"
        >
          Je préfère passer
        </button>
      </motion.div>
    </div>
  );
};
