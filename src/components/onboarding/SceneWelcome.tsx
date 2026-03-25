import React from 'react';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

import rocketImg from '@/assets/illust-rocket.png';
import dashboardImg from '@/assets/landing-dashboard.png';
import linkedinLogo from '@/assets/linkedin-logo.png';
import notionLogo from '@/assets/notion-logo.png';
import calendlyLogo from '@/assets/calendly-logo.png';
import airtableLogo from '@/assets/airtable-logo.svg';
import aircallLogo from '@/assets/aircall-logo.png';

interface Props {
  onNext: () => void;
}

const integrations = [
  { src: linkedinLogo, alt: 'LinkedIn' },
  { src: notionLogo, alt: 'Notion' },
  { src: calendlyLogo, alt: 'Calendly' },
  { src: airtableLogo, alt: 'Airtable' },
  { src: aircallLogo, alt: 'Aircall' },
];

export const SceneWelcome: React.FC<Props> = ({ onNext }) => {
  return (
    <div className="w-full max-w-lg mx-auto flex flex-col items-center text-center gap-6">
      {/* Rocket illustration */}
      <motion.img
        src={rocketImg}
        alt="Rocket"
        className="w-24 h-24 drop-shadow-lg"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.5 }}
      />

      {/* Brutal badge */}
      <motion.div
        className="inline-flex items-center px-3 py-1.5 border-2 border-foreground text-[10px] uppercase tracking-[0.2em] font-semibold"
        style={{ boxShadow: '3px 3px 0px 0px hsl(var(--brutal-accent))' }}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.3 }}
      >
        Plateforme de recrutement
      </motion.div>

      {/* Title */}
      <motion.h1
        className="font-editorial italic text-3xl sm:text-4xl md:text-5xl leading-tight"
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.5 }}
      >
        Bienvenue sur <span className="skalr-gradient-text">Skalr</span>
      </motion.h1>

      {/* Subtitle */}
      <motion.p
        className="text-muted-foreground text-base max-w-sm"
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.5 }}
      >
        Configurez votre espace en quelques minutes. On s'occupe de tout.
      </motion.p>

      {/* Integration logos */}
      <motion.div
        className="flex items-center justify-center gap-5 py-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.5 }}
      >
        {integrations.map((item) => (
          <img
            key={item.alt}
            src={item.src}
            alt={item.alt}
            className="h-6 w-auto grayscale opacity-50 hover:grayscale-0 hover:opacity-100 transition-all duration-300 cursor-default"
          />
        ))}
      </motion.div>

      {/* CTA Button */}
      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.6, duration: 0.4 }}
      >
        <Button
          onClick={onNext}
          className="border-2 border-foreground bg-foreground text-background hover:bg-foreground/90 px-8 py-3 text-sm font-semibold uppercase tracking-wider"
          style={{ boxShadow: '3px 3px 0px 0px hsl(var(--brutal-accent))' }}
        >
          C'est parti <ArrowRight className="ml-2 w-4 h-4" />
        </Button>
      </motion.div>

      {/* Dashboard preview */}
      <motion.div
        className="relative w-full mt-4 rounded-sm overflow-hidden border-2 border-foreground/10"
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.7, duration: 0.6 }}
      >
        <img
          src={dashboardImg}
          alt="Dashboard preview"
          className="w-full h-auto"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
      </motion.div>
    </div>
  );
};
