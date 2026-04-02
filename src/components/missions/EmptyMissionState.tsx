import React, { useEffect, useState } from 'react';
import { motion, useMotionValue, useTransform, animate as fmAnimate } from 'framer-motion';
import { Sparkles, Clock, MessageSquare, Pencil, List, Settings, ExternalLink, Zap, Brain, ArrowRight } from 'lucide-react';
import { ShimmerButton } from '@/components/magicui/shimmer-button';
import { cn } from '@/lib/utils';

interface EmptyMissionStateProps {
  onCreateAI: () => void;
  onCreateManual: () => void;
}

/* ─── Animated neural network background ─── */
const NeuralBackground: React.FC = () => {
  const nodes = [
    { x: 15, y: 20 }, { x: 45, y: 12 }, { x: 78, y: 22 },
    { x: 25, y: 50 }, { x: 55, y: 45 }, { x: 85, y: 55 },
    { x: 10, y: 80 }, { x: 50, y: 78 }, { x: 90, y: 82 },
    { x: 35, y: 35 }, { x: 65, y: 65 },
  ];
  const edges: [number, number][] = [
    [0, 3], [0, 9], [1, 4], [1, 9], [2, 4], [2, 5],
    [3, 6], [3, 10], [4, 7], [4, 10], [5, 8],
    [6, 7], [7, 8], [9, 10],
  ];

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
      {edges.map(([a, b], i) => (
        <motion.line
          key={`e-${i}`}
          x1={nodes[a].x} y1={nodes[a].y}
          x2={nodes[b].x} y2={nodes[b].y}
          stroke="hsl(var(--primary))"
          strokeWidth="0.15"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.25 }}
          transition={{ delay: 0.8 + i * 0.06, duration: 0.8, ease: 'easeOut' as const }}
        />
      ))}
      {nodes.map((n, i) => (
        <motion.circle
          key={`n-${i}`}
          cx={n.x} cy={n.y} r="0.6"
          fill="hsl(var(--primary))"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: [0, 1.5, 1], opacity: [0, 0.6, 0.3] }}
          transition={{ delay: 0.5 + i * 0.08, duration: 0.6 }}
        />
      ))}
      {/* Traveling pulse along edges */}
      {edges.slice(0, 6).map(([a, b], i) => (
        <motion.circle
          key={`pulse-${i}`}
          r="0.4"
          fill="hsl(var(--primary))"
          initial={{ cx: nodes[a].x, cy: nodes[a].y, opacity: 0 }}
          animate={{
            cx: [nodes[a].x, nodes[b].x],
            cy: [nodes[a].y, nodes[b].y],
            opacity: [0, 0.8, 0],
          }}
          transition={{
            delay: 2 + i * 0.5,
            duration: 1.2,
            repeat: Infinity,
            repeatDelay: 3 + i * 0.3,
            ease: 'easeInOut' as const,
          }}
        />
      ))}
    </svg>
  );
};

/* ─── Floating particles ─── */
const FloatingParticles: React.FC = () => {
  const particles = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: 1 + Math.random() * 2,
    delay: Math.random() * 3,
    duration: 4 + Math.random() * 4,
  }));

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map(p => (
        <motion.div
          key={p.id}
          className="absolute rounded-full bg-accent/20"
          style={{
            width: p.size,
            height: p.size,
            left: `${p.x}%`,
            top: `${p.y}%`,
          }}
          animate={{
            y: [0, -30, 0],
            opacity: [0, 0.6, 0],
            scale: [0.5, 1, 0.5],
          }}
          transition={{
            delay: p.delay,
            duration: p.duration,
            repeat: Infinity,
            ease: 'easeInOut' as const,
          }}
        />
      ))}
    </div>
  );
};

/* ─── Animated counter ─── */
const AnimatedCounter: React.FC<{ target: number; suffix?: string }> = ({ target, suffix = '' }) => {
  const count = useMotionValue(0);
  const rounded = useTransform(count, v => `${Math.round(v)}${suffix}`);
  const [display, setDisplay] = useState(`0${suffix}`);

  useEffect(() => {
    const controls = fmAnimate(count, target, { duration: 2, delay: 1.2, ease: 'easeOut' as const });
    const unsub = rounded.on('change', v => setDisplay(v));
    return () => { controls.stop(); unsub(); };
  }, [target, count, rounded]);

  return <span>{display}</span>;
};

/* ─── Orbiting icon ring ─── */
const OrbitRing: React.FC = () => {
  const icons = [Brain, Sparkles, Zap, MessageSquare];
  return (
    <div className="relative w-20 h-20 mx-auto mb-2">
      {/* Center glow */}
      <motion.div
        className="absolute inset-2 bg-accent/10 border border-accent/20"
        animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.6, 0.3] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' as const }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <Brain className="w-6 h-6 text-foreground" />
      </div>
      {/* Orbiting icons */}
      {icons.map((Icon, i) => (
        <motion.div
          key={i}
          className="absolute w-5 h-5 flex items-center justify-center"
          style={{ top: '50%', left: '50%', marginTop: -10, marginLeft: -10 }}
          animate={{
            x: [
              Math.cos((i * Math.PI * 2) / icons.length) * 36,
              Math.cos((i * Math.PI * 2) / icons.length + Math.PI) * 36,
              Math.cos((i * Math.PI * 2) / icons.length) * 36,
            ],
            y: [
              Math.sin((i * Math.PI * 2) / icons.length) * 36,
              Math.sin((i * Math.PI * 2) / icons.length + Math.PI) * 36,
              Math.sin((i * Math.PI * 2) / icons.length) * 36,
            ],
          }}
          transition={{
            duration: 8,
            delay: i * 0.3,
            repeat: Infinity,
            ease: 'linear' as const,
          }}
        >
          <Icon className="w-3 h-3 text-primary/60" />
        </motion.div>
      ))}
    </div>
  );
};

/* ─── Typing text effect ─── */
const TypingText: React.FC<{ text: string; delay?: number }> = ({ text, delay = 0 }) => {
  const [displayed, setDisplayed] = useState('');
  useEffect(() => {
    const timeout = setTimeout(() => {
      let i = 0;
      const interval = setInterval(() => {
        if (i <= text.length) {
          setDisplayed(text.slice(0, i));
          i++;
        } else {
          clearInterval(interval);
        }
      }, 30);
      return () => clearInterval(interval);
    }, delay * 1000);
    return () => clearTimeout(timeout);
  }, [text, delay]);

  return (
    <span>
      {displayed}
      <motion.span
        animate={{ opacity: [1, 0] }}
        transition={{ duration: 0.5, repeat: Infinity }}
        className="inline-block w-[2px] h-[1em] bg-accent ml-0.5 align-text-bottom"
      />
    </span>
  );
};

/* ─── Stats bar ─── */
const StatsBar: React.FC = () => (
  <motion.div
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: 0.8, duration: 0.5 }}
    className="flex items-center justify-center gap-8 sm:gap-12 mb-10 sm:mb-14"
  >
    {[
      { value: 200, suffix: 'M+', label: 'Profils accessibles' },
      { value: 45, suffix: 's', label: 'Brief → Sourcing' },
      { value: 3, suffix: 'x', label: 'Plus rapide' },
    ].map((stat, i) => (
      <motion.div
        key={i}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 1 + i * 0.15, duration: 0.4 }}
        className="text-center"
      >
        <div className="text-xl sm:text-2xl font-black text-foreground tracking-tight">
          <AnimatedCounter target={stat.value} suffix={stat.suffix} />
        </div>
        <div className="text-xs text-muted-foreground uppercase tracking-widest mt-0.5">
          {stat.label}
        </div>
      </motion.div>
    ))}
  </motion.div>
);

/* ─── Main bullets with staggered icon animations ─── */
const aiBullets = [
  { icon: Sparkles, text: 'Brief vocal ou écrit → structuré par l\'IA', color: 'text-warning', bg: 'bg-warning/10 border-warning/20' },
  { icon: Clock, text: 'Filtres de recherche générés automatiquement', color: 'text-info', bg: 'bg-info/10 border-info/20' },
  { icon: MessageSquare, text: 'Messages personnalisés en 1 clic', color: 'text-success', bg: 'bg-success/10 border-success/20' },
];

const manualBullets = [
  { icon: Pencil, text: 'Contrôle total sur chaque paramètre', color: 'text-foreground/60', bg: 'bg-accent/50 border-border' },
  { icon: List, text: 'Importez depuis une URL ou un fichier', color: 'text-foreground/60', bg: 'bg-accent/50 border-border' },
  { icon: Settings, text: 'Pour les recruteurs expérimentés', color: 'text-foreground/60', bg: 'bg-accent/50 border-border' },
];

/* ─── Logo carousel (real integrations) ─── */
const LogoCarousel: React.FC = () => {
  const logos = [
    { name: 'LinkedIn', svg: (
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
      </svg>
    )},
    { name: 'Gmail', svg: (
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
        <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/>
      </svg>
    )},
    { name: 'Slack', svg: (
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
        <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
      </svg>
    )},
    { name: 'HubSpot', svg: (
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
        <path d="M18.164 7.93V5.084a2.198 2.198 0 0 0 1.267-1.984v-.066a2.2 2.2 0 0 0-2.198-2.198h-.066a2.2 2.2 0 0 0-2.198 2.198v.066c0 .87.514 1.617 1.253 1.966v2.862a5.667 5.667 0 0 0-2.465 1.163l-6.527-5.08A2.665 2.665 0 0 0 7.348.95a2.667 2.667 0 1 0-1.107 2.15l6.373 4.962a5.707 5.707 0 0 0 .072 6.542l-1.946 1.946a1.891 1.891 0 0 0-.56-.091 1.914 1.914 0 1 0 1.914 1.914c0-.2-.034-.39-.09-.569l1.913-1.913a5.708 5.708 0 1 0 4.247-8.861z"/>
      </svg>
    )},
    { name: 'Salesforce', svg: (
      <svg viewBox="0 0 24 24" className="w-5 h-4" fill="currentColor">
        <path d="M10.006 5.415a4.195 4.195 0 0 1 3.045-1.306c1.56 0 2.954.9 3.69 2.205.63-.3 1.35-.45 2.1-.45 2.85 0 5.159 2.34 5.159 5.22s-2.31 5.22-5.16 5.22c-.45 0-.9-.06-1.32-.165a3.91 3.91 0 0 1-3.48 2.13c-.585 0-1.14-.12-1.65-.36a4.863 4.863 0 0 1-4.35 2.67c-2.19 0-4.02-1.44-4.62-3.42A3.744 3.744 0 0 1 0 13.584c0-1.62 1.02-3 2.46-3.54a4.478 4.478 0 0 1-.06-.72c0-2.58 2.07-4.68 4.62-4.68 1.2 0 2.295.45 3.135 1.2"/>
      </svg>
    )},
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 1.5, duration: 0.6 }}
      className="flex items-center justify-center gap-6 sm:gap-8 mt-10"
    >
      <span className="text-xs text-muted-foreground/40 uppercase tracking-widest shrink-0">
        Intégrations
      </span>
      <div className="flex items-center gap-4">
        {logos.map((logo, i) => (
          <motion.div
            key={logo.name}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.7 + i * 0.1, duration: 0.3 }}
            whileHover={{ scale: 1.2, y: -2 }}
            className="text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors cursor-default"
            title={logo.name}
          >
            {logo.svg}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
};

/* ═══════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════ */

export const EmptyMissionState: React.FC<EmptyMissionStateProps> = ({ onCreateAI, onCreateManual }) => {
  const [hoveredCard, setHoveredCard] = useState<'ai' | 'manual' | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="relative py-10 sm:py-16 overflow-hidden"
    >
      {/* Background effects */}
      <FloatingParticles />

      {/* Hero section */}
      <div className="relative z-10 text-center mb-8 sm:mb-10">
        <OrbitRing />

        <motion.h2
          initial={{ opacity: 0, y: 20, filter: 'blur(10px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ delay: 0.3, duration: 0.7, ease: 'easeOut' as const }}
          className="text-2xl sm:text-4xl font-black uppercase tracking-wider text-foreground mb-3"
        >
          Lancez votre première mission
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.5 }}
          className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed"
        >
          Une mission = un poste à pourvoir. L'IA vous guide du brief au premier message.
        </motion.p>
      </div>

      {/* Stats */}
      <StatsBar />

      {/* Cards */}
      <div className="relative z-10 flex flex-col sm:flex-row gap-6 sm:gap-8 max-w-4xl mx-auto">
        {/* ── Card AI ── */}
        <motion.div
          initial={{ opacity: 0, y: 40, rotateX: 8 }}
          animate={{ opacity: 1, y: 0, rotateX: 0 }}
          transition={{ delay: 0.6, duration: 0.7, ease: 'easeOut' as const }}
          className="flex-1 min-w-0 perspective-1000"
          onMouseEnter={() => setHoveredCard('ai')}
          onMouseLeave={() => setHoveredCard(null)}
        >
          <motion.button
            onClick={onCreateAI}
            whileHover={{ scale: 1.02, y: -4 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            className={cn(
              "relative w-full text-left border-2 border-border p-7 sm:p-9 overflow-hidden h-full",
              "bg-gradient-to-br from-[hsl(var(--accent))] via-transparent to-[hsl(var(--accent))]",
              "focus-visible:outline-none group"
            )}
          >
            {/* Neural background */}
            <NeuralBackground />

            {/* Animated corner accents */}
            <motion.div
              className="absolute top-0 left-0 w-8 h-[2px] bg-accent"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: 1.2, duration: 0.4 }}
              style={{ transformOrigin: 'left' }}
            />
            <motion.div
              className="absolute top-0 left-0 w-[2px] h-8 bg-accent"
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ delay: 1.2, duration: 0.4 }}
              style={{ transformOrigin: 'top' }}
            />
            <motion.div
              className="absolute bottom-0 right-0 w-8 h-[2px] bg-accent"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: 1.4, duration: 0.4 }}
              style={{ transformOrigin: 'right' }}
            />
            <motion.div
              className="absolute bottom-0 right-0 w-[2px] h-8 bg-accent"
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ delay: 1.4, duration: 0.4 }}
              style={{ transformOrigin: 'bottom' }}
            />

            {/* Recommended badge with glow */}
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1, duration: 0.3, type: 'spring' }}
              className="absolute top-4 right-4 z-20"
            >
              <span className="relative px-2.5 py-1 bg-foreground text-background text-xs font-bold uppercase tracking-widest">
                Recommandé
                <motion.span
                  className="absolute inset-0 bg-accent/30"
                  animate={{ opacity: [0, 0.5, 0] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
              </span>
            </motion.span>

            <div className="relative z-10">
              {/* Icon with animated ring */}
              <div className="relative w-14 h-14 mb-6">
                <motion.div
                  className="absolute inset-0 border-2 border-accent/30"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 20, repeat: Infinity, ease: 'linear' as const }}
                  style={{ borderRadius: '30% 70% 70% 30% / 30% 30% 70% 70%' }}
                />
                <div className="absolute inset-0 flex items-center justify-center bg-foreground">
                  <Brain className="w-6 h-6 text-background" />
                </div>
              </div>

              {/* Title with typing effect */}
              <h3 className="text-lg sm:text-xl font-black uppercase tracking-wider text-foreground mb-2">
                Créer avec l'IA
              </h3>
              <p className="text-xs text-muted-foreground mb-6 h-4">
                {hoveredCard === 'ai' && (
                  <TypingText text="Analysons votre brief ensemble..." delay={0} />
                )}
                {hoveredCard !== 'ai' && (
                  <span>La méthode la plus rapide</span>
                )}
              </p>

              {/* Bullets with stagger */}
              <ul className="space-y-4 mb-8">
                {aiBullets.map((item, i) => (
                  <motion.li
                    key={i}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.9 + i * 0.12, duration: 0.4, ease: 'easeOut' as const }}
                    className="flex items-start gap-3 group/item"
                  >
                    <motion.div
                      whileHover={{ scale: 1.15, rotate: 5 }}
                      className={cn("w-7 h-7 border flex items-center justify-center shrink-0", item.bg)}
                    >
                      <item.icon className={cn("w-3.5 h-3.5", item.color)} />
                    </motion.div>
                    <span className="text-xs text-foreground/80 leading-relaxed pt-1">{item.text}</span>
                  </motion.li>
                ))}
              </ul>

              {/* CTA */}
              <ShimmerButton
                className="w-full h-[48px] text-xs pointer-events-none"
                shimmerDuration="1.5s"
                tabIndex={-1}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Commencer le brief IA
                <motion.span
                  animate={{ x: [0, 4, 0] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                </motion.span>
              </ShimmerButton>
            </div>
          </motion.button>
        </motion.div>

        {/* ── Card Manual ── */}
        <motion.div
          initial={{ opacity: 0, y: 40, rotateX: 8 }}
          animate={{ opacity: 1, y: 0, rotateX: 0 }}
          transition={{ delay: 0.8, duration: 0.7, ease: 'easeOut' as const }}
          className="flex-1 min-w-0 perspective-1000"
          onMouseEnter={() => setHoveredCard('manual')}
          onMouseLeave={() => setHoveredCard(null)}
        >
          <motion.button
            onClick={onCreateManual}
            whileHover={{ scale: 1.02, y: -4 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            className={cn(
              "relative w-full text-left border border-border p-7 sm:p-9 overflow-hidden h-full bg-background",
              "hover:border-border transition-colors duration-300",
              "focus-visible:outline-none group"
            )}
          >
            <div className="relative z-10">
              {/* Icon */}
              <div className="relative w-14 h-14 mb-6">
                <div className="absolute inset-0 border border-border" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Pencil className="w-6 h-6 text-foreground/70" />
                </div>
              </div>

              {/* Title */}
              <h3 className="text-lg sm:text-xl font-black uppercase tracking-wider text-foreground mb-2">
                Créer manuellement
              </h3>
              <p className="text-xs text-muted-foreground mb-6 h-4">
                Pour les recruteurs experts
              </p>

              {/* Bullets */}
              <ul className="space-y-4 mb-8">
                {manualBullets.map((item, i) => (
                  <motion.li
                    key={i}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 1.1 + i * 0.12, duration: 0.4, ease: 'easeOut' as const }}
                    className="flex items-start gap-3"
                  >
                    <motion.div
                      whileHover={{ scale: 1.15, rotate: 5 }}
                      className={cn("w-7 h-7 border flex items-center justify-center shrink-0", item.bg)}
                    >
                      <item.icon className={cn("w-3.5 h-3.5", item.color)} />
                    </motion.div>
                    <span className="text-xs text-foreground/80 leading-relaxed pt-1">{item.text}</span>
                  </motion.li>
                ))}
              </ul>

              {/* CTA outline */}
              <div className="relative overflow-hidden w-full h-[48px] text-xs font-bold uppercase tracking-wider border border-border bg-background text-foreground flex items-center justify-center gap-2 group/btn">
                <span className="relative z-10 flex items-center gap-2">
                  <Pencil className="w-3.5 h-3.5" />
                  Création manuelle
                </span>
                <span className="absolute inset-0 bg-accent translate-y-full group-hover/btn:translate-y-0 transition-transform duration-300 ease-out" />
              </div>
            </div>
          </motion.button>
        </motion.div>
      </div>

      {/* Bottom: Import link + Logo carousel */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.3, duration: 0.5 }}
        className="relative z-10 mt-8 text-center"
      >
        <p className="text-xs text-muted-foreground/50">
          Ou importez depuis une page carrières{' '}
          <ExternalLink className="inline w-3 h-3 text-foreground/30 hover:text-foreground/60 transition-colors cursor-pointer" />
        </p>
      </motion.div>

      <LogoCarousel />
    </motion.div>
  );
};
