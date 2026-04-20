---
description: "Tester un flow avec les 4 personas Konekt avant merge. Utiliser après /build, avant /ship."
---

# /qa — Test avec les 4 personas Konekt

Laurent n'est pas développeur. Tu testes pour lui. Ne rends pas la main tant que les 4 personas passent.

## Protocole

1. Identifier le flow à tester (feature du ticket ou scope du dernier /build).
2. Pour chaque persona : scénario → exécution Playwright MCP ou manuelle → verdict pass/fail.
3. Rapport final : tableau 4 lignes, un verdict par persona, liste des bugs ouverts.
4. Si un persona fail : corriger ou créer un ticket. Jamais ignorer.

## Les 4 personas

### 1. Guillaume — Power-user recruteur (Konekt interne)

- **Profil** : recruteur senior, utilise la plateforme 8h/jour, tous les features, raccourcis clavier.
- **Attentes** : vitesse, densité d'info, pas de clic inutile, bulk actions, export, filtres avancés.
- **Test** : sourcer 20 candidats, créer une séquence, envoyer, suivre les réponses, shortlister, envoyer au client. Chrono < 10 min.
- **Fail si** : latence > 500ms sur une action courante, pas de raccourci clavier, pas de bulk, besoin de recharger la page.

### 2. Claire — DRH occasionnelle (client final)

- **Profil** : DRH PME, se connecte 2–3 fois par semaine, n'a pas envie d'apprendre.
- **Attentes** : clarté, un seul chemin évident, jamais de jargon technique, aide contextuelle.
- **Test** : ouvre une mission, lit une shortlist, note un candidat, planifie un entretien via le chatbot scorecard. Aucune doc lue.
- **Fail si** : elle hésite plus de 3 secondes sur une action, elle voit un terme technique (RLS, webhook, edge function, JSON...), elle doit scroller pour trouver l'action primaire.

### 3. Théo — Edge-case technique

- **Profil** : teste volontairement les limites, casse les choses.
- **Attentes** : aucune, il veut trouver les bugs.
- **Test** : 
  - champs vides, champs > 10K caractères, emojis, caractères RTL, SQL injection dans les filtres
  - double-clic sur submit, offline au milieu d'une séquence, token expiré, quota Unipile dépassé
  - multi-tenant : tentative d'accès à des données d'un autre tenant via URL
  - concurrent : 2 users modifient le même candidat en même temps
- **Fail si** : erreur 500 silencieuse, fuite de données cross-tenant, état incohérent, rollback impossible.

### 4. Sophie — Freelance mobile-first

- **Profil** : freelance recruteuse, 80% du temps sur mobile (train, client, terrasse).
- **Attentes** : tout doit marcher sur iPhone 13 en portrait, connexion 4G moyenne, au clavier tactile.
- **Test** : lit une mission assignée, qualifie 5 candidats, envoie 3 messages, prend une note vocale (Deepgram). Tout sur mobile.
- **Fail si** : un élément déborde, un clic est à < 44px, le clavier masque l'input actif, la voix ne fonctionne pas, le chargement dépasse 3s en 4G.

## Format du rapport

```
| Persona   | Scénario                  | Verdict | Bugs                    |
|-----------|---------------------------|---------|-------------------------|
| Guillaume | Sourcing bulk 20 candidats | PASS    | —                       |
| Claire    | Scorecard entretien        | FAIL    | Terme "webhook" visible |
| Théo      | Multi-tenant URL forging   | PASS    | —                       |
| Sophie    | Mobile 4G qualif 5 cand    | FAIL    | Bouton 32px sur mobile  |
```

Si un FAIL → listé dans LOGBOOK.md avec statut, assigné, priorité.

## Quand utiliser Playwright MCP vs manuel

- **Playwright** : scénarios reproductibles, régression, Guillaume et Théo (scriptables).
- **Manuel / screenshot DevTools mobile** : Claire (UX, ambiguïté) et Sophie (mobile, voix, clavier).

## Ne jamais skipper

- Si une feature touche à la sécurité ou au multi-tenant → Théo obligatoire, pas de raccourci.
- Si une feature est dans un flow client final → Claire obligatoire.
- Si une feature ajoute un champ ou une action → les 4 obligatoires.
