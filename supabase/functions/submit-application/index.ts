// submit-application : retirée (C1, R2).
// Plus aucun appelant depuis le 06/09 (formulaire ApplicationModal supprimé par
// le lot de nettoyage 255c7798) ; ni l'extension ni une autre fonction ne
// l'appellent. L'ancienne version était publique, écrivait dans le Notion de la
// plateforme et journalisait nom, e-mail et téléphone.
// Ce gestionnaire ne lit ni la requête ni l'environnement et ne journalise
// rien. Il reste en place jusqu'à `supabase functions delete submit-application`,
// après quoi le dossier et sa section de config.toml quittent le dépôt.
Deno.serve(() =>
  new Response(JSON.stringify({ error: "gone" }), {
    status: 410,
    headers: { "Content-Type": "application/json" },
  })
);
