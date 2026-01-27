import { useState, useEffect } from 'react';
import { motion, AnimatePresence, useScroll, useTransform, useSpring, useInView } from 'framer-motion';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Check, ArrowRight, Users, Target, Zap, TrendingUp, Calendar, Clock, Star, ChevronDown, Sparkles, Rocket, Shield, Play } from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';

// Animated counter component
const AnimatedCounter = ({ value, suffix = '' }: { value: string; suffix?: string }) => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });
  
  return (
    <motion.span
      ref={ref}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={isInView ? { opacity: 1, scale: 1 } : {}}
      transition={{ type: "spring", stiffness: 100, delay: 0.2 }}
      className="inline-block"
    >
      {value}{suffix}
    </motion.span>
  );
};

// Floating element component
const FloatingElement = ({ children, delay = 0, duration = 3 }: { children: React.ReactNode; delay?: number; duration?: number }) => (
  <motion.div
    animate={{ 
      y: [-10, 10, -10],
      rotate: [-2, 2, -2],
    }}
    transition={{ 
      duration,
      repeat: Infinity,
      delay,
      ease: "easeInOut"
    }}
  >
    {children}
  </motion.div>
);

// Magnetic button component
const MagneticButton = ({ children, className }: { children: React.ReactNode; className?: string }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const handleMouse = (e: React.MouseEvent) => {
    const { clientX, clientY } = e;
    const { left, top, width, height } = ref.current!.getBoundingClientRect();
    const x = (clientX - left - width / 2) * 0.15;
    const y = (clientY - top - height / 2) * 0.15;
    setPosition({ x, y });
  };

  const reset = () => setPosition({ x: 0, y: 0 });

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouse}
      onMouseLeave={reset}
      animate={{ x: position.x, y: position.y }}
      transition={{ type: "spring", stiffness: 150, damping: 15 }}
      className={className}
    >
      {children}
    </motion.div>
  );
};

// Reveal text animation
const RevealText = ({ children, delay = 0 }: { children: string; delay?: number }) => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });
  
  return (
    <span ref={ref} className="inline-block overflow-hidden">
      <motion.span
        className="inline-block"
        initial={{ y: "100%" }}
        animate={isInView ? { y: 0 } : {}}
        transition={{ duration: 0.8, delay, ease: [0.33, 1, 0.68, 1] }}
      >
        {children}
      </motion.span>
    </span>
  );
};

const SkalrLanding = () => {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);
  
  const { scrollYProgress } = useScroll();
  const smoothProgress = useSpring(scrollYProgress, { stiffness: 100, damping: 30 });
  
  const heroY = useTransform(smoothProgress, [0, 0.3], [0, -100]);
  const heroOpacity = useTransform(smoothProgress, [0, 0.2], [1, 0]);
  const navBackground = useTransform(smoothProgress, [0, 0.05], [0, 1]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const packs = [
    {
      name: 'Starter',
      price: '7 000',
      duration: '4-6 semaines',
      description: 'Cadrage rapide et priorités',
      features: [
        'Audit ciblé de votre processus actuel',
        'Identification des quick wins',
        'Plan d\'action priorisé',
        'Account Manager dédié',
      ],
      highlight: false,
      icon: Zap,
    },
    {
      name: 'Booster',
      price: '11 990',
      duration: '8 semaines',
      description: 'Design du funnel et mise en route',
      features: [
        'Tout ce qui est inclus dans Starter',
        'Design complet du funnel recrutement',
        'Mise en place des premiers outils',
        'Premières automatisations',
        'Lives experts hebdomadaires',
      ],
      highlight: true,
      icon: Rocket,
    },
    {
      name: 'Scale',
      price: '15 990',
      duration: '12-16 semaines',
      description: 'Déploiement complet et autonomisation',
      features: [
        'Tout ce qui est inclus dans Booster',
        'Documentation complète des processus',
        'Transfert de compétences à l\'équipe',
        'Autonomisation totale',
        'Support étendu post-accompagnement',
      ],
      highlight: false,
      icon: Target,
    },
  ];

  const stats = [
    { value: '30%', label: 'Réduction du time-to-hire', icon: Clock },
    { value: '2x', label: 'Plus de candidatures qualifiées', icon: Users },
    { value: '85%', label: 'Taux de succès en période d\'essai', icon: Shield },
    { value: '150+', label: 'Startups accompagnées', icon: Rocket },
  ];

  const pillars = [
    {
      icon: Target,
      title: 'Talent Roadmapping',
      description: 'Planifiez stratégiquement vos besoins en recrutement avec une vision claire à 12-24 mois.',
    },
    {
      icon: Users,
      title: 'Stratégie d\'Attraction',
      description: 'Créez une proposition de valeur unique qui attire les meilleurs talents de votre marché.',
    },
    {
      icon: Zap,
      title: 'Process Scalable',
      description: 'Industrialisez votre recrutement avec des processus reproductibles et automatisés.',
    },
  ];

  const faqs = [
    {
      question: 'Quelle est la différence entre Skalr et un cabinet de recrutement classique ?',
      answer: 'Skalr ne recrute pas pour vous. Nous sommes un studio d\'innovation qui transforme votre fonction recrutement en levier de croissance.',
    },
    {
      question: 'Combien de temps dure un accompagnement ?',
      answer: 'Selon le pack choisi, l\'accompagnement dure de 4 semaines (Starter) à 16 semaines (Scale).',
    },
    {
      question: 'Pour qui est fait cet accompagnement ?',
      answer: 'Skalr s\'adresse aux startups en hypercroissance (10+ recrutements/an), aux scale-ups en phase d\'accélération.',
    },
    {
      question: 'Quels résultats puis-je attendre ?',
      answer: 'Nos clients constatent en moyenne une réduction de 30% du time-to-hire et un doublement des candidatures qualifiées.',
    },
  ];

  const companies = ['Ledger', 'PayFit', 'Lydia', 'Qonto', 'Alan', 'Swile'];

  return (
    <>
      <SEOHead 
        title="Skalr - Transformez votre recrutement en levier de croissance"
        description="Studio d'innovation talent pour startups et scale-ups."
        keywords="recrutement startup, talent acquisition, RH scale-up"
      />
      
      <div ref={containerRef} className="min-h-screen bg-[#0a0a0f] text-white overflow-x-hidden">
        {/* Cursor follower */}
        <motion.div
          className="fixed w-[500px] h-[500px] rounded-full pointer-events-none z-0 opacity-30"
          style={{
            background: 'radial-gradient(circle, rgba(147, 51, 234, 0.15) 0%, transparent 70%)',
            left: mousePosition.x - 250,
            top: mousePosition.y - 250,
          }}
          animate={{
            left: mousePosition.x - 250,
            top: mousePosition.y - 250,
          }}
          transition={{ type: "spring", stiffness: 50, damping: 30 }}
        />

        {/* Animated grid background */}
        <div className="fixed inset-0 -z-10">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:100px_100px]" />
          <motion.div 
            className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px]"
            style={{
              background: 'radial-gradient(ellipse at center, rgba(147, 51, 234, 0.15) 0%, rgba(236, 72, 153, 0.1) 30%, transparent 70%)',
            }}
            animate={{
              scale: [1, 1.1, 1],
              opacity: [0.5, 0.8, 0.5],
            }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>

        {/* Navigation */}
        <motion.nav 
          className="fixed top-0 left-0 right-0 z-50 px-6 py-4"
          style={{
            backgroundColor: useTransform(navBackground, (v) => `rgba(10, 10, 15, ${v * 0.9})`),
            backdropFilter: useTransform(navBackground, (v) => `blur(${v * 20}px)`),
          }}
        >
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6 }}
              className="text-2xl font-black tracking-tight"
            >
              <span className="bg-gradient-to-r from-purple-400 via-pink-500 to-orange-400 bg-clip-text text-transparent">
                Skalr
              </span>
              <span className="text-white/80">.co</span>
            </motion.div>
            
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="hidden md:flex items-center gap-1 p-1 rounded-full bg-white/5 border border-white/10"
            >
              {['Méthode', 'Offres', 'Résultats', 'FAQ'].map((item, i) => (
                <motion.a 
                  key={item}
                  href={`#${item.toLowerCase()}`} 
                  className="px-5 py-2 text-sm text-white/60 hover:text-white rounded-full hover:bg-white/10 transition-all duration-300"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  {item}
                </motion.a>
              ))}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6 }}
            >
              <MagneticButton>
                <Button className="rounded-full bg-white text-black hover:bg-white/90 font-medium px-6 shadow-[0_0_30px_rgba(255,255,255,0.2)]">
                  Audit gratuit
                  <motion.span
                    animate={{ x: [0, 4, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  >
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </motion.span>
                </Button>
              </MagneticButton>
            </motion.div>
          </div>
        </motion.nav>

        {/* Hero Section */}
        <motion.section 
          className="min-h-screen flex items-center justify-center px-6 relative pt-20"
          style={{ y: heroY, opacity: heroOpacity }}
        >
          <div className="max-w-6xl mx-auto text-center relative">
            {/* Floating badges */}
            <div className="absolute inset-0 pointer-events-none">
              <FloatingElement delay={0} duration={4}>
                <motion.div 
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 1, type: "spring" }}
                  className="absolute -left-10 top-20 hidden lg:flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-500/30 text-sm"
                >
                  <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-green-300">+150 startups</span>
                </motion.div>
              </FloatingElement>
              
              <FloatingElement delay={1} duration={5}>
                <motion.div 
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 1.2, type: "spring" }}
                  className="absolute -right-10 top-32 hidden lg:flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/30 text-sm"
                >
                  <Star className="w-4 h-4 text-yellow-400" />
                  <span className="text-purple-300">4.9/5 satisfaction</span>
                </motion.div>
              </FloatingElement>

              <FloatingElement delay={2} duration={6}>
                <motion.div 
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 1.4, type: "spring" }}
                  className="absolute left-20 bottom-20 hidden lg:flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-blue-500/20 to-cyan-500/20 border border-blue-500/30 text-sm"
                >
                  <Zap className="w-4 h-4 text-blue-400" />
                  <span className="text-blue-300">-30% time-to-hire</span>
                </motion.div>
              </FloatingElement>
            </div>

            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/5 border border-white/10 text-sm mb-8 backdrop-blur-sm"
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
              >
                <Sparkles className="h-4 w-4 text-purple-400" />
              </motion.div>
              <span className="text-white/70">Studio d'innovation talent</span>
            </motion.div>
            
            <div className="mb-8 overflow-hidden">
              <motion.h1 
                className="text-5xl sm:text-6xl md:text-8xl font-black tracking-tight leading-[0.9]"
              >
                <motion.span
                  initial={{ y: 100, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.8, delay: 0.2 }}
                  className="block"
                >
                  Transformez votre
                </motion.span>
                <motion.span
                  initial={{ y: 100, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.8, delay: 0.4 }}
                  className="block bg-gradient-to-r from-purple-400 via-pink-500 to-orange-400 bg-clip-text text-transparent"
                >
                  recrutement
                </motion.span>
              </motion.h1>
            </div>
            
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.6 }}
              className="text-xl md:text-2xl text-white/50 max-w-2xl mx-auto mb-12 font-light"
            >
              Nous aidons les startups à recruter{' '}
              <span className="text-white/80">plus efficacement</span>,{' '}
              <span className="text-white/80">plus rapidement</span> et avec{' '}
              <span className="text-white/80">plus de succès</span>.
            </motion.p>
            
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.8 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-4"
            >
              <MagneticButton>
                <Button size="lg" className="rounded-full px-8 h-14 text-lg bg-gradient-to-r from-purple-500 via-pink-500 to-orange-500 hover:opacity-90 border-0 font-medium shadow-[0_0_40px_rgba(168,85,247,0.4)] group">
                  <span>Réserver un audit gratuit</span>
                  <motion.span
                    className="ml-2 inline-block"
                    animate={{ x: [0, 5, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  >
                    <ArrowRight className="h-5 w-5" />
                  </motion.span>
                </Button>
              </MagneticButton>
              
              <MagneticButton>
                <Button size="lg" variant="outline" className="rounded-full px-8 h-14 text-lg border-white/20 bg-white/5 hover:bg-white/10 text-white backdrop-blur-sm group">
                  <Play className="h-5 w-5 mr-2 group-hover:scale-110 transition-transform" />
                  Voir la démo
                </Button>
              </MagneticButton>
            </motion.div>

            {/* Scroll indicator */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.5 }}
              className="absolute bottom-10 left-1/2 -translate-x-1/2"
            >
              <motion.div
                animate={{ y: [0, 10, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="w-6 h-10 rounded-full border-2 border-white/20 flex justify-center pt-2"
              >
                <motion.div
                  animate={{ opacity: [1, 0, 1], y: [0, 10, 0] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="w-1.5 h-1.5 rounded-full bg-white/50"
                />
              </motion.div>
            </motion.div>
          </div>
        </motion.section>

        {/* Clients marquee */}
        <section className="py-16 border-y border-white/5 overflow-hidden">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="mb-8 text-center"
          >
            <span className="text-xs uppercase tracking-[0.3em] text-white/30">Ils nous font confiance</span>
          </motion.div>
          
          <div className="relative">
            <div className="absolute left-0 top-0 bottom-0 w-32 bg-gradient-to-r from-[#0a0a0f] to-transparent z-10" />
            <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-[#0a0a0f] to-transparent z-10" />
            
            <motion.div 
              className="flex gap-16 whitespace-nowrap"
              animate={{ x: [0, -1000] }}
              transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
            >
              {[...companies, ...companies, ...companies].map((company, i) => (
                <span key={i} className="text-3xl md:text-4xl font-bold text-white/10 hover:text-white/30 transition-colors cursor-default">
                  {company}
                </span>
              ))}
            </motion.div>
          </div>
        </section>

        {/* Stats Section */}
        <section className="py-32 px-6">
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {stats.map((stat, index) => (
                <motion.div 
                  key={index}
                  initial={{ opacity: 0, y: 50, rotateX: -30 }}
                  whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
                  viewport={{ once: true, margin: "-100px" }}
                  transition={{ duration: 0.8, delay: index * 0.1, type: "spring" }}
                  whileHover={{ y: -10, scale: 1.02 }}
                  className="group relative"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <div className="relative p-8 rounded-3xl bg-white/[0.03] border border-white/10 backdrop-blur-sm hover:border-purple-500/30 transition-all duration-500">
                    <motion.div
                      initial={{ scale: 0, rotate: -180 }}
                      whileInView={{ scale: 1, rotate: 0 }}
                      viewport={{ once: true }}
                      transition={{ type: "spring", delay: index * 0.1 + 0.2 }}
                      className="w-14 h-14 mb-6 rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/20 flex items-center justify-center group-hover:scale-110 transition-transform duration-500"
                    >
                      <stat.icon className="h-7 w-7 text-purple-400" />
                    </motion.div>
                    <div className="text-4xl md:text-5xl font-black bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent mb-2">
                      <AnimatedCounter value={stat.value} />
                    </div>
                    <div className="text-sm text-white/40">{stat.label}</div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Pillars Section */}
        <section id="methode" className="py-32 px-6 relative">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-purple-950/5 to-transparent" />
          
          <div className="max-w-6xl mx-auto relative">
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-20"
            >
              <motion.span 
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                className="inline-block text-xs uppercase tracking-[0.3em] text-purple-400 mb-4"
              >
                Notre méthode
              </motion.span>
              <h2 className="text-4xl md:text-6xl font-black mb-6">
                <RevealText>3 piliers pour</RevealText>{' '}
                <span className="bg-gradient-to-r from-purple-400 via-pink-500 to-orange-400 bg-clip-text text-transparent">
                  <RevealText delay={0.2}>scaler</RevealText>
                </span>
              </h2>
            </motion.div>

            <div className="grid md:grid-cols-3 gap-6">
              {pillars.map((pillar, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 80, rotateY: -15 }}
                  whileInView={{ opacity: 1, y: 0, rotateY: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ duration: 0.8, delay: index * 0.15, type: "spring" }}
                  whileHover={{ y: -15, rotateY: 5 }}
                  className="group perspective-1000"
                >
                  <div className="relative h-full p-8 rounded-3xl bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-white/10 backdrop-blur-sm hover:border-purple-500/40 transition-all duration-500 overflow-hidden">
                    {/* Gradient overlay on hover */}
                    <motion.div 
                      className="absolute inset-0 bg-gradient-to-br from-purple-500/10 via-pink-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                    />
                    
                    {/* Animated border */}
                    <motion.div
                      className="absolute inset-0 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                      style={{
                        background: 'linear-gradient(90deg, transparent, rgba(168,85,247,0.3), transparent)',
                        backgroundSize: '200% 100%',
                      }}
                      animate={{
                        backgroundPosition: ['200% 0', '-200% 0'],
                      }}
                      transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                    />
                    
                    <div className="relative">
                      <motion.div 
                        whileHover={{ scale: 1.1, rotate: 10 }}
                        transition={{ type: "spring", stiffness: 300 }}
                        className="w-16 h-16 mb-6 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/25"
                      >
                        <pillar.icon className="h-8 w-8 text-white" />
                      </motion.div>
                      
                      <h3 className="text-2xl font-bold text-white mb-4 group-hover:text-purple-300 transition-colors">{pillar.title}</h3>
                      <p className="text-white/50 leading-relaxed">{pillar.description}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section id="offres" className="py-32 px-6">
          <div className="max-w-6xl mx-auto">
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-20"
            >
              <motion.span 
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                className="inline-block text-xs uppercase tracking-[0.3em] text-purple-400 mb-4"
              >
                Tarifs
              </motion.span>
              <h2 className="text-4xl md:text-6xl font-black">
                <RevealText>Choisissez votre</RevealText>{' '}
                <span className="bg-gradient-to-r from-purple-400 via-pink-500 to-orange-400 bg-clip-text text-transparent">
                  <RevealText delay={0.2}>pack</RevealText>
                </span>
              </h2>
            </motion.div>

            <div className="grid md:grid-cols-3 gap-6">
              {packs.map((pack, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 80, scale: 0.9 }}
                  whileInView={{ opacity: 1, y: 0, scale: 1 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ duration: 0.6, delay: index * 0.15, type: "spring" }}
                  whileHover={{ y: -10 }}
                  className={`relative ${pack.highlight ? 'md:-mt-6 md:mb-6' : ''}`}
                >
                  {pack.highlight && (
                    <motion.div 
                      initial={{ opacity: 0, y: -20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      className="absolute -top-4 left-1/2 -translate-x-1/2 z-10"
                    >
                      <div className="px-4 py-1.5 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-medium shadow-lg shadow-purple-500/30 flex items-center gap-1">
                        <motion.div
                          animate={{ rotate: [0, 15, -15, 0] }}
                          transition={{ duration: 2, repeat: Infinity }}
                        >
                          <Star className="h-3.5 w-3.5" />
                        </motion.div>
                        Populaire
                      </div>
                    </motion.div>
                  )}
                  
                  <div className={`relative h-full p-8 rounded-3xl transition-all duration-500 ${
                    pack.highlight 
                      ? 'bg-gradient-to-b from-purple-500/20 via-white/[0.08] to-white/[0.03] border-2 border-purple-500/40 shadow-2xl shadow-purple-500/20' 
                      : 'bg-white/[0.03] border border-white/10 hover:border-white/20'
                  }`}>
                    <div className="flex items-center gap-3 mb-6">
                      <div className={`w-12 h-12 rounded-xl ${pack.highlight ? 'bg-gradient-to-br from-purple-500 to-pink-500' : 'bg-white/10'} flex items-center justify-center`}>
                        <pack.icon className="h-6 w-6 text-white" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-white">{pack.name}</h3>
                        <p className="text-sm text-white/40">{pack.description}</p>
                      </div>
                    </div>
                    
                    <div className="mb-6">
                      <span className="text-5xl font-black text-white">{pack.price}</span>
                      <span className="text-white/40 ml-2">€ HT</span>
                    </div>
                    
                    <div className="flex items-center gap-2 text-sm text-white/40 mb-8 pb-8 border-b border-white/10">
                      <Clock className="h-4 w-4" />
                      {pack.duration}
                    </div>

                    <ul className="space-y-4 mb-8">
                      {pack.features.map((feature, i) => (
                        <motion.li 
                          key={i}
                          initial={{ opacity: 0, x: -20 }}
                          whileInView={{ opacity: 1, x: 0 }}
                          viewport={{ once: true }}
                          transition={{ delay: 0.5 + i * 0.05 }}
                          className="flex items-start gap-3"
                        >
                          <div className="mt-0.5 p-1 rounded-full bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/20">
                            <Check className="h-3 w-3 text-purple-400" />
                          </div>
                          <span className="text-sm text-white/60">{feature}</span>
                        </motion.li>
                      ))}
                    </ul>

                    <MagneticButton className="w-full">
                      <Button 
                        className={`w-full rounded-full h-12 font-medium ${
                          pack.highlight 
                            ? 'bg-gradient-to-r from-purple-500 to-pink-500 hover:opacity-90 text-white border-0 shadow-lg shadow-purple-500/25' 
                            : 'bg-white/10 hover:bg-white/20 text-white border border-white/10'
                        }`}
                      >
                        Choisir {pack.name}
                      </Button>
                    </MagneticButton>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Results Section */}
        <section id="resultats" className="py-32 px-6 relative overflow-hidden">
          <div className="absolute inset-0">
            <motion.div 
              className="absolute top-1/2 left-0 w-[600px] h-[600px] -translate-y-1/2 -translate-x-1/2"
              style={{
                background: 'radial-gradient(circle, rgba(147, 51, 234, 0.1) 0%, transparent 70%)',
              }}
              animate={{ rotate: 360 }}
              transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
            />
          </div>
          
          <div className="max-w-6xl mx-auto relative">
            <div className="grid md:grid-cols-2 gap-16 items-center">
              <motion.div
                initial={{ opacity: 0, x: -80 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, type: "spring" }}
              >
                <motion.span 
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true }}
                  className="inline-block text-xs uppercase tracking-[0.3em] text-purple-400 mb-4"
                >
                  Résultats
                </motion.span>
                <h2 className="text-4xl md:text-5xl font-black mb-6 leading-tight">
                  <span className="bg-gradient-to-r from-purple-400 via-pink-500 to-orange-400 bg-clip-text text-transparent">8 ans</span>
                  <br />d'expertise French Tech
                </h2>
                <p className="text-lg text-white/50 mb-10 leading-relaxed">
                  Notre méthodologie a été construite et affinée sur le terrain, avec plus de 150 entreprises innovantes.
                </p>

                <div className="space-y-4">
                  {[
                    { icon: TrendingUp, title: "-40% coûts", desc: "Sur le recrutement externe" },
                    { icon: Calendar, title: "28 jours", desc: "Time-to-hire moyen" },
                    { icon: Users, title: "85% succès", desc: "En période d'essai" },
                  ].map((item, index) => (
                    <motion.div 
                      key={index}
                      initial={{ opacity: 0, x: -30 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.3 + index * 0.1 }}
                      whileHover={{ x: 10, scale: 1.02 }}
                      className="flex items-center gap-4 p-4 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-purple-500/30 transition-all cursor-default"
                    >
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                        <item.icon className="h-6 w-6 text-purple-400" />
                      </div>
                      <div>
                        <div className="font-bold text-white">{item.title}</div>
                        <div className="text-sm text-white/40">{item.desc}</div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>

              <motion.div 
                initial={{ opacity: 0, x: 80, rotateY: -10 }}
                whileInView={{ opacity: 1, x: 0, rotateY: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, type: "spring" }}
                className="relative"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-purple-500/30 to-pink-500/30 rounded-3xl blur-2xl" />
                <div className="relative bg-gradient-to-br from-white/10 to-white/[0.02] border border-white/20 rounded-3xl p-10 backdrop-blur-xl">
                  <motion.div 
                    className="absolute -top-4 -right-4 text-6xl"
                    animate={{ rotate: [0, 10, -10, 0], scale: [1, 1.1, 1] }}
                    transition={{ duration: 4, repeat: Infinity }}
                  >
                    ✨
                  </motion.div>
                  
                  <blockquote className="text-xl md:text-2xl font-medium text-white/90 mb-8 leading-relaxed italic">
                    "Skalr nous a permis de passer de 0 à 50 collaborateurs en 18 mois."
                  </blockquote>
                  
                  <div className="flex items-center gap-4">
                    <motion.div 
                      whileHover={{ scale: 1.1 }}
                      className="w-14 h-14 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-purple-500/30"
                    >
                      A
                    </motion.div>
                    <div>
                      <div className="font-semibold text-white">CEO, Scale-up Tech</div>
                      <div className="text-sm text-white/40">Série B — 20M€</div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section id="faq" className="py-32 px-6">
          <div className="max-w-3xl mx-auto">
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-16"
            >
              <h2 className="text-4xl md:text-5xl font-black">
                <RevealText>Questions</RevealText>{' '}
                <span className="bg-gradient-to-r from-purple-400 via-pink-500 to-orange-400 bg-clip-text text-transparent">
                  <RevealText delay={0.2}>fréquentes</RevealText>
                </span>
              </h2>
            </motion.div>

            <div className="space-y-4">
              {faqs.map((faq, index) => (
                <motion.div 
                  key={index}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="group"
                >
                  <motion.button
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                    className="w-full p-6 flex items-center justify-between text-left rounded-2xl bg-white/[0.03] border border-white/10 hover:border-purple-500/30 transition-all"
                    whileHover={{ scale: 1.01 }}
                  >
                    <span className="font-medium text-white pr-8">{faq.question}</span>
                    <motion.div
                      animate={{ rotate: openFaq === index ? 180 : 0 }}
                      transition={{ duration: 0.3 }}
                      className="shrink-0 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center"
                    >
                      <ChevronDown className="h-4 w-4 text-white/60" />
                    </motion.div>
                  </motion.button>
                  
                  <AnimatePresence>
                    {openFaq === index && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="overflow-hidden"
                      >
                        <div className="p-6 pt-0 text-white/50 leading-relaxed">
                          {faq.answer}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-32 px-6 relative overflow-hidden">
          <div className="absolute inset-0">
            <motion.div 
              className="absolute inset-0"
              style={{
                background: 'radial-gradient(ellipse at center, rgba(147, 51, 234, 0.2) 0%, transparent 70%)',
              }}
              animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
              transition={{ duration: 8, repeat: Infinity }}
            />
          </div>
          
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-4xl mx-auto text-center relative"
          >
            <motion.div
              initial={{ scale: 0 }}
              whileInView={{ scale: 1 }}
              viewport={{ once: true }}
              transition={{ type: "spring", delay: 0.2 }}
              className="mb-8"
            >
              <span className="text-6xl">🚀</span>
            </motion.div>
            
            <h2 className="text-4xl md:text-6xl font-black mb-6 leading-tight">
              Prêt à <span className="bg-gradient-to-r from-purple-400 via-pink-500 to-orange-400 bg-clip-text text-transparent">transformer</span>
              <br />votre recrutement ?
            </h2>
            <p className="text-xl text-white/50 mb-10">
              Audit gratuit de 30 minutes • Sans engagement
            </p>
            
            <MagneticButton>
              <Button size="lg" className="rounded-full px-12 h-16 text-lg bg-white text-black hover:bg-white/90 font-bold shadow-[0_0_60px_rgba(255,255,255,0.3)] group">
                Réserver mon audit gratuit
                <motion.span
                  className="ml-2 inline-block"
                  animate={{ x: [0, 8, 0] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                >
                  <ArrowRight className="h-5 w-5" />
                </motion.span>
              </Button>
            </MagneticButton>
          </motion.div>
        </section>

        {/* Footer */}
        <footer className="py-12 px-6 border-t border-white/10">
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
            <motion.div 
              whileHover={{ scale: 1.05 }}
              className="text-xl font-black"
            >
              <span className="bg-gradient-to-r from-purple-400 via-pink-500 to-orange-400 bg-clip-text text-transparent">Skalr</span>
              <span className="text-white/60">.co</span>
            </motion.div>
            <div className="flex items-center gap-8 text-sm text-white/30">
              {['Mentions légales', 'Confidentialité', 'Contact'].map((item) => (
                <motion.a 
                  key={item}
                  href="#" 
                  className="hover:text-white transition-colors"
                  whileHover={{ y: -2 }}
                >
                  {item}
                </motion.a>
              ))}
            </div>
            <div className="text-sm text-white/30">
              © 2025 Skalr.co
            </div>
          </div>
        </footer>
      </div>
    </>
  );
};

export default SkalrLanding;
