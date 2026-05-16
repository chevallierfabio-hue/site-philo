# ficheeclair-api

Worker Cloudflare qui sert de proxy authentifié pour la fonctionnalité
**FicheÉclair** : génération de fiches de révision à partir de photos ou PDF.

## Architecture

```
Navigateur (site-philo)
  └─ POST /generate-fiche ──► ficheeclair-api (ce Worker)
                                  ├─ valide le JWT via Supabase
                                  ├─ vérifie le quota journalier (table fiches)
                                  ├─ appelle Claude Vision (claude-sonnet-4-5)
                                  └─ insère la fiche dans Supabase → renvoie le JSON
```

Le site principal (`site-philo`) est un Worker séparé qui sert `index.html`.
`claude-proxy` est un troisième Worker (hébergé dans l'interface Cloudflare,
pas dans ce repo) utilisé pour la fonctionnalité Disserter.

## Endpoint

### `POST /generate-fiche`

Authentifie l'utilisateur, vérifie son quota journalier, appelle Claude Vision
pour générer une fiche structurée, l'insère en base et la renvoie.

#### Headers requis

| Header | Valeur |
|--------|--------|
| `Authorization` | `Bearer <jwt_supabase>` |
| `Content-Type` | `application/json` |

#### Corps de la requête

```json
{
  "images": [
    { "media_type": "image/jpeg", "data": "<base64>" },
    { "media_type": "image/png",  "data": "<base64>" }
  ],
  "discipline":    "philosophie",
  "titre_suggere": "Kant et la raison pratique"
}
```

| Champ | Obligatoire | Détail |
|-------|-------------|--------|
| `images` | Oui | Tableau de 1 à 5 images |
| `images[].media_type` | Oui | `image/jpeg`, `image/png`, `image/webp` ou `image/gif` |
| `images[].data` | Oui | Image encodée en base64, ≤ 5 Mo par image |
| `discipline` | Non | Transmis à Claude pour affiner la fiche |
| `titre_suggere` | Non | Utilisé comme titre si fourni |

#### Format de la fiche JSON renvoyée

Le champ `fiche` de la réponse 200 est la ligne insérée dans Supabase.
Son champ `contenu` (jsonb) a la structure suivante :

```json
{
  "titre":              "string",
  "discipline":         "string ou null",
  "auteurs":            ["string"],
  "problematiques":     ["string"],
  "enjeux":             ["string"],
  "controverses":       ["string"],
  "notions_cles":       [{ "terme": "string", "definition": "string" }],
  "sections":           [{ "titre": "string", "contenu": "string" }],
  "tableaux": [
    { "titre": "string", "en_tetes": ["string"], "lignes": [["string"]] }
  ],
  "frises": [
    { "titre": "string", "evenements": [{ "date": "string", "evenement": "string" }] }
  ],
  "citations":          [{ "texte": "string", "auteur": "string", "source": "string ou null" }],
  "questions_revision": ["string"]
}
```

#### Réponses

| Code | Cas |
|------|-----|
| `200` | Fiche générée et enregistrée |
| `400` | Corps invalide (nombre d'images hors limite, type ou taille non supporté) |
| `401` | JWT absent, mal formé ou invalide |
| `404` | Route ou méthode incorrecte |
| `429` | Quota journalier atteint |
| `500` | Erreur d'enregistrement Supabase ou erreur serveur inattendue |
| `502` | Erreur Anthropic ou réponse Claude non parsable |

## Variables d'environnement

### Publiques (dans `wrangler.jsonc`)

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | URL du projet Supabase |
| `ALLOWED_ORIGIN` | Origine autorisée par CORS (le site site-philo) |
| `QUOTA_PAR_JOUR` | Nombre max de fiches par utilisateur par jour |

### Secrets (à ajouter via le dashboard Cloudflare)

```bash
wrangler secret put SUPABASE_ANON_KEY   # clé publique Supabase (anon)
wrangler secret put ANTHROPIC_API_KEY   # clé API Anthropic (requise pour Claude Vision)
```

## Déploiement

```bash
cd ficheeclair-api
npx wrangler deploy
```

## Tester avec curl

```bash
# Encoder une image en base64 (macOS/Linux)
IMG_B64=$(base64 -i photo_cours.jpg | tr -d '\n')

curl -X POST https://ficheeclair-api.<ton-sous-domaine>.workers.dev/generate-fiche \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt_supabase>" \
  -d "{
    \"images\": [
      { \"media_type\": \"image/jpeg\", \"data\": \"$IMG_B64\" }
    ],
    \"discipline\": \"philosophie\",
    \"titre_suggere\": \"Kant et la raison pratique\"
  }"
```

Pour obtenir un JWT de test, connecte-toi au site et récupère
`supabase.auth.getSession()` dans la console du navigateur.

## TODO

- [x] Implémenter l'appel à Claude Vision dans `POST /generate-fiche`
- [x] Insérer la fiche générée dans la table `fiches` de Supabase
- [x] Ajouter le secret `ANTHROPIC_API_KEY` via le dashboard Cloudflare
