Parfait. Voici la nouvelle version de CLAUDE.md, structurée comme convenu.
markdown# FicheÉclair — Document de projet

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
    titre/discipline/contenu jsonb)
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

## État au [17/05] — après R2 et R2-bis

**Côté base Supabase** :
- Table `cours` créée avec RLS et 4 politiques (select/insert/update/delete
  filtrées par `auth.uid() = user_id`). Trigger `updated_at` automatique.
  Colonnes : id, user_id, titre, discipline, niveau, description,
  created_at, updated_at.
- Table `fiches` enrichie d'un `cours_id` (FK cours.id).
- Base nettoyée avant R2 puis re-peuplée en testant : quelques cours
  et fiches de test en prod, qu'on pourra purger plus tard.

**Côté Worker `ficheeclair-api`** (inchangé depuis R1) :
- Exige `cours_id` dans `POST /generate-fiche`, refuse 400 si absent.
- Vérifie que le cours appartient à l'utilisateur via RLS (403 sinon).

**Côté frontend (`index.html`)** :
- L'onglet "Mes cours" est l'écran principal pour les connectés.
- CRUD complet des cours : création, modification (titre + discipline +
  niveau via modale unique), suppression. Listing en cartes avec compte
  de fiches par cours.
- Détail d'un cours = liste des fiches du cours, depuis laquelle on
  peut ajouter une nouvelle fiche.
- Fil d'Ariane cliquable : `Mes cours > [Cours] > [Fiche]`.
  Cours courant mémorisé via `feCoursCourant` (id, titre, discipline).
- Modale d'édition de cours, placée **directement comme enfant de
  `<body>`** pour éviter le bug `position:fixed` cassé par un ancêtre
  ayant `transform`/`filter`/`perspective`. Mode création (modale vide)
  ou édition (pré-remplie) selon que `feModaleCoursCourant` est null ou
  non.
- Discipline obligatoire à la création, niveau optionnel. Datalist HTML
  avec 8 valeurs suggérées (Philosophie en premier), saisie libre.
- Le formulaire d'upload de fiche n'a plus de champ "Discipline" :
  la discipline envoyée au Worker vient automatiquement de
  `feCoursCourant.discipline`.
- Après génération de fiche, retour automatique au détail du cours.

**Décisions techniques actées pendant R2 et R2-bis** :
- INSERT dans `cours` exige `user_id` explicite côté frontend
  (la politique RLS ne le remplit pas automatiquement). Le bug RLS
  rencontré au début de R2 et corrigé sur ce point.
- Les modales (et autres éléments en `position:fixed`) doivent être
  enfants directs de `<body>` pour ne pas être cassés par les `transform`
  des ancêtres. Convention à appliquer pour toute future modale.

## Roadmap mise à jour

### Refonte vers la nouvelle architecture (suite)

- ~~R1~~ table `cours` + Worker adapté (fait)
- ~~R2~~ "Mes cours" comme écran principal + CRUD cours (fait)
- ~~R2-bis~~ discipline et niveau au niveau du cours, modale d'édition (fait)
- **R3** — nav interne au cours avec les onglets prévus, mais seul
  "Fiches" est visible. Nav globale minimaliste (Mes cours / Mon compte).
- **R4** — migration du contenu de l'ancien cours (philo de l'esprit) en
  cours dans la base, accessible comme démo aux non-connectés et comme
  cours dans le compte de l'auteur.
- **R5** — rebrancher l'outil QCM sur les fiches du cours courant.
- **R6+** — rebrancher les autres outils un par un : Cartes, Entraînement,
  Disserter, Ressources, Pong.

### Pool de missions annexes

- **3b** — amélioration UX d'affichage des fiches (design, gestion fine
  des erreurs, indicateur de progression plus poussé)
- **3c** — prise photo directement depuis téléphone (permissions, PWA)
- **3d** — extraction PDF côté client avec PDF.js
- **2B** — recherche web pour générer un "Pour aller plus loin"
  (vidéos YouTube, podcasts, lectures) sans hallucinations
- **PWA** — manifest.json, sw.js, balises iOS pour installation comme app
- **CORS dev** — autoriser localhost dans le Worker `ficheeclair-api`
  pour pouvoir tester en local toute la chaîne (frontend → Worker).
  Reporté pendant R2, à faire avant la prochaine mission qui touchera
  le Worker.
- **Nettoyage branches distantes** — supprimer `origin/mission-3a-1-*`
  et `origin/mission-3a-2-*` sur GitHub si on veut un repo distant
  propre. Aucune urgence.

## Prochaine mission

À débattre en début de prochaine session : **R3** (nav interne au cours,
préparer la place des futurs onglets) ou directement **R5** (rebrancher
le QCM sur les fiches du cours).

## Leçons retenues à appliquer

- **Toujours travailler sur la branche dédiée** jusqu'à ce que la mission
  soit complètement terminée et testée en prod. Ne jamais commiter
  directement sur `main` un fix de bug même petit — revenir sur la
  branche, fixer, re-merger. Cas vu en R2-bis : un fix commité
  directement sur `main` au lieu de la branche, qui a créé un historique
  un peu confus. Sans gravité ici parce que la branche a été supprimée
  juste après, mais à ne pas refaire sur des missions plus longues.
- **RLS Supabase ne remplit pas les valeurs, elle vérifie.** Tout INSERT
  côté frontend doit envoyer explicitement `user_id` (et tout autre champ
  filtré par RLS).
- **Modales et `position:fixed`** : enfant direct de `<body>` toujours.

## État au [17/05]

**Backend "cours" en place** (mission R1, déployée) :
- Table `cours` (id, user_id, titre, discipline, description, niveau,
  created_at, updated_at) avec RLS (4 politiques `auth.uid() = user_id`)
  et index sur `user_id`.
- Trigger `cours_set_updated_at` (BEFORE UPDATE) qui met à jour
  `cours.updated_at` automatiquement.
- Trigger `fiches_propager_cours_updated_at` (AFTER INSERT/UPDATE/DELETE)
  qui propage les modifications de fiches vers `cours.updated_at`.
- Colonne `cours_id uuid NOT NULL REFERENCES cours(id) ON DELETE CASCADE`
  ajoutée à `fiches`, avec index `fiches_cours_id_idx`.

**Worker `ficheeclair-api` adapté** (déployé sur Cloudflare) :
- `POST /generate-fiche` exige désormais un `cours_id` dans le body
  (400 si absent).
- Vérification explicite que le `cours_id` appartient à l'utilisateur via
  une requête Supabase avec son JWT (RLS fait le filtrage, 403 si KO).
- L'INSERT en base inclut le `cours_id`.
- Quota inchangé (10 fiches/jour/utilisateur, UTC).

**Frontend** : inchangé depuis l'état précédent. Le site ne peut plus
générer de fiches tel quel (le Worker exige un `cours_id` qu'il n'envoie
pas), c'est volontaire : la refonte UI vient en R2.

**Supabase** : table `fiches` vidée des données de test au passage. Pas de
fiches en base à l'heure actuelle.

## Roadmap

### Refonte vers la nouvelle architecture (séquentiel)

- ~~**R1**~~ ✓ — fait : table `cours` + adaptation du Worker.
- **R2** — refonte UI : "Mes cours" remplace "Mes fiches" comme écran
  principal. Navigation Mes cours → Cours → Fiches. Pour l'instant un
  cours ne contient que l'onglet "Fiches". Le frontend devra :
  - permettre la création / liste / suppression de cours (CRUD direct
    sur Supabase via le SDK, sans passer par un Worker, grâce à la RLS) ;
  - adapter la page de génération de fiches pour qu'elle envoie le
    `cours_id` du cours actuellement ouvert.
- **R3** — nav interne au cours avec les onglets prévus, mais seul
  "Fiches" est visible (les autres restent invisibles tant qu'ils ne sont
  pas rebranchés). Nav globale minimaliste (Mes cours / Mon compte).
- **R4** — migration du contenu de l'ancien cours (philo de l'esprit) en
  cours dans la base, accessible comme démo aux non-connectés et comme
  cours dans le compte de l'auteur.
- **R5** — rebrancher l'outil QCM sur les fiches du cours courant.
- **R6+** — rebrancher les autres outils un par un : Cartes, Entraînement,
  Disserter, Ressources, Pong. Ordre à décider au fil de l'eau selon
  l'utilité ressentie.

### Pool de missions annexes (à piocher quand le besoin se fait sentir)

- **3b** — amélioration UX d'affichage des fiches (design, gestion fine
  des erreurs, indicateur de progression plus poussé)
- **3c** — prise photo directement depuis téléphone (permissions, PWA)
- **3d** — extraction PDF côté client avec PDF.js
- **2B** — recherche web pour générer un "Pour aller plus loin"
  (vidéos YouTube, podcasts, lectures) sans hallucinations
- **PWA** — manifest.json, sw.js, balises iOS pour installation comme app
- **Partage de cours entre utilisateurs** — à terme : table
  `cours_membres` avec rôles (propriétaire/contributeur/lecteur),
  adapter les RLS en conséquence. Refonte non triviale.

## Prochaine mission

**R2** : refonte UI pour faire émerger "Mes cours" comme écran principal,
avec CRUD des cours côté frontend (Supabase JS direct, RLS faisant le
filtrage), et adaptation de la page de génération de fiches pour qu'elle
envoie le `cours_id` du cours ouvert. Pas de branche Git créée pour
l'instant — la discussion stratégique sur le périmètre exact de R2 reste
à faire avant de lancer la mission dans Claude Code.
## État au [17/05]

**Worker `ficheeclair-api`** déployé et opérationnel :
- Authentification JWT Supabase, quota 10 fiches/jour/utilisateur (UTC)
- Appel Claude Sonnet 4.6 Vision avec prompt système calibré
- Insertion automatique en base, retour de la fiche au client
- Code dans le repo (sous-dossier `ficheeclair-api/`)

**Frontend** dans `index.html`, onglet "Mes fiches" :
- Upload de 1 à 5 images avec redimensionnement côté client
- État liste / upload / generation / detail, géré par `feShowState()`
- Liste persistante des fiches passées (lecture Supabase, ordre
  antichronologique, date relative)
- Suppression avec confirmation native
- Affichage en accordéons dépliés par défaut, un par grand champ
- Bascule auto vers "Mes fiches" pour les connectés (chargement + login)

**Supabase** :
- Table `fiches` avec RLS (lecture/écriture/suppression : auth.uid() = user_id)
- Données : quelques fiches de test générées sur cours de philo

## Roadmap

### Refonte vers la nouvelle architecture (séquentiel)

- **R1** — ajouter la notion de "cours" dans Supabase + adapter le Worker
  `ficheeclair-api` pour qu'il accepte un `cours_id`. Migration douce des
  fiches existantes (rattachement à un cours par défaut). Backend pur,
  pas de changement d'UI.
- **R2** — refonte UI : "Mes cours" remplace "Mes fiches" comme écran
  principal. Navigation Mes cours → Cours → Fiches. Pour l'instant un
  cours ne contient que l'onglet "Fiches".
- **R3** — nav interne au cours avec les onglets prévus, mais seul
  "Fiches" est visible (les autres restent invisibles tant qu'ils ne sont
  pas rebranchés). Nav globale minimaliste (Mes cours / Mon compte).
- **R4** — migration du contenu de l'ancien cours (philo de l'esprit) en
  cours dans la base, accessible comme démo aux non-connectés et comme
  cours dans le compte de l'auteur.
- **R5** — rebrancher l'outil QCM sur les fiches du cours courant.
- **R6+** — rebrancher les autres outils un par un : Cartes, Entraînement,
  Disserter, Ressources, Pong. Ordre à décider au fil de l'eau selon
  l'utilité ressentie.

### Pool de missions annexes (à piocher quand le besoin se fait sentir)

- **3b** — amélioration UX d'affichage des fiches (design, gestion fine
  des erreurs, indicateur de progression plus poussé)
- **3c** — prise photo directement depuis téléphone (permissions, PWA)
- **3d** — extraction PDF côté client avec PDF.js
- **2B** — recherche web pour générer un "Pour aller plus loin"
  (vidéos YouTube, podcasts, lectures) sans hallucinations
- **PWA** — manifest.json, sw.js, balises iOS pour installation comme app

## Prochaine mission

**R1** : ajouter la notion de "cours" dans Supabase + adapter le Worker
`ficheeclair-api`. Branche Git locale `mission-r1-cours` déjà créée.