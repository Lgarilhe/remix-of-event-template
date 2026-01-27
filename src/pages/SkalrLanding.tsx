import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, ArrowRight, Users, Target, Zap, TrendingUp, Calendar, Clock, Star, ChevronDown, Sparkles, Rocket, Shield } from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';

const SkalrLanding = () => {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [activeFeature, setActiveFeature] = useState(0);

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
      gradient: 'from-blue-500 to-cyan-400',
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
      gradient: 'from-purple-500 to-pink-500',
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
      gradient: 'from-orange-500 to-red-500',
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
      color: 'from-purple-500 to-pink-500',
    },
    {
      icon: Users,
      title: 'Stratégie d\'Attraction',
      description: 'Créez une proposition de valeur unique qui attire les meilleurs talents de votre marché.',
      color: 'from-blue-500 to-cyan-400',
    },
    {
      icon: Zap,
      title: 'Process Scalable',
      description: 'Industrialisez votre recrutement avec des processus reproductibles et automatisés.',
      color: 'from-orange-500 to-yellow-400',
    },
  ];

  const features = [
    { name: 'Roadmapping', icon: Target },
    { name: 'Attraction', icon: Users },
    { name: 'Process', icon: Zap },
    { name: 'Automatisation', icon: Sparkles },
    { name: 'Formation', icon: Rocket },
  ];

  const faqs = [
    {
      question: 'Quelle est la différence entre Skalr et un cabinet de recrutement classique ?',
      answer: 'Skalr ne recrute pas pour vous. Nous sommes un studio d\'innovation qui transforme votre fonction recrutement en levier de croissance. Nous concevons, structurons et vous transférons les méthodologies pour que vous soyez autonomes et performants.',
    },
    {
      question: 'Combien de temps dure un accompagnement ?',
      answer: 'Selon le pack choisi, l\'accompagnement dure de 4 semaines (Starter) à 16 semaines (Scale). Des sessions à la carte sont également disponibles pour approfondir des sujets spécifiques.',
    },
    {
      question: 'Pour qui est fait cet accompagnement ?',
      answer: 'Skalr s\'adresse aux startups en hypercroissance (10+ recrutements/an), aux scale-ups en phase d\'accélération, et aux ETI innovantes qui souhaitent moderniser leurs pratiques.',
    },
    {
      question: 'Quels résultats puis-je attendre ?',
      answer: 'Nos clients constatent en moyenne une réduction de 30% du time-to-hire, un doublement des candidatures qualifiées, et une amélioration du taux de succès en période d\'essai de 70% à 85%.',
    },
  ];

  const companies = ['Ledger', 'PayFit', 'Lydia', 'Qonto', 'Alan', 'Swile'];

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
  };

  return (
    <>
      <SEOHead 
        title="Skalr - Transformez votre recrutement en levier de croissance"
        description="Studio d'innovation talent pour startups et scale-ups. Méthodologies sur-mesure pour recruter plus efficacement, plus rapidement et avec un meilleur taux de succès."
        keywords="recrutement startup, talent acquisition, RH scale-up, recrutement tech, méthodologie recrutement"
      />
      
      <div className="min-h-screen bg-slate-950 text-white overflow-hidden">
        {/* Animated Background */}
        <div className="fixed inset-0 -z-10">
          <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-purple-950/20 to-slate-950" />
          <motion.div 
            className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/30 rounded-full blur-3xl"
            animate={{ 
              scale: [1, 1.2, 1],
              opacity: [0.3, 0.5, 0.3],
            }}
            transition={{ duration: 8, repeat: Infinity }}
          />
          <motion.div 
            className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-pink-500/20 rounded-full blur-3xl"
            animate={{ 
              scale: [1.2, 1, 1.2],
              opacity: [0.2, 0.4, 0.2],
            }}
            transition={{ duration: 10, repeat: Infinity }}
          />
          <motion.div 
            className="absolute top-1/2 right-1/3 w-64 h-64 bg-blue-500/20 rounded-full blur-3xl"
            animate={{ 
              scale: [1, 1.3, 1],
              x: [0, 50, 0],
            }}
            transition={{ duration: 12, repeat: Infinity }}
          />
        </div>

        {/* Navigation */}
        <motion.nav 
          initial={{ y: -100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6 }}
          className="fixed top-0 left-0 right-0 z-50 bg-slate-950/80 backdrop-blur-xl border-b border-white/10"
        >
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <motion.div 
              className="text-2xl font-bold tracking-tight"
              whileHover={{ scale: 1.05 }}
            >
              <span className="skalr-gradient-text">Skalr</span>
              <span className="text-white">.co</span>
            </motion.div>
            <div className="hidden md:flex items-center gap-8">
              {['Méthode', 'Offres', 'Résultats', 'FAQ'].map((item) => (
                <motion.a 
                  key={item}
                  href={`#${item.toLowerCase()}`} 
                  className="text-sm text-slate-400 hover:text-white transition-colors relative group"
                  whileHover={{ y: -2 }}
                >
                  {item}
                  <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-gradient-to-r from-purple-500 to-pink-500 group-hover:w-full transition-all duration-300" />
                </motion.a>
              ))}
            </div>
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Button className="rounded-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 border-0 shadow-lg shadow-purple-500/25">
                Audit gratuit <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </motion.div>
          </div>
        </motion.nav>

        {/* Hero Section */}
        <section className="pt-40 pb-20 px-6 relative">
          <div className="max-w-6xl mx-auto">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div>
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6 }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/30 text-sm font-medium mb-8"
                >
                  <Sparkles className="h-4 w-4 text-purple-400" />
                  <span className="text-purple-300">Studio d'innovation talent</span>
                </motion.div>
                
                <motion.h1 
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.1 }}
                  className="text-5xl md:text-7xl font-bold tracking-tight mb-6 leading-[1.1]"
                >
                  Transformez votre{' '}
                  <span className="skalr-gradient-text">recrutement</span>
                  {' '}en levier de croissance
                </motion.h1>
                
                <motion.p 
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                  className="text-xl text-slate-400 mb-10"
                >
                  Nous aidons les startups et scale-ups à recruter plus efficacement, plus rapidement 
                  et avec un meilleur taux de succès.
                </motion.p>
                
                <motion.div 
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.3 }}
                  className="flex flex-col sm:flex-row items-start gap-4"
                >
                  <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                    <Button size="lg" className="rounded-full px-8 h-14 text-lg bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 border-0 shadow-xl shadow-purple-500/25">
                      Réserver un audit gratuit <ArrowRight className="ml-2 h-5 w-5" />
                    </Button>
                  </motion.div>
                  <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                    <Button size="lg" variant="outline" className="rounded-full px-8 h-14 text-lg border-white/20 bg-white/5 hover:bg-white/10 text-white">
                      Découvrir la méthode
                    </Button>
                  </motion.div>
                </motion.div>

                <motion.p 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                  className="mt-6 text-sm text-slate-500"
                >
                  Audit gratuit • Sans engagement • Résultats garantis
                </motion.p>
              </div>

              {/* Interactive Feature Pills */}
              <motion.div 
                initial={{ opacity: 0, x: 50 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.8, delay: 0.3 }}
                className="hidden lg:block relative"
              >
                <div className="relative p-8 rounded-3xl bg-gradient-to-br from-white/5 to-white/0 border border-white/10 backdrop-blur-sm">
                  <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-purple-500/10 to-pink-500/10" />
                  
                  <div className="relative space-y-4">
                    <p className="text-xs uppercase tracking-wider text-slate-500 mb-6">
                      Customisez votre accompagnement
                    </p>
                    
                    <div className="flex flex-wrap gap-3">
                      {features.map((feature, index) => (
                        <motion.button
                          key={feature.name}
                          onClick={() => setActiveFeature(index)}
                          className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium transition-all ${
                            activeFeature === index
                              ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/25'
                              : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white border border-white/10'
                          }`}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                        >
                          <feature.icon className="h-4 w-4" />
                          {feature.name}
                        </motion.button>
                      ))}
                    </div>

                    <motion.div 
                      key={activeFeature}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-8 p-6 rounded-2xl bg-white/5 border border-white/10"
                    >
                      <div className="flex items-center gap-3 mb-3">
                        <div className="p-2 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500">
                          {(() => {
                            const Icon = features[activeFeature].icon;
                            return <Icon className="h-5 w-5 text-white" />;
                          })()}
                        </div>
                        <h3 className="font-semibold text-white">{features[activeFeature].name}</h3>
                      </div>
                      <p className="text-sm text-slate-400">
                        Optimisez votre processus de recrutement avec notre module {features[activeFeature].name.toLowerCase()}.
                      </p>
                    </motion.div>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Clients/Partners Section */}
        <section className="py-16 px-6 border-y border-white/10">
          <div className="max-w-6xl mx-auto">
            <motion.p 
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="text-center text-sm text-slate-500 uppercase tracking-wider mb-10"
            >
              Ils nous ont fait confiance
            </motion.p>
            <motion.div 
              variants={containerVariants}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              className="flex flex-wrap items-center justify-center gap-8 md:gap-16"
            >
              {companies.map((company) => (
                <motion.div
                  key={company}
                  variants={itemVariants}
                  whileHover={{ scale: 1.1, color: '#fff' }}
                  className="text-2xl md:text-3xl font-bold text-slate-600 hover:text-white transition-colors cursor-default"
                >
                  {company}
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* Stats Section */}
        <section className="py-24 px-6">
          <div className="max-w-6xl mx-auto">
            <motion.div 
              variants={containerVariants}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-100px" }}
              className="grid grid-cols-2 md:grid-cols-4 gap-8"
            >
              {stats.map((stat, index) => (
                <motion.div 
                  key={index}
                  variants={itemVariants}
                  whileHover={{ scale: 1.05, y: -5 }}
                  className="text-center p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm hover:border-purple-500/50 transition-colors"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    whileInView={{ scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ type: "spring", delay: index * 0.1 }}
                    className="w-12 h-12 mx-auto mb-4 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center"
                  >
                    <stat.icon className="h-6 w-6 text-white" />
                  </motion.div>
                  <div className="text-4xl md:text-5xl font-bold skalr-gradient-text mb-2">{stat.value}</div>
                  <div className="text-sm text-slate-400">{stat.label}</div>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* Pillars Section */}
        <section id="methode" className="py-24 px-6">
          <div className="max-w-6xl mx-auto">
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              className="text-center mb-16"
            >
              <h2 className="text-4xl md:text-5xl font-bold mb-6">
                Notre méthode en <span className="skalr-gradient-text">3 piliers</span>
              </h2>
              <p className="text-lg text-slate-400 max-w-2xl mx-auto">
                Une approche systémique éprouvée sur plus de 150 startups pour transformer 
                votre recrutement d'un centre de coût en avantage compétitif.
              </p>
            </motion.div>

            <div className="grid md:grid-cols-3 gap-8">
              {pillars.map((pillar, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 40 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ duration: 0.5, delay: index * 0.15 }}
                  whileHover={{ y: -10 }}
                  className="group"
                >
                  <div className="relative p-8 rounded-3xl bg-white/5 border border-white/10 backdrop-blur-sm h-full hover:border-purple-500/50 transition-all duration-300 skalr-card-glow">
                    <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-purple-500/5 to-pink-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    
                    <motion.div 
                      whileHover={{ scale: 1.1, rotate: 5 }}
                      transition={{ type: "spring", stiffness: 300 }}
                      className={`relative w-16 h-16 rounded-2xl bg-gradient-to-r ${pillar.color} flex items-center justify-center mb-6 shadow-lg`}
                    >
                      <pillar.icon className="h-8 w-8 text-white" />
                    </motion.div>
                    
                    <h3 className="relative text-xl font-bold text-white mb-3">{pillar.title}</h3>
                    <p className="relative text-slate-400">{pillar.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section id="offres" className="py-24 px-6 relative">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-purple-950/10 to-transparent" />
          
          <div className="max-w-6xl mx-auto relative">
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              className="text-center mb-16"
            >
              <h2 className="text-4xl md:text-5xl font-bold mb-6">
                Nos packs <span className="skalr-gradient-text">d'accompagnement</span>
              </h2>
              <p className="text-lg text-slate-400 max-w-2xl mx-auto">
                Choisissez le niveau d'accompagnement adapté à vos besoins et à votre maturité recrutement.
              </p>
            </motion.div>

            <div className="grid md:grid-cols-3 gap-8">
              {packs.map((pack, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 50 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ duration: 0.5, delay: index * 0.15 }}
                  whileHover={{ y: -10 }}
                  className={`relative ${pack.highlight ? 'md:-mt-4 md:mb-4' : ''}`}
                >
                  {pack.highlight && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.8 }}
                      whileInView={{ opacity: 1, scale: 1 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.4, delay: 0.3 }}
                      className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-medium rounded-full z-10 shadow-lg shadow-purple-500/25"
                    >
                      <span className="flex items-center gap-1">
                        <Star className="h-3 w-3" /> Recommandé
                      </span>
                    </motion.div>
                  )}
                  
                  <div className={`relative p-8 rounded-3xl backdrop-blur-sm h-full transition-all duration-300 ${
                    pack.highlight 
                      ? 'bg-gradient-to-b from-purple-500/20 to-pink-500/10 border-2 border-purple-500/50 shadow-2xl shadow-purple-500/20' 
                      : 'bg-white/5 border border-white/10 hover:border-purple-500/30'
                  }`}>
                    <div className="mb-6">
                      <h3 className="text-2xl font-bold text-white mb-2">{pack.name}</h3>
                      <p className="text-slate-400 text-sm">{pack.description}</p>
                    </div>
                    
                    <div className="mb-6">
                      <span className="text-5xl font-bold text-white">{pack.price}</span>
                      <span className="text-slate-400 ml-2">€ HT</span>
                    </div>
                    
                    <div className="flex items-center gap-2 text-sm text-slate-500 mb-8">
                      <Clock className="h-4 w-4" />
                      {pack.duration}
                    </div>

                    <ul className="space-y-4 mb-8">
                      {pack.features.map((feature, i) => (
                        <motion.li 
                          key={i}
                          initial={{ opacity: 0, x: -10 }}
                          whileInView={{ opacity: 1, x: 0 }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.3, delay: 0.4 + i * 0.05 }}
                          className="flex items-start gap-3"
                        >
                          <div className={`p-1 rounded-full bg-gradient-to-r ${pack.gradient}`}>
                            <Check className="h-3 w-3 text-white" />
                          </div>
                          <span className="text-sm text-slate-300">{feature}</span>
                        </motion.li>
                      ))}
                    </ul>

                    <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                      <Button 
                        className={`w-full rounded-full h-12 ${
                          pack.highlight 
                            ? 'bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white border-0 shadow-lg shadow-purple-500/25' 
                            : 'bg-white/10 hover:bg-white/20 text-white border border-white/20'
                        }`}
                      >
                        Choisir {pack.name}
                      </Button>
                    </motion.div>
                  </div>
                </motion.div>
              ))}
            </div>

            <motion.p 
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.5 }}
              className="text-center text-sm text-slate-500 mt-12"
            >
              Sessions Expert à la carte également disponibles (490€ - 1 490€ HT)
            </motion.p>
          </div>
        </section>

        {/* Results Section */}
        <section id="resultats" className="py-24 px-6">
          <div className="max-w-6xl mx-auto">
            <div className="grid md:grid-cols-2 gap-16 items-center">
              <motion.div
                initial={{ opacity: 0, x: -50 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.6 }}
              >
                <h2 className="text-4xl md:text-5xl font-bold mb-6">
                  <span className="skalr-gradient-text">8 ans</span> d'expérience au service de la French Tech
                </h2>
                <p className="text-lg text-slate-400 mb-10">
                  Depuis 2016, nous accompagnons les plus belles startups françaises dans leurs défis de recrutement. 
                  Notre méthodologie a été construite et affinée sur le terrain.
                </p>

                <div className="space-y-6">
                  {[
                    { icon: TrendingUp, title: "Réduction des coûts", desc: "-40% sur les coûts de recrutement externes", color: "from-green-500 to-emerald-400" },
                    { icon: Calendar, title: "Time-to-hire optimisé", desc: "De 40 jours à 28 jours en moyenne", color: "from-blue-500 to-cyan-400" },
                    { icon: Users, title: "Qualité des recrutements", desc: "85% de succès en période d'essai", color: "from-purple-500 to-pink-500" },
                  ].map((item, index) => (
                    <motion.div 
                      key={index}
                      initial={{ opacity: 0, x: -20 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.4, delay: 0.2 + index * 0.1 }}
                      whileHover={{ x: 10 }}
                      className="flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 hover:border-purple-500/30 transition-all"
                    >
                      <motion.div 
                        whileHover={{ scale: 1.1, rotate: 5 }}
                        className={`w-14 h-14 rounded-xl bg-gradient-to-r ${item.color} flex items-center justify-center shadow-lg`}
                      >
                        <item.icon className="h-7 w-7 text-white" />
                      </motion.div>
                      <div>
                        <div className="font-semibold text-white">{item.title}</div>
                        <div className="text-sm text-slate-400">{item.desc}</div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>

              <motion.div 
                initial={{ opacity: 0, x: 50 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.6, delay: 0.2 }}
                className="relative"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-pink-500/20 rounded-3xl blur-xl" />
                <div className="relative bg-gradient-to-br from-white/10 to-white/5 border border-white/20 rounded-3xl p-8 md:p-12 backdrop-blur-sm">
                  <div className="absolute top-6 right-6">
                    <motion.div 
                      animate={{ rotate: 360 }}
                      transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                      className="text-4xl"
                    >
                      ✨
                    </motion.div>
                  </div>
                  
                  <blockquote className="text-xl md:text-2xl font-medium text-white mb-8 leading-relaxed">
                    "Skalr nous a permis de structurer notre recrutement pour supporter notre croissance de 0 à 50 collaborateurs en 18 mois."
                  </blockquote>
                  
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-lg">
                      A
                    </div>
                    <div>
                      <div className="font-semibold text-white">CEO, Scale-up Tech</div>
                      <div className="text-sm text-slate-400">Série B - 20M€</div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section id="faq" className="py-24 px-6 relative">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-purple-950/10 to-transparent" />
          
          <div className="max-w-3xl mx-auto relative">
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-16"
            >
              <h2 className="text-4xl md:text-5xl font-bold mb-6">
                Questions <span className="skalr-gradient-text">fréquentes</span>
              </h2>
            </motion.div>

            <div className="space-y-4">
              {faqs.map((faq, index) => (
                <motion.div 
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden hover:border-purple-500/30 transition-colors"
                >
                  <motion.button
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                    className="w-full px-6 py-5 flex items-center justify-between text-left"
                    whileHover={{ backgroundColor: 'rgba(255,255,255,0.02)' }}
                  >
                    <span className="font-medium text-white">{faq.question}</span>
                    <motion.div
                      animate={{ rotate: openFaq === index ? 180 : 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <ChevronDown className="h-5 w-5 text-slate-400" />
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
                        <div className="px-6 pb-5 text-slate-400">
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
        <section className="py-24 px-6 relative">
          <div className="absolute inset-0">
            <div className="absolute inset-0 bg-gradient-to-r from-purple-600/20 via-pink-600/20 to-purple-600/20" />
            <motion.div 
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-purple-500/30 rounded-full blur-3xl"
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ duration: 8, repeat: Infinity }}
            />
          </div>
          
          <motion.div 
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            className="max-w-4xl mx-auto text-center relative"
          >
            <h2 className="text-4xl md:text-6xl font-bold mb-6">
              Prêt à transformer votre <span className="skalr-gradient-text">recrutement</span> ?
            </h2>
            <p className="text-xl text-slate-400 mb-10">
              Réservez un audit gratuit de 30 minutes pour identifier vos opportunités d'optimisation.
            </p>
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.98 }}
            >
              <Button size="lg" className="rounded-full px-12 h-16 text-lg bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 border-0 shadow-2xl shadow-purple-500/30">
                Réserver mon audit gratuit <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </motion.div>
          </motion.div>
        </section>

        {/* Footer */}
        <footer className="py-12 px-6 border-t border-white/10">
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
            <motion.div 
              className="text-2xl font-bold tracking-tight"
              whileHover={{ scale: 1.05 }}
            >
              <span className="skalr-gradient-text">Skalr</span>
              <span className="text-white">.co</span>
            </motion.div>
            <div className="flex items-center gap-6 text-sm text-slate-500">
              <a href="#" className="hover:text-white transition-colors">Mentions légales</a>
              <a href="#" className="hover:text-white transition-colors">Politique de confidentialité</a>
              <a href="#" className="hover:text-white transition-colors">Contact</a>
            </div>
            <div className="text-sm text-slate-500">
              © 2025 Skalr.co — Studio d'innovation talent
            </div>
          </div>
        </footer>
      </div>
    </>
  );
};

export default SkalrLanding;
