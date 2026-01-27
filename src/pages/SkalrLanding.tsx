import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Check, ArrowRight, Users, Target, Zap, TrendingUp, Calendar, Clock, ChevronDown, Play } from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';

const SkalrLanding = () => {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const packs = [
    {
      name: 'Starter',
      price: '7 000',
      duration: '4-6 semaines',
      description: 'Cadrage rapide',
      features: ['Audit processus', 'Quick wins', 'Plan d\'action', 'Account Manager'],
      highlight: false,
    },
    {
      name: 'Booster',
      price: '11 990',
      duration: '8 semaines',
      description: 'Design & mise en route',
      features: ['Inclut Starter', 'Design funnel', 'Premiers outils', 'Automatisations', 'Lives experts'],
      highlight: true,
    },
    {
      name: 'Scale',
      price: '15 990',
      duration: '12-16 semaines',
      description: 'Déploiement complet',
      features: ['Inclut Booster', 'Documentation', 'Transfert compétences', 'Autonomisation', 'Support étendu'],
      highlight: false,
    },
  ];

  const stats = [
    { value: '30%', label: 'Time-to-hire réduit' },
    { value: '2x', label: 'Candidatures qualifiées' },
    { value: '85%', label: 'Succès période d\'essai' },
    { value: '150+', label: 'Startups accompagnées' },
  ];

  const pillars = [
    { icon: Target, title: 'Roadmapping', description: 'Vision stratégique 12-24 mois' },
    { icon: Users, title: 'Attraction', description: 'Proposition de valeur unique' },
    { icon: Zap, title: 'Process', description: 'Automatisation & scale' },
  ];

  const faqs = [
    { question: 'Différence avec un cabinet de recrutement ?', answer: 'Nous ne recrutons pas. Nous transformons votre fonction recrutement en levier de croissance.' },
    { question: 'Durée d\'accompagnement ?', answer: 'De 4 semaines (Starter) à 16 semaines (Scale).' },
    { question: 'Pour qui ?', answer: 'Startups en hypercroissance, scale-ups, ETI innovantes.' },
    { question: 'Quels résultats ?', answer: '-30% time-to-hire, 2x candidatures qualifiées, 85% succès.' },
  ];

  const companies = ['Ledger', 'PayFit', 'Lydia', 'Qonto', 'Alan', 'Swile'];

  return (
    <>
      <SEOHead 
        title="Skalr - Transformez votre recrutement"
        description="Studio d'innovation talent pour startups et scale-ups."
        keywords="recrutement startup, talent acquisition"
      />
      
      <div className="min-h-screen bg-white text-zinc-900">
        {/* Hero with video-like effect */}
        <section className="relative min-h-screen overflow-hidden bg-zinc-950">
          {/* Animated gradient mesh background */}
          <div className="absolute inset-0">
            {/* Base gradient */}
            <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black" />
            
            {/* Animated color blobs - simulating video feel */}
            <motion.div
              className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full opacity-40"
              style={{ background: 'radial-gradient(circle, #7c3aed 0%, transparent 70%)' }}
              animate={{
                x: [0, 100, 50, 0],
                y: [0, 50, 100, 0],
                scale: [1, 1.2, 0.9, 1],
              }}
              transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className="absolute top-[20%] right-[-10%] w-[50%] h-[50%] rounded-full opacity-30"
              style={{ background: 'radial-gradient(circle, #ec4899 0%, transparent 70%)' }}
              animate={{
                x: [0, -80, -40, 0],
                y: [0, 80, 40, 0],
                scale: [1, 0.9, 1.1, 1],
              }}
              transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className="absolute bottom-[-10%] left-[30%] w-[40%] h-[40%] rounded-full opacity-30"
              style={{ background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)' }}
              animate={{
                x: [0, 60, -30, 0],
                y: [0, -60, 30, 0],
                scale: [1, 1.1, 0.95, 1],
              }}
              transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
            />
            
            {/* Noise overlay for video texture */}
            <div 
              className="absolute inset-0 opacity-[0.03]"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
              }}
            />
            
            {/* Subtle scan lines */}
            <div 
              className="absolute inset-0 opacity-[0.02]"
              style={{
                backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)',
              }}
            />
          </div>

          {/* Navigation */}
          <nav className="relative z-20 px-6 py-5">
            <div className="max-w-6xl mx-auto flex items-center justify-between">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-xl font-semibold text-white"
              >
                skalr<span className="text-zinc-500">.</span>
              </motion.div>
              
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.1 }}
                className="hidden md:flex items-center gap-8"
              >
                {['Méthode', 'Offres', 'Résultats'].map((item) => (
                  <a 
                    key={item}
                    href={`#${item.toLowerCase()}`} 
                    className="text-sm text-zinc-400 hover:text-white transition-colors"
                  >
                    {item}
                  </a>
                ))}
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
              >
                <Button 
                  size="sm"
                  className="rounded-full bg-white text-zinc-900 hover:bg-zinc-100 font-medium px-5"
                >
                  Prendre RDV
                </Button>
              </motion.div>
            </div>
          </nav>

          {/* Hero Content */}
          <div className="relative z-10 flex items-center min-h-[calc(100vh-80px)] px-6">
            <div className="max-w-6xl mx-auto w-full">
              <div className="max-w-3xl">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6 }}
                  className="mb-6"
                >
                  <span className="inline-flex items-center gap-2 text-sm text-zinc-400 font-medium">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Studio d'innovation talent
                  </span>
                </motion.div>

                <motion.h1
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.1 }}
                  className="text-5xl md:text-7xl lg:text-8xl font-medium text-white tracking-tight leading-[0.95] mb-8"
                >
                  Recrutez
                  <br />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 via-fuchsia-400 to-pink-400">
                    comme une
                  </span>
                  <br />
                  scale-up
                </motion.h1>

                <motion.p
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                  className="text-lg md:text-xl text-zinc-400 max-w-xl mb-10 leading-relaxed"
                >
                  Méthodologies sur-mesure pour recruter plus vite, 
                  mieux, et à moindre coût.
                </motion.p>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.3 }}
                  className="flex flex-wrap gap-4"
                >
                  <Button 
                    size="lg"
                    className="rounded-full bg-white text-zinc-900 hover:bg-zinc-100 font-medium px-8 h-12 text-base"
                  >
                    Audit gratuit
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                  
                  <Button 
                    size="lg"
                    variant="ghost"
                    className="rounded-full text-white hover:bg-white/10 font-medium px-6 h-12 text-base group"
                  >
                    <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center mr-2 group-hover:bg-white/20 transition-colors">
                      <Play className="h-3 w-3 text-white fill-white" />
                    </div>
                    Voir la démo
                  </Button>
                </motion.div>
              </div>

              {/* Stats row at bottom */}
              <motion.div
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.5 }}
                className="absolute bottom-12 left-6 right-6"
              >
                <div className="max-w-6xl mx-auto">
                  <div className="flex flex-wrap gap-12 md:gap-16">
                    {stats.map((stat, i) => (
                      <div key={i} className="group">
                        <div className="text-3xl md:text-4xl font-medium text-white mb-1">
                          {stat.value}
                        </div>
                        <div className="text-sm text-zinc-500">
                          {stat.label}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Clients */}
        <section className="py-16 px-6 border-b border-zinc-100">
          <div className="max-w-6xl mx-auto">
            <p className="text-xs uppercase tracking-widest text-zinc-400 mb-8 text-center">
              Ils nous font confiance
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-6">
              {companies.map((company) => (
                <span 
                  key={company}
                  className="text-2xl font-semibold text-zinc-200 hover:text-zinc-400 transition-colors cursor-default"
                >
                  {company}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* Method */}
        <section id="méthode" className="py-24 px-6">
          <div className="max-w-6xl mx-auto">
            <div className="max-w-2xl mb-16">
              <p className="text-sm font-medium text-violet-600 mb-3">Méthode</p>
              <h2 className="text-4xl md:text-5xl font-medium tracking-tight mb-4">
                3 piliers pour scaler
              </h2>
              <p className="text-lg text-zinc-500">
                Une approche éprouvée sur 150+ startups.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              {pillars.map((pillar, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="group p-8 rounded-2xl bg-zinc-50 hover:bg-zinc-100 transition-colors"
                >
                  <div className="w-12 h-12 rounded-xl bg-white border border-zinc-200 flex items-center justify-center mb-6 group-hover:border-violet-200 group-hover:bg-violet-50 transition-colors">
                    <pillar.icon className="h-5 w-5 text-zinc-600 group-hover:text-violet-600 transition-colors" />
                  </div>
                  <h3 className="text-xl font-medium mb-2">{pillar.title}</h3>
                  <p className="text-zinc-500">{pillar.description}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="offres" className="py-24 px-6 bg-zinc-50">
          <div className="max-w-6xl mx-auto">
            <div className="max-w-2xl mb-16">
              <p className="text-sm font-medium text-violet-600 mb-3">Offres</p>
              <h2 className="text-4xl md:text-5xl font-medium tracking-tight mb-4">
                Choisissez votre pack
              </h2>
              <p className="text-lg text-zinc-500">
                Adapté à votre maturité recrutement.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              {packs.map((pack, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className={`relative p-8 rounded-2xl ${
                    pack.highlight 
                      ? 'bg-zinc-900 text-white' 
                      : 'bg-white border border-zinc-200'
                  }`}
                >
                  {pack.highlight && (
                    <div className="absolute -top-3 left-8">
                      <span className="px-3 py-1 text-xs font-medium bg-violet-500 text-white rounded-full">
                        Populaire
                      </span>
                    </div>
                  )}
                  
                  <div className="mb-6">
                    <h3 className="text-xl font-medium mb-1">{pack.name}</h3>
                    <p className={pack.highlight ? 'text-zinc-400' : 'text-zinc-500'}>
                      {pack.description}
                    </p>
                  </div>
                  
                  <div className="mb-6">
                    <span className="text-4xl font-medium">{pack.price}€</span>
                    <span className={pack.highlight ? 'text-zinc-400' : 'text-zinc-500'}> HT</span>
                  </div>
                  
                  <div className={`flex items-center gap-2 text-sm mb-8 pb-6 border-b ${
                    pack.highlight ? 'text-zinc-400 border-zinc-800' : 'text-zinc-500 border-zinc-100'
                  }`}>
                    <Clock className="h-4 w-4" />
                    {pack.duration}
                  </div>

                  <ul className="space-y-3 mb-8">
                    {pack.features.map((feature, i) => (
                      <li key={i} className="flex items-center gap-3 text-sm">
                        <Check className={`h-4 w-4 ${pack.highlight ? 'text-violet-400' : 'text-violet-600'}`} />
                        <span className={pack.highlight ? 'text-zinc-300' : 'text-zinc-600'}>
                          {feature}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <Button 
                    className={`w-full rounded-full h-11 font-medium ${
                      pack.highlight 
                        ? 'bg-white text-zinc-900 hover:bg-zinc-100' 
                        : 'bg-zinc-900 text-white hover:bg-zinc-800'
                    }`}
                  >
                    Choisir {pack.name}
                  </Button>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Results */}
        <section id="résultats" className="py-24 px-6">
          <div className="max-w-6xl mx-auto">
            <div className="grid md:grid-cols-2 gap-16 items-center">
              <div>
                <p className="text-sm font-medium text-violet-600 mb-3">Résultats</p>
                <h2 className="text-4xl md:text-5xl font-medium tracking-tight mb-6">
                  8 ans d'expertise
                </h2>
                <p className="text-lg text-zinc-500 mb-10">
                  Méthodologie construite sur le terrain avec 150+ entreprises innovantes.
                </p>

                <div className="space-y-4">
                  {[
                    { icon: TrendingUp, label: '-40% coûts recrutement' },
                    { icon: Calendar, label: '28 jours time-to-hire moyen' },
                    { icon: Users, label: '85% succès période d\'essai' },
                  ].map((item, i) => (
                    <motion.div 
                      key={i}
                      initial={{ opacity: 0, x: -20 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.1 }}
                      className="flex items-center gap-4 p-4 rounded-xl bg-zinc-50"
                    >
                      <div className="w-10 h-10 rounded-lg bg-white border border-zinc-200 flex items-center justify-center">
                        <item.icon className="h-5 w-5 text-zinc-600" />
                      </div>
                      <span className="font-medium">{item.label}</span>
                    </motion.div>
                  ))}
                </div>
              </div>

              <motion.div
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="relative"
              >
                <div className="p-10 rounded-2xl bg-zinc-900 text-white">
                  <p className="text-2xl font-medium leading-relaxed mb-8">
                    "Skalr nous a permis de passer de 0 à 50 collaborateurs en 18 mois."
                  </p>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-white font-medium">
                      A
                    </div>
                    <div>
                      <div className="font-medium">CEO, Scale-up Tech</div>
                      <div className="text-sm text-zinc-400">Série B — 20M€</div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-24 px-6 bg-zinc-50">
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-medium tracking-tight">
                Questions fréquentes
              </h2>
            </div>

            <div className="space-y-3">
              {faqs.map((faq, index) => (
                <div 
                  key={index}
                  className="bg-white rounded-xl border border-zinc-200 overflow-hidden"
                >
                  <button
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                    className="w-full p-5 flex items-center justify-between text-left hover:bg-zinc-50 transition-colors"
                  >
                    <span className="font-medium pr-4">{faq.question}</span>
                    <ChevronDown 
                      className={`h-5 w-5 text-zinc-400 shrink-0 transition-transform ${
                        openFaq === index ? 'rotate-180' : ''
                      }`} 
                    />
                  </button>
                  
                  <AnimatePresence>
                    {openFaq === index && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: 'auto' }}
                        exit={{ height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="px-5 pb-5 text-zinc-500">
                          {faq.answer}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-24 px-6 bg-zinc-900">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-4xl md:text-5xl font-medium text-white tracking-tight mb-6">
              Prêt à transformer
              <br />
              votre recrutement ?
            </h2>
            <p className="text-lg text-zinc-400 mb-10">
              Audit gratuit de 30 minutes • Sans engagement
            </p>
            <Button 
              size="lg"
              className="rounded-full bg-white text-zinc-900 hover:bg-zinc-100 font-medium px-10 h-14 text-lg"
            >
              Réserver mon audit
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-10 px-6 border-t border-zinc-100">
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
            <span className="text-lg font-semibold text-zinc-900">
              skalr<span className="text-zinc-300">.</span>
            </span>
            <div className="flex items-center gap-6 text-sm text-zinc-400">
              <a href="#" className="hover:text-zinc-600 transition-colors">Mentions légales</a>
              <a href="#" className="hover:text-zinc-600 transition-colors">Confidentialité</a>
              <a href="#" className="hover:text-zinc-600 transition-colors">Contact</a>
            </div>
            <span className="text-sm text-zinc-400">© 2025 Skalr</span>
          </div>
        </footer>
      </div>
    </>
  );
};

export default SkalrLanding;
