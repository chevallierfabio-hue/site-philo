# FicheÉclair — Document de projet

> **Note pour Claude** : ce document est lu automatiquement par Claude Code à
> chaque session, et fourni en tête de chaque nouvelle conversation
> stratégique sur claude.ai. Il a deux parties : une partie **stable**
> (identité, vision, stack, conventions) qui change rarement, et une partie
> **vivante** (état actuel, roadmap) à mettre à jour à chaque fin de mission.

---

# PARTIE STABLE

## Identité du projet

FicheÉclair n'est pas un générateur de fiches isolées, c'est un **transformateur
de cours en environnement de révision complet**. Un étudiant uploade
progressivement les chapitres de son cours universitaire (en photo ou en PDF).
Pour chaque chapitre, une fiche structurée est générée. À mesure que le cours
s'enrichit, des outils de révision (QCM, cartes, entraînement, dissertation,
ressources, mini-jeu) s'adaptent automatiquement au contenu accumulé.

L'unité naturelle d'étude est le **cours**, pas la fiche isolée. Une fiche est
un fragment de contenu qu'on ajoute à un cours. Les outils opèrent au niveau
du cours et se mettent à jour quand on lui ajoute une fiche.

## Cible

Étudiants en sciences humaines : philosophie, classes prépa littéraire et B/L,
masters de lettres et de philosophie. Les outils existants (NotebookLM,
Mindgrasp) sont génériques et conçus pour les sciences. FicheÉclair est
spécifiquement conçu pour les disciplines littéraires (problématiques, enjeux,
controverses, notions, citations).

## Auteur

Étudiant en master de philosophie, pas développeur. Bagage technique :
HTML/CSS basique au départ, expérience de code généré par IA, a appris
récemment Git, VS Code, Cursor/Claude Code, déploiement Cloudflare.

## Stack technique

- **Frontend** : HTML/CSS/JS vanilla, tout dans `index.html` (~5500 lignes),
  servi par un Worker Cloudflare nommé `site-philo` (déploiement auto depuis
  GitHub à chaque push sur `main`).
- **Backend** : trois Workers Cloudflare distincts.
  - `site-philo` : sert le HTML statique. Lié au repo GitHub
    `chevallierfabio-hue/site-philo`.
  - `claude-proxy` : proxy authentifié vers l'API Anthropic, utilisé par la
    fonctionnalité Disserter. Édité directement dans l'interface Cloudflare
    (pas dans le repo Git).
  - `ficheeclair-api` : Worker dédié à FicheÉclair. Endpoint
    `POST /generate-fiche` authentifié par JWT Supabase, avec quota
    journalier, qui appelle Claude Vision pour générer une fiche structurée
    et l'insérer dans Supabase. Code dans le sous-dossier `ficheeclair-api/`
    du repo, déployé automatiquement.
- **Base de données** : Supabase. Tables actuelles :
  - `scores` : classements QCM et Pong (avec RLS)
  - `sr_data` : données de répétition espacée pour l'entraînement
  - `fiches` : fiches générées (avec RLS, colonnes id/user_id/created_at/
    titre/discipline/contenu jsonb/cours_id)
  - `cours` : cours regroupant les fiches (avec RLS, colonnes id/user_id/
    titre/discipline/niveau/description/created_at/updated_at)
- **API IA** : API Anthropic. Modèle Sonnet 4.6 (`claude-sonnet-4-6`) pour
  les fiches et les dissertations. Clés API distinctes par Worker pour
  suivre les coûts par fonctionnalité. Limite de dépense configurée.
- **Dev** : VS Code + Claude Code, mode "Claude propose, l'utilisateur
  valide chaque modification".

## Vision architecturale

Hiérarchie cible :
Site
└─ Mes cours (écran principal pour les connectés)
├─ Cours "Épistémologie L3"
│   ├─ Onglet "Fiches" : la liste des fiches du cours
│   ├─ Onglet "QCM" : opère sur l'ensemble des fiches
│   ├─ Onglet "Cartes"
│   ├─ Onglet "Entraînement"
│   ├─ Onglet "Disserter"
│   ├─ Onglet "Ressources"
│   └─ Onglet "Pong"
└─ Cours "Philosophie de l'esprit" (ancien contenu, migré dans la base)
└─ Pour les non-connectés : page d'accueil / présentation

Niveau 1 (nav globale, pour les connectés) : Mes cours, Mon compte.
Niveau 2 (à l'intérieur d'un cours) : Fiches + les outils qui ont été
rebranchés sur les fiches du cours.

Règle pour la transition : un onglet n'apparaît dans la nav du cours que
quand il est effectivement rebranché sur les fiches. Tant qu'il n'est pas
prêt, il est invisible (pas grisé).

## Conventions de code

- JavaScript vanilla uniquement, pas de framework, pas d'outil de build
- Indentation 2 espaces
- Commentaires en français
- Variables courtes acceptables (cohérence avec le style existant)
- Préfixe `fe-` pour les classes CSS de FicheÉclair (évite les collisions
  avec le CSS existant)
- Fonction `escHTML()` (qui échappe `&`, `<`, `>`, `"`, et `'`) à utiliser
  systématiquement pour toute interpolation de chaîne dans du HTML construit
  par template string

## Décisions techniques actées

- Photos envoyées directement à Claude Vision en base64, pas d'OCR séparé
- Redimensionnement côté navigateur avant envoi (max 2000px, JPEG 0.85 avec
  fallback 0.7 puis 0.5 si la taille dépasse 5 Mo)
- Fiches stockées en JSON structuré dans la colonne `contenu jsonb` de la
  table `fiches` (pas en HTML), pour permettre les outils dérivés
- Modèle Sonnet 4.6 pour les fiches (Haiku envisagé au départ, mais Sonnet
  validé après test sur cas réel d'un cours de philo)
- Quota journalier de 10 fiches par utilisateur, calculé en UTC (pas en
  fuseau Europe/Paris — simple et prévisible)
- Vérification du JWT côté Worker en interrogeant `/auth/v1/user` de
  Supabase (plutôt que de vérifier la signature avec le secret JWT)
- Vérification du quota via la table `fiches` avec le JWT de l'utilisateur
  (pas la clé service_role), pour bénéficier des politiques RLS
- Prompt système calibré pour privilégier **fidélité** sur exhaustivité
  formelle : préférer un tableau vide à un contenu inventé
- INSERT dans `cours` exige `user_id` explicite côté frontend
  (la politique RLS ne le remplit pas automatiquement)
- Les modales (et autres éléments en `position:fixed`) doivent être
  enfants directs de `<body>` pour ne pas être cassées par les `transform`
  des ancêtres

## Méthodologie

- **Réflexion stratégique et revue de code via Claude.ai** (claude.ai) :
  conversation longue qui sert d'architecte, prépare les prompts pour
  Claude Code, et relit le code généré.
- **Exécution dans Claude Code** (VS Code) : Sonnet par défaut, Opus
  exceptionnel. L'utilisateur valide chaque modification proposée.
- **Une mission = une session ciblée.** Validation des plans avant
  exécution. Pas d'enchaînement de plusieurs missions dans une même
  session sans pause.
- **Une branche Git par mission.** Format `mission-<id>-<description>`,
  par exemple `mission-3a-2-liste-fiches`. Travail sur la branche, push,
  fusion dans `main` seulement après test en local et accord explicite.
- **Relecture systématique du code généré** avant déploiement. Pas de
  "commit-puis-on-verra".

---

# PARTIE VIVANTE

> **À mettre à jour à la fin de chaque mission.** Garde à jour cette
> section et seulement celle-ci. La date est utile pour situer la dernière
> mise à jour.

## État au [date du jour] — après R5.1

**Côté base Supabase** :
- Table `exercices` créée avec schéma polymorphe (colonne `type` 
  discriminante, valeurs autorisées 'qcm', 'flashcard', 'auteur'). 
  RLS activée, 4 politiques filtrées par auth.uid() = user_id.
- Colonnes : id, user_id, cours_id (FK), fiche_id (FK), type, 
  contenu jsonb, created_at.

**Côté Worker `ficheeclair-api`** :
- Nouvel endpoint POST /generate-qcm. Reçoit { fiche_id, n } 
  (n entre 1 et 20, défaut 10). Génère N questions de QCM via 
  Claude Sonnet 4.6, les insère dans `exercices` (type='qcm').
- Quota partagé avec /generate-fiche : total fiches + exercices 
  QCM du jour ≤ 10 (UTC).
- Filtre anti-biais de longueur : rejette une question si la 
  bonne réponse est plus longue que la 2e plus longue de plus 
  de 10 caractères, ou plus courte que la 2e plus courte de plus 
  de 10 caractères.
- Shuffle des options avec Web Crypto (Fisher-Yates), tracking 
  par flag pour éviter l'ambiguïté de indexOf.
- CORS localhost ajouté en passant (mission annexe résolue).

**Côté frontend (`index.html`)** :
- Bouton "Générer un QCM pour cette fiche" sur la vue de détail 
  d'une fiche. Visible seulement si connecté et hors mode démo. 
  Désactivé après une génération réussie (passe à "QCM généré") 
  pour éviter les doubles clics et les doublons.
- Système de toast créé (feAfficherToast), enfant direct de body, 
  4s pour succès / 7s pour erreurs.

## Roadmap

### Refonte vers la nouvelle architecture
- ~~R1, R2, R2-bis~~ ✓
- R3 — nav interne au cours (en attente)
- R4 — migration du cours philo de l'esprit (en attente)
- ~~R5.1~~ ✓ — table exercices + endpoint /generate-qcm + bouton 
  générer
- R5.2 — UI de jeu QCM (mode test : N questions tirées, score, 
  correction avec explications)
- R5.3 — type flashcard dérivé de notions_cles sans IA
- R5.4 — type auteur généré par IA
- R6+ — autres outils à rebrancher (Cartes, Disserter, Pong…)

## Prochaine mission

R5.2 — UI de jeu QCM, à cadrer en début de prochaine session.

## Leçons retenues (R5.1)

- Le filtre "ni la plus longue ni la plus courte" est trop strict : 
  rejette ~50% des questions par pur hasard, même quand Claude 
  équilibre bien. Le bon filtre est "écart > 10 caractères avec la 
  2e valeur la plus proche".
- Quand on assouplit un filtre, il faut renforcer le prompt 
  système en amont (sinon Claude se laisse aller). Combinaison 
  prompt renforcé + filtre raisonnable = ratio 3/3 en test.
- `wrangler dev` peut basculer silencieusement sur un autre port 
  (8788 au lieu de 8787) si le port est occupé par un Worker 
  zombie. Toujours vérifier la ligne "Ready on http://localhost:..."
  avant de lancer un curl. `lsof -i :8787` + `kill <PID>` pour 
  nettoyer.
- Ne jamais coller un JWT (ni quoi que ce soit commençant par `eyJ...`)
  dans une conversation Claude ou ailleurs hors de son terminal local. 
  Si fait par erreur : déconnexion + reconnexion sur Supabase pour 
  invalider le JWT.

## Pool de missions annexes mis à jour

- ~~CORS dev~~ ✓ (intégré dans R5.1)
- (autres missions inchangées : 3b UX fiches, 3c photo mobile, 
  3d PDF, 2B web search, PWA, partage de cours)
- **Nouveau — Refactoriser FICHEECLAIR_API en détection localhost** : 
  les constantes sont en dur sur la prod, ce qui empêche de tester 
  le frontend en local contre le Worker local. À faire avant la 
  prochaine mission qui ajouterait un endpoint au Worker.
- **Nouveau — Page de visualisation des QCM par fiche** : permettre 
  à l'utilisateur de voir combien de QCM existent sur une fiche et 
  régénérer ou supprimer si besoin. Pas critique tant que R5.2 ne 
  pose pas le problème de la régénération.