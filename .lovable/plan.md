
# Refonte Landing Page SaaS - Style Zeliq

## Objectif
Reecrire completement `src/pages/SkalrLanding.tsx` pour presenter Skalr comme une plateforme SaaS de recrutement, en s'inspirant du storytelling et de la structure de Zeliq.

## Structure de la nouvelle page

### 1. Navigation
- Logo "skalr."
- Liens : Fonctionnalites, Comment ca marche, Resultats
- Bouton "Commencer gratuitement" qui redirige vers `/auth`
- Bouton "Reserver une demo" qui ouvre le modal Calendly (conserve)

### 2. Hero (fond sombre + video de fond conservee)
- Titre large et impactant : **"Trouvez, engagez et recrutez vos meilleurs talents"**
- Sous-titre : "La plateforme tout-en-un qui combine sourcing LinkedIn, sequences automatisees et suivi candidat."
- 2 CTA : "Commencer gratuitement" (vers /auth) + "Voir comment ca marche" (scroll)
- Badges en bas du hero : "Sourcing IA", "Sequences auto", "ATS integre"

### 3. Section "Tout ce dont vous avez besoin" (etapes numerotees, style Zeliq)
5 blocs numerotes avec icone, titre et description :
1. **Trouvez les bons profils** - Recherche LinkedIn avancee avec filtres (poste, experience, ecole, localisation)
2. **Qualifiez avec l'IA** - Scoring automatique de chaque profil par rapport a vos offres
3. **Engagez en automatique** - Sequences d'InMails et messages personnalises par l'IA
4. **Centralisez les echanges** - Inbox unifiee pour gerer toutes vos conversations candidats
5. **Suivez dans l'ATS** - Pipeline kanban avec statuts automatiques et timeline complete

### 4. Section "Pour toutes les equipes" (onglets par persona, style Zeliq)
Composant Tabs avec 4 onglets :
- **Recruteur interne** : Automatisez le sourcing, concentrez-vous sur les entretiens
- **Talent Acquisition** : Vue complete du pipeline, metriques et reporting
- **Fondateur** : Recrutez vos premiers talents sans passer par une agence
- **Cabinet de recrutement** : Gerez plusieurs mandats et centralisez vos candidats

### 5. Section "Resultats concrets" (stats impact)
3 gros chiffres animes :
- **x3** profils contactes par semaine
- **-60%** temps de sourcing
- **+80%** taux de reponse avec les sequences IA

### 6. Section Temoignage (conserve et adapte)
Citation adaptee au produit SaaS

### 7. FAQ (adaptee au SaaS)
- Comment ca marche ?
- Mon compte LinkedIn est-il en securite ?
- Combien de messages puis-je envoyer ?
- C'est gratuit ?

### 8. CTA Final (fond sombre)
"Vos prochains talents vous attendent" + boutons vers /auth et Calendly

### 9. Footer (conserve)

## Elements conserves tels quels
- Modal Calendly (logique + iframe)
- Modal Contact (formulaire + envoi base de donnees + Notion)
- Video de fond hero
- SEOHead (meta tags mis a jour pour le SaaS)
- Animations framer-motion

## Details techniques

### Fichier modifie
- `src/pages/SkalrLanding.tsx` : reecriture complete

### Ajout de `useNavigate`
Import de `useNavigate` depuis `react-router-dom` pour les redirections vers `/auth`

### Composants utilises
- `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` pour la section personas
- `Button` pour tous les CTA
- `motion` de framer-motion pour les animations au scroll
- Icones lucide-react : `Search`, `Brain`, `Send`, `MessageSquare`, `LayoutGrid`, `ArrowRight`, `Check`, `Linkedin`, `Shield`, `Zap`

### Aucune nouvelle dependance
Tout est deja installe dans le projet
