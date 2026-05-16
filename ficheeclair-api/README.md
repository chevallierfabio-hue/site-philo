# ficheeclair-api

Worker Cloudflare qui sert de proxy authentifié pour la fonctionnalité
**FicheÉclair** : génération de fiches de révision à partir de photos ou PDF.

## Architecture

```
Navigateur (site-philo)
  └─ POST /generate-fiche ──► ficheeclair-api (ce Worker)
                                  ├─ valide le JWT via Supabase
                                  ├─ vérifie le quota journalier (table fiches)
                                  └─ (TODO) appel Claude Vision → fiche JSON
```

Le site principal (`site-philo`) est un Worker séparé qui sert `index.html`.
`claude-proxy` est un troisième Worker (hébergé dans l'interface Cloudflare,
pas dans ce repo) utilisé pour la fonctionnalité Disserter.

## Endpoint

### `POST /generate-fiche`

**Actuellement** : authentifie l'utilisateur et vérifie son quota journalier.
Retourne `200 ok` si l'utilisateur peut créer une fiche.

**TODO** : implémenter l'appel à Claude Vision pour générer la fiche.

#### Headers requis

| Header | Valeur |
|--------|--------|
| `Authorization` | `Bearer <jwt_supabase>` |
| `Content-Type` | `application/json` |

#### Réponses

| Code | Cas |
|------|-----|
| `200` | OK — quota non atteint |
| `401` | JWT absent, mal formé ou invalide |
| `404` | Route ou méthode incorrecte |
| `429` | Quota journalier atteint |
| `500` | Erreur serveur inattendue |

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
# Plus tard :
wrangler secret put ANTHROPIC_API_KEY   # clé API Anthropic
```

## Déploiement

```bash
cd ficheeclair-api
npx wrangler deploy
```

## Tester avec curl

```bash
curl -X POST https://ficheeclair-api.<ton-sous-domaine>.workers.dev/generate-fiche \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt_supabase>" \
  -d '{}'
```

Pour obtenir un JWT de test, connecte-toi au site et récupère
`supabase.auth.getSession()` dans la console du navigateur.

## TODO

- [ ] Implémenter l'appel à Claude Vision dans `POST /generate-fiche`
- [ ] Insérer la fiche générée dans la table `fiches` de Supabase
- [ ] Ajouter le secret `ANTHROPIC_API_KEY` via le dashboard Cloudflare
