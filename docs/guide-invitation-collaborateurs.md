# Guide rapide — Inviter tes collaborateurs (test ce soir)

**Date** : 2026-04-28
**Prérequis** : tu es admin/owner de l'org Konekt en prod

---

## 🚀 Étape 1 — Tu invites un collaborateur (30 secondes)

1. Va sur **https://konekt-app-navy.vercel.app/settings?tab=team**
2. Clique sur le formulaire d'invitation en bas de la liste des membres
3. Tape l'email du collaborateur
4. Choisis le rôle :
   - **Admin** : peut inviter d'autres, modifier rôles, accéder à la facturation
   - **Membre** ⭐ recommandé pour tes recruteurs internes — peut tout faire sauf inviter
   - **Collaborateur externe** : utile pour freelances temporaires (ne voit pas le formulaire d'invitation)
5. Clique "Inviter"
6. ✅ Email envoyé via Resend automatiquement

---

## 📧 Étape 2 — Le collaborateur reçoit l'email

L'email arrive avec un bouton/lien type :
```
https://konekt-app-navy.vercel.app/auth?invitation=xxxxx
```

Le collaborateur clique → arrive sur la page Auth (signup/signin).

⚠️ **IMPORTANT** : il **DOIT** s'inscrire avec **exactement le même email** que celui que tu as invité (case-insensitive mais pas d'alias `+`). Sinon `accept-invitation` refuse avec "Cette invitation ne correspond pas à votre adresse email".

---

## 👤 Étape 3 — Le collaborateur signup

1. Sur la page Auth, il choisit "Créer un compte"
2. Email pré-rempli (ou à taper, identique)
3. Mot de passe au choix
4. Submit
5. ✅ Auto-acceptation de l'invitation après le signup
6. Redirigé vers **`/settings`** (page collaborator welcome)

---

## 🔗 Étape 4 — Connecter son LinkedIn (le plus critique)

Dans Settings, le collaborateur va sur l'onglet **"Mon compte LinkedIn"** :

1. Clique **"Connecter mon compte LinkedIn"**
2. Une nouvelle fenêtre s'ouvre (Unipile hosted auth)
3. Sur cette page, il colle son **cookie `li_at`** (instructions affichées dans la fenêtre, ~7 étapes)
4. Submit
5. **Retour automatique** dans Konekt — la connexion est détectée en ~10 secondes (auto-poll)
6. Toast vert : *"Compte LinkedIn connecté avec succès !"*

**Si ça ne marche pas** :
- Pop-up bloqué (iOS Safari) → autoriser les pop-ups Konekt OU ouvrir le lien manuellement
- Cookie li_at invalide → re-tenter avec un nouveau cookie depuis LinkedIn
- Pas de toast après 3 min → cliquer "Rafraîchir les comptes" manuellement

📚 Tutoriel cookie li_at intégré dans la fenêtre Unipile (7 étapes guidées).

---

## 🎯 Étape 5 — Lancer le sourcing

1. Aller sur **Missions** (sidebar)
2. Voir les missions créées par toi (Laurent) → RLS org-wide partage tout
3. Cliquer sur une mission → onglet **Sourcing**
4. La recherche utilise SON propre compte LinkedIn (mapping member_linkedin_accounts)
5. Lancer une recherche → résultats apparaissent
6. Sélectionner profils → Score (consomme crédits IA partagés org)
7. Pipe / Pipeline / etc.

---

## ⚠️ Limitations connues (à mentionner aux collaborateurs)

1. **Quota LinkedIn** : chaque user a son propre quota Recruiter (~30 InMails/jour, ~100 searches/jour selon plan LinkedIn)
2. **Crédits Konekt** : partagés entre toute l'org → si quelqu'un brûle 500 crédits IA, tout le monde est bloqué. Quota individuel enrichment : 100/mois par user (configurable via SQL editor pour l'instant, pas d'UI)
3. **Pop-up bloqué** : sur iOS Safari, autoriser les pop-ups OU dire au collaborateur d'utiliser Chrome desktop
4. **Email invitation** : strict match — si typo dans l'invitation, recommencer

---

## 🐛 Si problème

- **Logs Supabase** : https://supabase.com/dashboard/project/crckfywoyjxkawathdff/functions
- Les fonctions à surveiller : `send-team-invitation`, `accept-invitation`, `unipile-webhook`
- Le webhook `account_connected` doit logger : `[unipile-webhook] Upserted via hosted_auth for user X org Y`

---

## ✅ Checklist avant de lancer le test ce soir

- [ ] Vercel a redéployé le frontend (commit `ce matin` + auto-deploy ~2 min)
- [ ] Edge function `unipile-webhook` est bien déployée avec le fix multi-user (déjà OK depuis 2026-04-23)
- [ ] Tu as au moins une mission test créée pour qu'ils aient quelque chose à voir
- [ ] Tu as un solde crédits Konekt > 100 pour qu'ils puissent tester scoring + enrichment
- [ ] Tu as ton compte LinkedIn déjà connecté (pour test côté admin)

---

## 🎯 Scénario recommandé pour le test pilote

**5 minutes max pour valider end-to-end** :
1. Tu invites 1 collaborateur en mode "Admin" (toi peux voir ce qu'il fait)
2. Il signup + connecte LinkedIn
3. Tu lui crée une mission test "Test - DevOps Senior Paris"
4. Il ouvre la mission → onglet Sourcing → lance recherche "DevOps" Paris
5. Il sélectionne 5 profils → clique Score
6. Il bouge 1 profil dans Pipeline → "Pressenti"
7. Il clique sur "Récupérer email/téléphone" sur 1 profil → confirme

Si tout ça fonctionne en 5 min sans bug → tu peux inviter le reste de l'équipe sereinement.
