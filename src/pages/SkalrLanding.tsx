import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, ArrowRight, Users, Target, Zap, TrendingUp, Calendar, Clock, Star, ChevronDown } from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';

const SkalrLanding = () => {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

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
    },
  ];

  const stats = [
    { value: '30%', label: 'Réduction du time-to-hire' },
    { value: '2x', label: 'Plus de candidatures qualifiées' },
    { value: '85%', label: 'Taux de succès en période d\'essai' },
    { value: '150+', label: 'Startups accompagnées' },
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

  return (
    <>
      <SEOHead 
        title="Skalr - Transformez votre recrutement en levier de croissance"
        description="Studio d'innovation talent pour startups et scale-ups. Méthodologies sur-mesure pour recruter plus efficacement, plus rapidement et avec un meilleur taux de succès."
        keywords="recrutement startup, talent acquisition, RH scale-up, recrutement tech, méthodologie recrutement"
      />
      
      <div className="min-h-screen bg-background">
        {/* Navigation */}
        <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="text-2xl font-bold tracking-tight">
              Skalr<span className="text-primary">.</span>co
            </div>
            <div className="hidden md:flex items-center gap-8">
              <a href="#methode" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Méthode</a>
              <a href="#offres" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Offres</a>
              <a href="#resultats" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Résultats</a>
              <a href="#faq" className="text-sm text-muted-foreground hover:text-foreground transition-colors">FAQ</a>
            </div>
            <Button className="rounded-full">
              Audit gratuit <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </nav>

        {/* Hero Section */}
        <section className="pt-32 pb-20 px-6">
          <div className="max-w-5xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-8">
              <Star className="h-4 w-4" />
              Studio d'innovation talent
            </div>
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 leading-[1.1]">
              Transformez votre recrutement en{' '}
              <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                levier de croissance
              </span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto mb-10">
              Nous aidons les startups et scale-ups à recruter plus efficacement, plus rapidement 
              et avec un meilleur taux de succès grâce à des méthodologies sur-mesure.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button size="lg" className="rounded-full px-8 h-14 text-lg">
                Réserver un audit gratuit <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
              <Button size="lg" variant="outline" className="rounded-full px-8 h-14 text-lg">
                Découvrir la méthode
              </Button>
            </div>
          </div>
        </section>

        {/* Stats Section */}
        <section className="py-16 px-6 bg-muted/50">
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              {stats.map((stat, index) => (
                <div key={index} className="text-center">
                  <div className="text-4xl md:text-5xl font-bold text-primary mb-2">{stat.value}</div>
                  <div className="text-sm text-muted-foreground">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pillars Section */}
        <section id="methode" className="py-24 px-6">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">Notre méthode en 3 piliers</h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Une approche systémique éprouvée sur plus de 150 startups pour transformer 
                votre recrutement d'un centre de coût en avantage compétitif.
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              {pillars.map((pillar, index) => (
                <Card key={index} className="border-2 hover:border-primary/50 transition-colors">
                  <CardHeader>
                    <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                      <pillar.icon className="h-7 w-7 text-primary" />
                    </div>
                    <CardTitle className="text-xl">{pillar.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-base">{pillar.description}</CardDescription>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section id="offres" className="py-24 px-6 bg-muted/50">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">Nos packs d'accompagnement</h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Choisissez le niveau d'accompagnement adapté à vos besoins et à votre maturité recrutement.
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              {packs.map((pack, index) => (
                <Card 
                  key={index} 
                  className={`relative ${pack.highlight ? 'border-primary border-2 shadow-lg scale-105' : 'border-2'}`}
                >
                  {pack.highlight && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-primary text-primary-foreground text-sm font-medium rounded-full">
                      Recommandé
                    </div>
                  )}
                  <CardHeader className="pb-4">
                    <CardTitle className="text-2xl">{pack.name}</CardTitle>
                    <CardDescription>{pack.description}</CardDescription>
                    <div className="pt-4">
                      <span className="text-4xl font-bold">{pack.price} €</span>
                      <span className="text-muted-foreground ml-2">HT</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground pt-2">
                      <Clock className="h-4 w-4" />
                      {pack.duration}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ul className="space-y-3">
                      {pack.features.map((feature, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <Check className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                          <span className="text-sm">{feature}</span>
                        </li>
                      ))}
                    </ul>
                    <Button 
                      className={`w-full rounded-full ${pack.highlight ? '' : 'variant-outline'}`}
                      variant={pack.highlight ? 'default' : 'outline'}
                    >
                      Choisir {pack.name}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="text-center text-sm text-muted-foreground mt-8">
              Sessions Expert à la carte également disponibles (490€ - 1 490€ HT)
            </p>
          </div>
        </section>

        {/* Results Section */}
        <section id="resultats" className="py-24 px-6">
          <div className="max-w-6xl mx-auto">
            <div className="grid md:grid-cols-2 gap-16 items-center">
              <div>
                <h2 className="text-3xl md:text-4xl font-bold mb-6">
                  8 ans d'expérience au service de la French Tech
                </h2>
                <p className="text-lg text-muted-foreground mb-8">
                  Depuis 2016, nous accompagnons les plus belles startups françaises dans leurs défis de recrutement. 
                  Notre méthodologie a été construite et affinée sur le terrain, avec plus de 150 entreprises innovantes.
                </p>
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <TrendingUp className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <div className="font-semibold">Réduction des coûts</div>
                      <div className="text-sm text-muted-foreground">-40% sur les coûts de recrutement externes</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <Calendar className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <div className="font-semibold">Time-to-hire optimisé</div>
                      <div className="text-sm text-muted-foreground">De 40 jours à 28 jours en moyenne</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <Users className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <div className="font-semibold">Qualité des recrutements</div>
                      <div className="text-sm text-muted-foreground">85% de succès en période d'essai</div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gradient-to-br from-primary/20 to-primary/5 rounded-3xl p-8 md:p-12">
                <blockquote className="text-xl md:text-2xl font-medium mb-6">
                  "Skalr nous a permis de structurer notre recrutement pour supporter notre croissance de 0 à 50 collaborateurs en 18 mois."
                </blockquote>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-primary/20"></div>
                  <div>
                    <div className="font-semibold">CEO, Scale-up Tech</div>
                    <div className="text-sm text-muted-foreground">Série B - 20M€</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section id="faq" className="py-24 px-6 bg-muted/50">
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">Questions fréquentes</h2>
            </div>
            <div className="space-y-4">
              {faqs.map((faq, index) => (
                <div 
                  key={index}
                  className="bg-background rounded-xl border border-border overflow-hidden"
                >
                  <button
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                    className="w-full px-6 py-5 flex items-center justify-between text-left"
                  >
                    <span className="font-medium">{faq.question}</span>
                    <ChevronDown 
                      className={`h-5 w-5 text-muted-foreground transition-transform ${
                        openFaq === index ? 'rotate-180' : ''
                      }`} 
                    />
                  </button>
                  {openFaq === index && (
                    <div className="px-6 pb-5 text-muted-foreground">
                      {faq.answer}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-24 px-6">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl md:text-5xl font-bold mb-6">
              Prêt à transformer votre recrutement ?
            </h2>
            <p className="text-xl text-muted-foreground mb-10">
              Réservez un audit gratuit de 30 minutes pour identifier vos opportunités d'optimisation.
            </p>
            <Button size="lg" className="rounded-full px-10 h-16 text-lg">
              Réserver mon audit gratuit <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-12 px-6 border-t border-border">
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="text-2xl font-bold tracking-tight">
              Skalr<span className="text-primary">.</span>co
            </div>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <a href="#" className="hover:text-foreground transition-colors">Mentions légales</a>
              <a href="#" className="hover:text-foreground transition-colors">Politique de confidentialité</a>
              <a href="#" className="hover:text-foreground transition-colors">Contact</a>
            </div>
            <div className="text-sm text-muted-foreground">
              © 2025 Skalr.co — Studio d'innovation talent
            </div>
          </div>
        </footer>
      </div>
    </>
  );
};

export default SkalrLanding;
