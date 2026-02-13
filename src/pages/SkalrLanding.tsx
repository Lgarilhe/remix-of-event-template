import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useInView } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { 
  Search, Brain, Send, MessageSquare, LayoutGrid, 
  ArrowRight, Check, Linkedin, Shield, Zap, 
  ChevronDown, X, Mail, Loader2, Users, Briefcase, Building2
} from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import heroVideo from '@/assets/hero-video.mp4';

const CALENDLY_URL = 'https://calendly.com/demo/30min';

// Animated counter component
const AnimatedStat = ({ value, suffix = '' }: { value: string; suffix?: string }) => {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true });
  
  return (
    <div ref={ref}>
      <motion.span
        initial={{ opacity: 0, y: 20 }}
        animate={isInView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="text-6xl md:text-7xl font-bold skalr-gradient-text"
      >
        {value}{suffix}
      </motion.span>
    </div>
  );
};

const SkalrLanding = () => {
  const navigate = useNavigate();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [showCalendly, setShowCalendly] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [contactForm, setContactForm] = useState({ name: '', email: '', company: '', message: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!contactForm.name.trim() || !contactForm.email.trim() || !contactForm.message.trim()) {
      toast({ title: "Erreur", description: "Veuillez remplir tous les champs obligatoires.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('contact_submissions').insert({
        name: contactForm.name.trim(),
        email: contactForm.email.trim(),
        company: contactForm.company.trim() || null,
        message: contactForm.message.trim(),
      });

      if (error) throw error;

      try {
        const notionResponse = await supabase.functions.invoke('notify-notion', {
          body: {
            name: contactForm.name.trim(),
            email: contactForm.email.trim(),
            company: contactForm.company.trim() || null,
            message: contactForm.message.trim(),
          },
        });
        
        if (notionResponse.error) {
          console.warn('Notion sync failed:', notionResponse.error);
        }
      } catch (notionError) {
        console.warn('Notion sync error (non-blocking):', notionError);
      }

      toast({ title: "Message envoyé !", description: "Nous vous recontacterons très vite." });
      setContactForm({ name: '', email: '', company: '', message: '' });
      setShowContact(false);
    } catch (error) {
      console.error('Contact form error:', error);
      toast({ title: "Erreur", description: "Une erreur est survenue. Veuillez réessayer.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  const steps = [
    {
      num: '01',
      icon: Search,
      title: 'Trouvez les bons profils',
      description: 'Recherche LinkedIn avancée avec filtres par poste, expérience, école, localisation. Identifiez les meilleurs talents en quelques clics.',
    },
    {
      num: '02',
      icon: Brain,
      title: "Qualifiez avec l'IA",
      description: "Scoring automatique de chaque profil par rapport à vos offres. L'IA analyse les compétences, l'expérience et la compatibilité.",
    },
    {
      num: '03',
      icon: Send,
      title: 'Engagez en automatique',
      description: "Séquences d'InMails et messages personnalisés par l'IA. Relances automatiques, horaires optimisés, A/B testing intégré.",
    },
    {
      num: '04',
      icon: MessageSquare,
      title: 'Centralisez les échanges',
      description: 'Inbox unifiée pour gérer toutes vos conversations candidats. Suggestions de réponses par IA, suivi des interactions.',
    },
    {
      num: '05',
      icon: LayoutGrid,
      title: "Suivez dans l'ATS",
      description: 'Pipeline kanban avec statuts automatiques, timeline complète et notes collaboratives. Tout votre recrutement en un seul endroit.',
    },
  ];

  const personas = [
    {
      id: 'recruiter',
      label: 'Recruteur interne',
      icon: Users,
      title: 'Automatisez le sourcing, concentrez-vous sur les entretiens',
      description: "Libérez-vous des tâches répétitives. Skalr trouve et contacte les candidats pour vous, pendant que vous vous concentrez sur l'évaluation et les entretiens.",
      benefits: [
        'Sourcing LinkedIn automatisé',
        'Séquences de messages personnalisées',
        'Pipeline candidats en temps réel',
        'Scoring IA pour prioriser les profils',
      ],
    },
    {
      id: 'ta',
      label: 'Talent Acquisition',
      icon: Briefcase,
      title: 'Vue complète du pipeline, métriques et reporting',
      description: "Pilotez votre stratégie de recrutement avec des données précises. Suivez les performances de vos séquences, analysez vos taux de conversion et optimisez en continu.",
      benefits: [
        'Dashboard avec KPIs en temps réel',
        'Analyse des taux de réponse par séquence',
        'Gestion multi-postes centralisée',
        'Historique complet des interactions',
      ],
    },
    {
      id: 'founder',
      label: 'Fondateur',
      icon: Zap,
      title: "Recrutez vos premiers talents sans passer par une agence",
      description: "Vous n'avez pas de budget pour un cabinet ? Skalr vous donne les outils pour recruter comme un pro, même sans équipe RH dédiée.",
      benefits: [
        'Interface simple, prise en main rapide',
        "Messages générés par l'IA",
        'Coût 10x inférieur à un cabinet',
        'Résultats dès la première semaine',
      ],
    },
    {
      id: 'agency',
      label: 'Cabinet de recrutement',
      icon: Building2,
      title: 'Gérez plusieurs mandats et centralisez vos candidats',
      description: "Multipliez vos mandats sans multiplier vos efforts. Organisez vos recherches par projet, centralisez vos viviers et automatisez vos approches.",
      benefits: [
        'Projets de sourcing par mandat',
        'Vivier de candidats partagé',
        'Séquences réutilisables',
        'Suivi client intégré',
      ],
    },
  ];

  const stats = [
    { value: 'x3', label: 'profils contactés par semaine' },
    { value: '-60%', label: 'temps de sourcing' },
    { value: '+80%', label: 'taux de réponse avec les séquences IA' },
  ];

  const faqs = [
    {
      question: 'Comment ça marche ?',
      answer: "Connectez votre compte LinkedIn via notre intégration sécurisée, configurez vos filtres de recherche, et laissez Skalr trouver, scorer et contacter les meilleurs profils pour vous. Tout est centralisé dans votre dashboard.",
    },
    {
      question: 'Mon compte LinkedIn est-il en sécurité ?',
      answer: "Absolument. Nous utilisons des connexions sécurisées et respectons les limites de LinkedIn. Vos identifiants sont chiffrés et ne sont jamais stockés en clair. Des milliers de recruteurs utilisent Skalr sans aucun problème.",
    },
    {
      question: "Combien de messages puis-je envoyer ?",
      answer: "Cela dépend de votre abonnement LinkedIn (InMail) et de votre plan Skalr. Nous optimisons automatiquement le volume et les horaires d'envoi pour maximiser vos taux de réponse tout en respectant les limites.",
    },
    {
      question: "C'est gratuit ?",
      answer: "Skalr propose un essai gratuit pour découvrir la plateforme. Ensuite, nos plans sont adaptés à la taille de votre équipe et à vos besoins. Commencez gratuitement et upgradez quand vous êtes prêt.",
    },
  ];

  const heroBadges = [
    { icon: Search, label: 'Sourcing IA' },
    { icon: Zap, label: 'Séquences auto' },
    { icon: LayoutGrid, label: 'ATS intégré' },
  ];

  return (
    <>
      <SEOHead 
        title="Skalr - Plateforme de recrutement tout-en-un"
        description="Trouvez, engagez et recrutez vos meilleurs talents. Sourcing LinkedIn, séquences automatisées et suivi candidat en une seule plateforme."
        keywords="recrutement saas, sourcing linkedin, ats, sequences automatisées, talent acquisition, outil recrutement"
      />
      
      <div className="min-h-screen bg-zinc-950 text-white">
        
        {/* ===== HERO ===== */}
        <section className="relative min-h-screen overflow-hidden">
          {/* Video background */}
          <div className="absolute inset-0">
            <video autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover">
              <source src={heroVideo} type="video/mp4" />
            </video>
            <div className="absolute inset-0 bg-black/60" />
            <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-zinc-950" />
          </div>

          {/* Navigation */}
          <nav className="relative z-20 px-6 py-5">
            <div className="max-w-6xl mx-auto flex items-center justify-between">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xl font-semibold text-white">
                skalr<span className="text-zinc-500">.</span>
              </motion.div>
              
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="hidden md:flex items-center gap-8">
                {[
                  { label: 'Fonctionnalités', id: 'features' },
                  { label: 'Comment ça marche', id: 'how' },
                  { label: 'Résultats', id: 'results' },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => scrollToSection(item.id)}
                    className="text-sm text-zinc-400 hover:text-white transition-colors"
                  >
                    {item.label}
                  </button>
                ))}
              </motion.div>

              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="flex items-center gap-3">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowCalendly(true)}
                  className="text-zinc-300 hover:text-white hover:bg-white/10 rounded-full px-4"
                >
                  Réserver une démo
                </Button>
                <Button 
                  size="sm"
                  onClick={() => navigate('/auth')}
                  className="rounded-full bg-white text-zinc-900 hover:bg-zinc-100 font-medium px-5"
                >
                  Commencer gratuitement
                </Button>
              </motion.div>
            </div>
          </nav>

          {/* Hero Content */}
          <div className="relative z-10 flex items-center min-h-[calc(100vh-80px)] px-6">
            <div className="max-w-6xl mx-auto w-full">
              <div className="max-w-3xl mx-auto text-center">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6 }}
                  className="mb-6"
                >
                  <span className="inline-flex items-center gap-2 text-sm text-zinc-400 font-medium border border-zinc-700 rounded-full px-4 py-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Plateforme de recrutement tout-en-un
                  </span>
                </motion.div>

                <motion.h1
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.1 }}
                  className="text-5xl md:text-6xl lg:text-7xl font-bold text-white tracking-tight leading-[1.05] mb-6"
                >
                  Trouvez, engagez et recrutez{' '}
                  <span className="skalr-gradient-text">vos meilleurs talents</span>
                </motion.h1>

                <motion.p
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                  className="text-lg md:text-xl text-zinc-400 max-w-2xl mx-auto mb-10 leading-relaxed"
                >
                  La plateforme tout-en-un qui combine sourcing LinkedIn, 
                  séquences automatisées et suivi candidat.
                </motion.p>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.3 }}
                  className="flex flex-wrap justify-center gap-4 mb-12"
                >
                  <Button 
                    size="lg"
                    onClick={() => navigate('/auth')}
                    className="rounded-full skalr-gradient-bg text-white hover:opacity-90 font-medium px-8 h-13 text-base border-0"
                  >
                    Commencer gratuitement
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                  
                  <Button 
                    size="lg"
                    variant="outline"
                    onClick={() => scrollToSection('how')}
                    className="rounded-full border-zinc-600 text-white hover:bg-white/10 font-medium px-8 h-13 text-base"
                  >
                    Voir comment ça marche
                  </Button>
                </motion.div>

                {/* Badges */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.4 }}
                  className="flex flex-wrap justify-center gap-3"
                >
                  {heroBadges.map((badge, i) => (
                    <div key={i} className="flex items-center gap-2 bg-white/5 border border-zinc-700/50 rounded-full px-4 py-2 text-sm text-zinc-300">
                      <badge.icon className="h-4 w-4 text-zinc-400" />
                      {badge.label}
                    </div>
                  ))}
                </motion.div>
              </div>
            </div>
          </div>
        </section>

        {/* ===== FEATURES / STEPS (style Zeliq) ===== */}
        <section id="features" className="py-28 px-6">
          <div className="max-w-6xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-20"
            >
              <span className="text-sm font-medium skalr-gradient-text uppercase tracking-widest mb-4 block">
                Fonctionnalités
              </span>
              <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-5">
                Tout ce dont vous avez besoin
              </h2>
              <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
                Du sourcing à l'embauche, chaque étape est couverte par un outil pensé pour les recruteurs.
              </p>
            </motion.div>

            <div className="space-y-6">
              {steps.map((step, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.08 }}
                  className="group relative flex items-start gap-6 md:gap-10 p-6 md:p-8 rounded-2xl bg-zinc-900/50 border border-zinc-800/50 hover:border-zinc-700 hover:bg-zinc-900 transition-all"
                >
                  {/* Number */}
                  <div className="flex-shrink-0">
                    <span className="text-3xl md:text-4xl font-bold text-zinc-700 group-hover:skalr-gradient-text transition-all">
                      {step.num}
                    </span>
                  </div>

                  {/* Icon */}
                  <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center group-hover:border-zinc-600 transition-colors">
                    <step.icon className="h-5 w-5 text-zinc-400 group-hover:text-white transition-colors" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xl md:text-2xl font-semibold mb-2">{step.title}</h3>
                    <p className="text-zinc-400 leading-relaxed max-w-2xl">{step.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ===== HOW / PERSONAS (style Zeliq tabs) ===== */}
        <section id="how" className="py-28 px-6 bg-zinc-900/50">
          <div className="max-w-6xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-16"
            >
              <span className="text-sm font-medium skalr-gradient-text uppercase tracking-widest mb-4 block">
                Pour toutes les équipes
              </span>
              <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-5">
                Adapté à votre rôle
              </h2>
              <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
                Que vous soyez recruteur, fondateur ou cabinet, Skalr s'adapte à vos besoins.
              </p>
            </motion.div>

            <Tabs defaultValue="recruiter" className="w-full">
              <TabsList className="w-full max-w-2xl mx-auto grid grid-cols-2 md:grid-cols-4 bg-zinc-800/50 border border-zinc-700 rounded-xl p-1 mb-12 h-auto">
                {personas.map((persona) => (
                  <TabsTrigger
                    key={persona.id}
                    value={persona.id}
                    className="rounded-lg py-3 text-sm data-[state=active]:bg-zinc-700 data-[state=active]:text-white text-zinc-400 transition-all"
                  >
                    <persona.icon className="h-4 w-4 mr-2" />
                    <span className="hidden sm:inline">{persona.label}</span>
                    <span className="sm:hidden">{persona.label.split(' ')[0]}</span>
                  </TabsTrigger>
                ))}
              </TabsList>

              {personas.map((persona) => (
                <TabsContent key={persona.id} value={persona.id}>
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                    className="grid md:grid-cols-2 gap-10 items-center"
                  >
                    <div>
                      <h3 className="text-3xl md:text-4xl font-bold mb-4">{persona.title}</h3>
                      <p className="text-zinc-400 text-lg leading-relaxed mb-8">{persona.description}</p>
                      
                      <ul className="space-y-4 mb-8">
                        {persona.benefits.map((benefit, i) => (
                          <li key={i} className="flex items-center gap-3">
                            <div className="w-6 h-6 rounded-full skalr-gradient-bg flex items-center justify-center flex-shrink-0">
                              <Check className="h-3.5 w-3.5 text-white" />
                            </div>
                            <span className="text-zinc-300">{benefit}</span>
                          </li>
                        ))}
                      </ul>

                      <Button 
                        onClick={() => navigate('/auth')}
                        className="rounded-full skalr-gradient-bg text-white hover:opacity-90 font-medium px-6 border-0"
                      >
                        Essayer gratuitement
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </div>

                    {/* Visual placeholder */}
                    <div className="relative">
                      <div className="aspect-[4/3] rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-900 border border-zinc-700 flex items-center justify-center overflow-hidden">
                        <div className="text-center p-8">
                          <persona.icon className="h-16 w-16 text-zinc-600 mx-auto mb-4" />
                          <p className="text-zinc-500 text-sm">{persona.label}</p>
                        </div>
                      </div>
                      {/* Glow effect */}
                      <div className="absolute -inset-4 bg-gradient-to-r from-purple-500/10 via-pink-500/10 to-blue-500/10 rounded-3xl blur-2xl -z-10" />
                    </div>
                  </motion.div>
                </TabsContent>
              ))}
            </Tabs>
          </div>
        </section>

        {/* ===== RESULTS / STATS ===== */}
        <section id="results" className="py-28 px-6">
          <div className="max-w-6xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-20"
            >
              <span className="text-sm font-medium skalr-gradient-text uppercase tracking-widest mb-4 block">
                Résultats
              </span>
              <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-5">
                Des résultats concrets
              </h2>
              <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
                Les équipes qui utilisent Skalr transforment leur recrutement.
              </p>
            </motion.div>

            <div className="grid md:grid-cols-3 gap-8">
              {stats.map((stat, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.15 }}
                  className="text-center p-10 rounded-2xl bg-zinc-900/50 border border-zinc-800/50"
                >
                  <AnimatedStat value={stat.value} />
                  <p className="text-zinc-400 mt-4 text-lg">{stat.label}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ===== TESTIMONIAL ===== */}
        <section className="py-20 px-6 bg-zinc-900/50">
          <div className="max-w-4xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center"
            >
              <div className="p-10 md:p-14 rounded-2xl border border-zinc-800/50 bg-zinc-900/30">
                <p className="text-2xl md:text-3xl font-medium leading-relaxed mb-8 text-zinc-200">
                  "Skalr a transformé notre façon de recruter. On contacte 3x plus de candidats qualifiés, 
                  et notre taux de réponse a explosé grâce aux séquences IA."
                </p>
                <div className="flex items-center justify-center gap-4">
                  <div className="w-12 h-12 rounded-full skalr-gradient-bg flex items-center justify-center text-white font-semibold">
                    T
                  </div>
                  <div className="text-left">
                    <div className="font-medium text-white">Head of Talent, Scale-up Tech</div>
                    <div className="text-sm text-zinc-500">Équipe de 80 personnes</div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* ===== FAQ ===== */}
        <section className="py-28 px-6">
          <div className="max-w-2xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-14"
            >
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
                Questions fréquentes
              </h2>
            </motion.div>

            <div className="space-y-3">
              {faqs.map((faq, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.05 }}
                  className="bg-zinc-900/50 rounded-xl border border-zinc-800/50 overflow-hidden"
                >
                  <button
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                    className="w-full p-5 flex items-center justify-between text-left hover:bg-zinc-800/30 transition-colors"
                  >
                    <span className="font-medium pr-4 text-zinc-200">{faq.question}</span>
                    <ChevronDown 
                      className={`h-5 w-5 text-zinc-500 shrink-0 transition-transform duration-200 ${
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
                        <div className="px-5 pb-5 text-zinc-400 leading-relaxed">
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

        {/* ===== CTA FINAL ===== */}
        <section className="py-28 px-6 relative overflow-hidden">
          {/* Background glow */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-[600px] h-[600px] bg-gradient-to-r from-purple-500/10 via-pink-500/10 to-blue-500/10 rounded-full blur-3xl" />
          </div>
          
          <div className="max-w-3xl mx-auto text-center relative z-10">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
                Vos prochains talents{' '}
                <span className="skalr-gradient-text">vous attendent</span>
              </h2>
              <p className="text-lg text-zinc-400 mb-10 max-w-xl mx-auto">
                Rejoignez les équipes qui recrutent mieux, plus vite et à moindre coût avec Skalr.
              </p>
              <div className="flex flex-wrap justify-center gap-4">
                <Button 
                  size="lg"
                  onClick={() => navigate('/auth')}
                  className="rounded-full skalr-gradient-bg text-white hover:opacity-90 font-medium px-10 h-14 text-lg border-0"
                >
                  Commencer gratuitement
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
                <Button 
                  size="lg"
                  variant="outline"
                  onClick={() => setShowCalendly(true)}
                  className="rounded-full border-zinc-600 text-white hover:bg-white/10 font-medium px-8 h-14 text-lg"
                >
                  Réserver une démo
                </Button>
              </div>
            </motion.div>
          </div>
        </section>

        {/* ===== FOOTER ===== */}
        <footer className="py-10 px-6 border-t border-zinc-800">
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
            <span className="text-lg font-semibold text-white">
              skalr<span className="text-zinc-600">.</span>
            </span>
            <div className="flex items-center gap-6 text-sm text-zinc-500">
              <a href="#" className="hover:text-zinc-300 transition-colors">Mentions légales</a>
              <a href="#" className="hover:text-zinc-300 transition-colors">Confidentialité</a>
              <button onClick={() => setShowContact(true)} className="hover:text-zinc-300 transition-colors">Contact</button>
            </div>
            <span className="text-sm text-zinc-500">© 2025 Skalr</span>
          </div>
        </footer>

        {/* ===== CALENDLY MODAL ===== */}
        <AnimatePresence>
          {showCalendly && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowCalendly(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-3xl h-[80vh] bg-white rounded-2xl overflow-hidden shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => setShowCalendly(false)}
                  className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-zinc-100 hover:bg-zinc-200 flex items-center justify-center transition-colors"
                >
                  <X className="h-5 w-5 text-zinc-600" />
                </button>
                
                <iframe
                  src={CALENDLY_URL}
                  className="w-full h-full border-0"
                  title="Réserver une démo"
                />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ===== CONTACT FORM MODAL ===== */}
        <AnimatePresence>
          {showContact && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowContact(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl p-8"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => setShowContact(false)}
                  className="absolute top-4 right-4 w-10 h-10 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center transition-colors"
                >
                  <X className="h-5 w-5 text-zinc-400" />
                </button>

                <h3 className="text-2xl font-semibold text-white mb-2">Nous contacter</h3>
                <p className="text-zinc-400 mb-6">Laissez-nous un message, nous revenons vers vous rapidement.</p>

                <form onSubmit={handleContactSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-zinc-300 mb-1">Nom *</label>
                      <Input
                        value={contactForm.name}
                        onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                        placeholder="Votre nom"
                        className="rounded-lg bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-zinc-300 mb-1">Email *</label>
                      <Input
                        type="email"
                        value={contactForm.email}
                        onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                        placeholder="vous@entreprise.com"
                        className="rounded-lg bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
                        required
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-1">Entreprise</label>
                    <Input
                      value={contactForm.company}
                      onChange={(e) => setContactForm({ ...contactForm, company: e.target.value })}
                      placeholder="Nom de votre entreprise"
                      className="rounded-lg bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-1">Message *</label>
                    <Textarea
                      value={contactForm.message}
                      onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })}
                      placeholder="Comment pouvons-nous vous aider ?"
                      className="rounded-lg min-h-[120px] bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
                      required
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full rounded-full skalr-gradient-bg text-white hover:opacity-90 h-12 font-medium border-0"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Envoi en cours...
                      </>
                    ) : (
                      <>
                        Envoyer le message
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
};

export default SkalrLanding;
