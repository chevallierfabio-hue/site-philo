# FicheÉclair — Projet de génération de fiches de révision

## Identité du projet
Web app de génération de fiches de révision à partir de photos ou PDF
de cours, spécialement pensée pour les sciences humaines et la philosophie.
Construite sur la base d'un site QCM de philo existant (anciennement "site-philo").

## Cible
Étudiants en sciences humaines, philosophie, prépa littéraire, classes prépa
B/L. Les outils existants (NotebookLM, Mindgrasp) sont génériques et conçus
pour les sciences. FicheÉclair est conçu spécifiquement pour les disciplines
littéraires.

## Auteur
Étudiant en master de philosophie, pas développeur. Bagage technique :
HTML/CSS basique, expérience de code généré par IA, vient d'apprendre Git,
VS Code, Cursor/Claude Code, déploiement Cloudflare.

## Stack technique
- HTML/CSS/JS vanilla, tout dans index.html
- Hébergement : Cloudflare Workers (déploiement auto depuis GitHub)
- Base de données : Supabase (auth + table `scores` + table `fiches` à venir)
- API IA : Anthropic Claude (via proxy Cloudflare Worker authentifié JWT)
- Compte API perso utilisé pour le proxy, abonnement Claude Pro pour le dev

## État au début de la nouvelle conversation
- Site QCM de philo fonctionnel
- Authentification Supabase opérationnelle
- Classements QCM et Pong sur Supabase avec RLS (migration JSONBin terminée)
- Proxy Claude pour Disserter sécurisé avec JWT Supabase
- Limite de dépense Anthropic configurée

## Ce qui reste à construire (FicheÉclair)
1. Worker API séparé pour traitement des uploads
2. PWA (manifest.json, sw.js, balises iOS)
3. Page d'upload photos/PDF dans index.html
4. Génération de fiches par Claude Vision
5. Table `fiches` dans Supabase + page "Mes fiches"
6. Génération de QCM à partir des fiches (V2)

## Conventions de code
- JavaScript vanilla uniquement, pas de framework, pas d'outil de build
- Variables courtes acceptables (style existant), à refactoriser plus tard
- Commentaires en français
- Indentation 2 espaces

## Décisions techniques actées
- Photos envoyées directement à Claude Vision (pas d'OCR séparé)
- PDF : extraction côté client avec PDF.js
- Fiches stockées en JSON structuré (pas HTML) pour permettre QCM auto
- Modèle Haiku 4.5 pour fiches, Sonnet 4.6 pour dissertations (à confirmer par tests)
- Limite par utilisateur stockée en Supabase (ex : 10 fiches/jour)

## Méthodologie
Réflexion stratégique et revue de code via Claude.ai (cette conversation).
Exécution dans Claude Code avec Sonnet par défaut, Opus exceptionnel.
Une mission = une session ciblée. Validation des plans avant exécution.