// Worker Cloudflare — ficheeclair-api
// Génération de fiches et de QCM via l'API Anthropic.

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const corsHeaders = buildCorsHeaders(env.ALLOWED_ORIGIN, origin);

    // Preflight CORS
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(req.url);

    if (req.method === 'POST' && url.pathname === '/generate-fiche') {
      return handleGenerateFiche(req, env, corsHeaders);
    }
    if (req.method === 'POST' && url.pathname === '/generate-qcm') {
      return handleGenerateQcm(req, env, corsHeaders);
    }

    return json({ error: 'Introuvable' }, 404, corsHeaders);
  },
};

// ─────────────────────────────────────────────
// Handler : POST /generate-fiche
// ─────────────────────────────────────────────

async function handleGenerateFiche(req, env, corsHeaders) {
  try {
    // 1. Authentification
    const auth = await verifierJWT(req, env);
    if (auth instanceof Response) return addCors(auth, corsHeaders);
    const { jwt, userId } = auth;

    // 2. Quota journalier
    const quota = await verifierQuota(jwt, userId, env);
    if (quota instanceof Response) return addCors(quota, corsHeaders);
    const { total, quotaMax } = quota;

    if (total >= quotaMax) {
      return json(
        { error: 'Quota journalier atteint', quota_utilise: total, quota_par_jour: quotaMax },
        429,
        corsHeaders
      );
    }

    // 3. Parsing et validation du body
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Corps de requête JSON invalide' }, 400, corsHeaders);
    }

    const { images, discipline, titre_suggere, cours_id } = body;
    const TYPES_AUTORISES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

    if (!cours_id || typeof cours_id !== 'string') {
      return json({ error: 'Le champ "cours_id" est requis' }, 400, corsHeaders);
    }

    if (!Array.isArray(images) || images.length < 1 || images.length > 5) {
      return json({ error: 'Le champ "images" doit contenir entre 1 et 5 images' }, 400, corsHeaders);
    }

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      if (!TYPES_AUTORISES.includes(img.media_type)) {
        return json(
          { error: `Image ${i + 1} : type non supporté (${img.media_type}). Types acceptés : ${TYPES_AUTORISES.join(', ')}` },
          400,
          corsHeaders
        );
      }
      if (typeof img.data !== 'string') {
        return json({ error: `Image ${i + 1} : le champ "data" doit être une chaîne base64` }, 400, corsHeaders);
      }
      // Taille estimée : chaque caractère base64 ≈ 0,75 octet
      if (img.data.length * 0.75 > 5 * 1024 * 1024) {
        return json({ error: `Image ${i + 1} : taille estimée dépasse 5 Mo` }, 400, corsHeaders);
      }
    }

    // 3b. Vérification que le cours appartient à l'utilisateur
    // La RLS filtre automatiquement : si le cours n'existe pas ou n'appartient pas
    // à l'utilisateur, Supabase renvoie un tableau vide.
    const coursRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cours?id=eq.${cours_id}&select=id`,
      {
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'apikey': env.SUPABASE_ANON_KEY,
        },
      }
    );
    if (!coursRes.ok) {
      console.error('[ficheeclair-api] Erreur vérification cours :', coursRes.status);
      return json({ error: 'Erreur lors de la vérification du cours' }, 500, corsHeaders);
    }
    const coursData = await coursRes.json();
    if (!Array.isArray(coursData) || coursData.length === 0) {
      return json({ error: 'Cours introuvable ou accès non autorisé' }, 403, corsHeaders);
    }

    // 4. Appel à l'API Anthropic avec vision
    const promptSysteme = `Tu es un assistant pédagogique spécialisé dans les sciences humaines, la philosophie, les prépas littéraires (B/L) et les masters de lettres et de philosophie. Tu analyses des photos ou scans de cours et tu génères des fiches de révision structurées.

PRINCIPE FONDAMENTAL : la qualité d'une fiche se mesure à sa fidélité au cours, jamais à son exhaustivité formelle. Préférer toujours un tableau vide à un contenu approximatif, forcé ou inventé pour "remplir" un champ. Une fiche honnête avec des champs vides vaut mille fois mieux qu'une fiche bavarde.

Tu dois produire UNIQUEMENT du JSON valide, sans aucun texte avant ni après, sans balises markdown, sans commentaires. Le JSON doit respecter exactement cette structure :

{
  "titre": "string, max 100 caractères, fidèle au sujet du cours",
  "discipline": "string ou null si non identifiable",
  "auteurs": ["liste de strings"],
  "problematiques": ["string"],
  "enjeux": ["string"],
  "controverses": ["string"],
  "notions_cles": [{ "terme": "string", "definition": "string" }],
  "sections": [{ "titre": "string", "contenu": "string" }],
  "tableaux": [{ "titre": "string", "en_tetes": ["string"], "lignes": [["string"]] }],
  "frises": [{ "titre": "string", "evenements": [{ "date": "string", "evenement": "string" }] }],
  "citations": [{ "texte": "string", "auteur": "string", "source": "string ou null" }],
  "questions_revision": ["string"]
}

DÉFINITIONS PRÉCISES DE CHAQUE CHAMP :

"problematiques" : questions ouvertes, formulées au format interrogatif, que le cours pose ou auxquelles il tente de répondre. Idéalement empruntées au cours lui-même ou directement déductibles de son contenu.

"enjeux" : ce qui se joue intellectuellement dans le cours, pourquoi les problèmes posés importent au-delà du cours lui-même. Implications philosophiques, théoriques ou pratiques. Ne PAS confondre avec des objectifs pédagogiques ("comprendre le cours", "saisir la notion de X").

"controverses" : désaccords EXPLICITES, débats internes à la discipline, objections formulées par des auteurs IDENTIFIÉS contre d'autres positions. Une controverse doit pouvoir être formulée sous la forme "X soutient Y contre Z qui soutient W". Si on ne peut pas identifier au moins deux positions argumentées qui s'opposent, ce n'est PAS une controverse — c'est une distinction, une nuance ou un problème ouvert, qui a sa place ailleurs (sections, notions_cles).

"auteurs" : philosophie STRICTE. Seuls les auteurs centraux du cours, dont la pensée est analysée. Un auteur juste mentionné en passant ou cité comme référence sans que sa pensée soit développée n'est PAS un auteur du cours.

"frises" : frise chronologique d'événements pertinents pour la discipline (publications, écoles, événements historiques majeurs). MINIMUM 3 événements de la discipline elle-même pour avoir un sens visuel. NE JAMAIS inclure la date du cours, des éléments métacommunicatifs, ou des points qui ne sont pas des jalons historiques de la discipline. Si le cours ne contient pas naturellement 3 dates historiques, le tableau "frises" doit être vide.

"tableaux" : tableau comparatif uniquement quand le cours présente naturellement des oppositions ou des classifications binaires/multiples. Au moins 2 colonnes et 2 lignes. Ne PAS créer un tableau juste pour reformater une liste.

"citations" : citations EXPLICITES présentes dans le cours, avec guillemets ou attribution claire. NE JAMAIS inventer une citation, même "dans le style de" un auteur. Si aucune citation explicite n'apparaît, le tableau "citations" doit être vide.

"notions_cles" : termes techniques du cours, définis en s'appuyant sur le contenu du cours lui-même (pas sur des connaissances générales). Définitions de 1 à 3 phrases.

"sections" : restitution dense et fidèle du contenu du cours, organisée selon sa structure logique. Plusieurs paragraphes possibles par section.

"questions_revision" : questions ouvertes, exigeantes, du niveau attendu en master ou prépa littéraire. Pas de questions à réponse oui/non.

EXEMPLE NÉGATIF EXPLICITE :
Cours d'introduction qui présente la distinction entre l'usage français et l'usage anglo-saxon du terme "épistémologie".
❌ Mauvaise réponse : "controverses": ["L'épistémologie en France n'est pas l'épistémologie anglo-saxonne"] — ce n'est PAS une controverse, c'est une distinction terminologique.
✅ Bonne réponse : "controverses": [] — le cours ne met pas en scène un désaccord argumenté entre auteurs. Cette distinction doit apparaître dans "notions_cles" (deux définitions du terme) ou dans une "section" du cours.

Cours d'introduction qui mentionne Platon en passant pour évoquer le Théétète, sans analyser sa pensée en détail.
❌ Mauvaise réponse : "auteurs": ["Platon"] — Platon n'est pas l'auteur central du cours, juste une référence.
✅ Bonne réponse : "auteurs": [] — le cours ne développe pas la pensée de Platon. La mention de Platon doit apparaître dans la "section" pertinente ou dans "notions_cles" si "épistémé" est défini.

RÈGLES IMPÉRATIVES :
- Produire UNIQUEMENT du JSON valide, pas de markdown, pas de commentaires, pas de texte hors du JSON.
- Si une catégorie n'a pas de contenu pertinent et fidèle au cours, renvoyer un tableau vide []. JAMAIS inventer pour "remplir".
- Privilégier l'exhaustivité dans les sections (restituer densément le contenu réel du cours) mais la SOBRIÉTÉ dans les champs analytiques (problematiques, enjeux, controverses, citations, frises) : ne mettre que ce qui est solidement présent dans le cours.
- Le ton est rigoureux et académique, la langue est le français.

RAPPEL : préférer toujours un tableau vide à un contenu approximatif, forcé ou inventé.`;

    // Content blocks : d'abord les images, puis le texte de demande
    const contentsUser = images.map(img => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.media_type,
        data: img.data,
      },
    }));

    let texteDemande = 'Analyse ces photos de cours et génère une fiche de révision au format JSON demandé.';
    if (titre_suggere) texteDemande += ` Le titre de la fiche doit être : "${titre_suggere}".`;
    if (discipline) texteDemande += ` La discipline est : "${discipline}".`;
    contentsUser.push({ type: 'text', text: texteDemande });

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        system: promptSysteme,
        messages: [{ role: 'user', content: contentsUser }],
      }),
    });

    if (!claudeRes.ok) {
      const errClaude = await claudeRes.text();
      console.error('[ficheeclair-api] Erreur Anthropic :', claudeRes.status, errClaude);
      return json({ error: 'Erreur lors de la génération de la fiche' }, 502, corsHeaders);
    }

    const claudeData = await claudeRes.json();
    const rawText = claudeData?.content?.[0]?.text || '';
    const cleaned = rawText
      .replace(/^\s*```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    let fiche;
    try {
      fiche = JSON.parse(cleaned);
    } catch (e) {
      console.error('[ficheeclair-api] Réponse Claude non parsable :', rawText, e);
      return json({ error: 'Le modèle a renvoyé une réponse invalide' }, 502, corsHeaders);
    }

    // Fallbacks sur titre et discipline
    if (!fiche.titre || fiche.titre.trim() === '') {
      const dateISO = new Date().toISOString().slice(0, 10);
      fiche.titre = `Fiche du ${dateISO}`;
    }
    if (!fiche.discipline && discipline) {
      fiche.discipline = discipline;
    }

    // 5. Insertion en base Supabase
    const insertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/fiches`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'apikey': env.SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        user_id: userId,
        cours_id: cours_id,
        titre: fiche.titre,
        discipline: fiche.discipline || null,
        contenu: fiche,
      }),
    });

    if (!insertRes.ok) {
      const errInsert = await insertRes.text();
      console.error('[ficheeclair-api] Erreur insertion Supabase :', insertRes.status, errInsert);
      return json({ error: "Erreur d'enregistrement" }, 500, corsHeaders);
    }

    const [ficheInsere] = await insertRes.json();

    return json(
      {
        ok: true,
        fiche: ficheInsere,
        quota_utilise: total + 1,
        quota_restant: quotaMax - total - 1,
      },
      200,
      corsHeaders
    );

  } catch (err) {
    console.error('[ficheeclair-api] Erreur non prévue :', err);
    return json({ error: 'Erreur serveur' }, 500, corsHeaders);
  }
}

// ─────────────────────────────────────────────
// Handler : POST /generate-qcm
// ─────────────────────────────────────────────

// Prompt système pour la génération de QCM — éditer ici pour ajuster le comportement de Claude.
const PROMPT_QCM = `Tu génères des questions de QCM pour un étudiant en sciences humaines \
(philosophie, lettres, classes prépa B/L) qui révise un cours universitaire. À partir d'une \
fiche structurée fournie, produis N questions de qualité au format JSON strict.

Règles impératives :

1. Chaque question a exactement 4 options de réponse.
2. CONTRAINTE CRITIQUE DE LONGUEUR. Les 4 options doivent avoir des longueurs très proches. \
Concrètement : (a) Compte les caractères de chaque option avant de finaliser ta réponse. \
(b) L'écart entre la plus longue et la plus courte des 4 options ne doit JAMAIS dépasser \
10 caractères. (c) Si la bonne réponse est plus longue que les autres : raccourcis-la \
(supprime les précisions, les compléments d'information) jusqu'à ce qu'elle rentre dans la \
fourchette. (d) Si elle est plus courte : rallonge les distracteurs avec des éléments \
plausibles, jusqu'à ce qu'ils atteignent une longueur similaire. (e) Ne fais JAMAIS de la \
bonne réponse l'option la plus longue. C'est un défaut fréquent des QCM générés par IA, \
à éviter absolument.
3. La bonne réponse est TOUJOURS placée en position 0 du tableau \`options\`. Le mélange est \
fait par le code après ta réponse.
4. Les distracteurs (positions 1, 2, 3) doivent être plausibles : thèses voisines, positions \
d'auteurs proches, confusions classiques dans la discipline. Pas de distracteurs absurdes ou \
évidemment faux. Un distracteur idéal est une thèse qu'un étudiant insuffisamment préparé \
pourrait croire correcte.
5. Privilégie la FIDÉLITÉ au contenu de la fiche. Mieux vaut produire moins de questions de \
qualité que d'inventer du contenu pour atteindre N. Si la fiche est trop courte pour N questions \
de qualité, produis-en moins.
6. Varie les types de questions : reconnaissance de thèses, attribution à un auteur, définition \
d'une notion, identification d'un argument, distinction entre concepts voisins.
7. L'explication doit être courte (1-2 phrases) et expliquer POURQUOI la bonne réponse est \
correcte, pas juste répéter qu'elle l'est.
8. VÉRIFICATION FINALE. Avant d'émettre ta réponse, relis chaque question et compte \
mentalement les longueurs. Si l'une des questions viole la contrainte de longueur (règle 2), \
reformule-la. Ne soumets que des questions qui respectent toutes les contraintes.

Réponds UNIQUEMENT avec du JSON valide, sans préambule ni commentaire, sans bloc markdown, \
au format :

[
  {
    "question": "...",
    "options": ["bonne réponse", "distracteur 1", "distracteur 2", "distracteur 3"],
    "explication": "..."
  }
]`;

async function handleGenerateQcm(req, env, corsHeaders) {
  try {
    // 1. Authentification
    const auth = await verifierJWT(req, env);
    if (auth instanceof Response) return addCors(auth, corsHeaders);
    const { jwt, userId } = auth;

    // 2. Quota journalier (fiches + QCM du jour)
    const quota = await verifierQuota(jwt, userId, env);
    if (quota instanceof Response) return addCors(quota, corsHeaders);
    const { total, quotaMax } = quota;

    if (total >= quotaMax) {
      return json(
        { error: 'Quota journalier atteint', quota_utilise: total, quota_par_jour: quotaMax },
        429,
        corsHeaders
      );
    }

    // 3. Parsing et validation du body
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Corps de requête JSON invalide' }, 400, corsHeaders);
    }

    const { fiche_id, n: nRaw } = body;

    if (!fiche_id || typeof fiche_id !== 'string') {
      return json({ error: 'Le champ "fiche_id" est requis' }, 400, corsHeaders);
    }

    const n = nRaw === undefined ? 10 : parseInt(nRaw, 10);
    if (!Number.isInteger(n) || n < 1 || n > 20) {
      return json({ error: 'Le champ "n" doit être un entier entre 1 et 20' }, 400, corsHeaders);
    }

    // 4. Lecture de la fiche (via JWT utilisateur → RLS appliquée automatiquement)
    const ficheRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/fiches?id=eq.${fiche_id}&select=contenu,cours_id`,
      {
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'apikey': env.SUPABASE_ANON_KEY,
        },
      }
    );

    if (!ficheRes.ok) {
      console.error('[ficheeclair-api] Erreur lecture fiche :', ficheRes.status);
      return json({ error: 'Erreur lors de la lecture de la fiche' }, 500, corsHeaders);
    }

    const ficheData = await ficheRes.json();
    // Si vide : fiche inexistante ou n'appartient pas à l'utilisateur (RLS filtre silencieusement)
    if (!Array.isArray(ficheData) || ficheData.length === 0) {
      return json({ error: 'Fiche introuvable' }, 404, corsHeaders);
    }

    const { contenu, cours_id } = ficheData[0];

    // 5. Appel à l'API Anthropic
    const messageUser = `Génère ${n} questions de QCM à partir de la fiche suivante :\n${JSON.stringify(contenu)}`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system: PROMPT_QCM,
        messages: [{ role: 'user', content: messageUser }],
      }),
    });

    if (!claudeRes.ok) {
      const errClaude = await claudeRes.text();
      console.error('[ficheeclair-api] Erreur Anthropic (QCM) :', claudeRes.status, errClaude);
      return json({ error: 'Erreur lors de la génération du QCM' }, 502, corsHeaders);
    }

    const claudeData = await claudeRes.json();
    const rawText = claudeData?.content?.[0]?.text || '';

    // Tentative de parse : strip des fences markdown puis JSON.parse
    const cleaned = rawText
      .replace(/^\s*```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    let questions;
    try {
      questions = JSON.parse(cleaned);
    } catch (e) {
      console.error('[ficheeclair-api] Réponse Claude QCM non parsable :', rawText, e);
      return json({ error: 'Le modèle a renvoyé une réponse invalide' }, 502, corsHeaders);
    }

    if (!Array.isArray(questions)) {
      console.error('[ficheeclair-api] Réponse Claude QCM : pas un tableau :', questions);
      return json({ error: 'Le modèle a renvoyé une réponse invalide' }, 502, corsHeaders);
    }

    // 6. Post-traitement : validation, filtrage, shuffle, insertion
    let inserted = 0;
    let rejected = 0;

    for (const q of questions) {
      // Validation structurelle minimale
      if (
        typeof q.question !== 'string' ||
        !Array.isArray(q.options) ||
        q.options.length !== 4 ||
        typeof q.explication !== 'string'
      ) {
        rejected++;
        continue;
      }

      // Contrôle de longueur : rejet seulement si l'écart est visuellement flagrant.
      // On tolère que la bonne réponse soit la plus longue ou la plus courte, tant que
      // l'écart avec la deuxième valeur extrême ne dépasse pas 10 caractères.
      const longueurs = q.options.map(o => o.length);
      const longueurBonne = longueurs[0];
      const longueursTri = [...longueurs].sort((a, b) => a - b);
      const rejetLongueur =
        (longueurBonne === longueursTri[3] && longueurBonne - longueursTri[2] > 10) ||
        (longueurBonne === longueursTri[0] && longueursTri[1] - longueurBonne > 10);

      console.log(
        `[qcm] longueurs=${JSON.stringify(longueurs)} bonne=${longueurBonne}`,
        rejetLongueur ? '→ REJET longueur' : '→ OK'
      );

      if (rejetLongueur) {
        rejected++;
        continue;
      }

      // Shuffle avec Web Crypto (Fisher-Yates), suivi par flag plutôt que par valeur
      // pour éviter tout risque d'ambiguïté si deux options ont le même texte.
      const optionsAvecFlag = q.options.map((texte, i) => ({ texte, estBonne: i === 0 }));
      shufflerTableau(optionsAvecFlag);
      const indexBonneReponse = optionsAvecFlag.findIndex(o => o.estBonne);
      const optionsShufflees = optionsAvecFlag.map(o => o.texte);

      // Insertion dans la table exercices
      const insertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/exercices`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'apikey': env.SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          type: 'qcm',
          user_id: userId,
          cours_id: cours_id,
          fiche_id: fiche_id,
          contenu: {
            question: q.question,
            options: optionsShufflees,
            bonne_reponse: indexBonneReponse,
            explication: q.explication,
          },
        }),
      });

      if (!insertRes.ok) {
        const errInsert = await insertRes.text();
        console.error('[ficheeclair-api] Erreur insertion exercice :', insertRes.status, errInsert);
        // On continue plutôt que d'avorter : on signale le rejet
        rejected++;
        continue;
      }

      inserted++;
    }

    return json({ inserted, rejected, total_requested: n }, 200, corsHeaders);

  } catch (err) {
    console.error('[ficheeclair-api] Erreur non prévue (QCM) :', err);
    return json({ error: 'Erreur serveur' }, 500, corsHeaders);
  }
}

// ─────────────────────────────────────────────
// Helpers partagés
// ─────────────────────────────────────────────

// Vérifie le JWT Supabase et renvoie { jwt, userId } ou une Response 401.
async function verifierJWT(req, env) {
  const authHeader = req.headers.get('Authorization') || '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!jwt) {
    return json({ error: 'Non autorisé' }, 401);
  }

  const supaRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'apikey': env.SUPABASE_ANON_KEY,
    },
  });

  if (supaRes.status !== 200) {
    return json({ error: 'Non autorisé' }, 401);
  }

  const userData = await supaRes.json();
  return { jwt, userId: userData.id };
}

// Compte les actions IA du jour (fiches + QCM) et renvoie { total, quotaMax }
// ou une Response 500 si une requête échoue.
// Note : deux requêtes distinctes car les actions sont dans deux tables différentes.
// Si d'autres types d'actions IA sont ajoutés à l'avenir, ajouter une requête ici.
async function verifierQuota(jwt, userId, env) {
  const minuitUTC = new Date();
  minuitUTC.setUTCHours(0, 0, 0, 0);
  const minuitISO = minuitUTC.toISOString();
  const quotaMax = parseInt(env.QUOTA_PAR_JOUR, 10);

  // Les deux comptages s'exécutent en parallèle
  const [fichesRes, qcmRes] = await Promise.all([
    fetch(
      `${env.SUPABASE_URL}/rest/v1/fiches?select=id&user_id=eq.${userId}&created_at=gte.${minuitISO}`,
      {
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'apikey': env.SUPABASE_ANON_KEY,
          'Prefer': 'count=exact',
        },
      }
    ),
    fetch(
      `${env.SUPABASE_URL}/rest/v1/exercices?select=id&user_id=eq.${userId}&type=eq.qcm&created_at=gte.${minuitISO}`,
      {
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'apikey': env.SUPABASE_ANON_KEY,
          'Prefer': 'count=exact',
        },
      }
    ),
  ]);

  if (!fichesRes.ok || !qcmRes.ok) {
    console.error('[ficheeclair-api] Erreur vérification quota :', fichesRes.status, qcmRes.status);
    return json({ error: 'Erreur lors de la vérification du quota' }, 500);
  }

  // Le header content-range a la forme "0-N/TOTAL" (ou "*/TOTAL" si 0 résultats)
  const fichesTotal = parseInt((fichesRes.headers.get('content-range') || '*/0').split('/')[1], 10) || 0;
  const qcmTotal = parseInt((qcmRes.headers.get('content-range') || '*/0').split('/')[1], 10) || 0;

  return { total: fichesTotal + qcmTotal, quotaMax };
}

// Shuffle Fisher-Yates avec Web Crypto (pas Math.random)
function shufflerTableau(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const j = buf[0] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Copie les en-têtes CORS sur une Response existante (utile pour les réponses des helpers).
function addCors(response, corsHeaders) {
  const r = new Response(response.body, response);
  Object.entries(corsHeaders).forEach(([k, v]) => r.headers.set(k, v));
  return r;
}

function buildCorsHeaders(allowedOrigin, requestOrigin) {
  // Autorise le domaine de prod configuré ET tout localhost (tous ports) pour le dev local
  const estAutorise =
    requestOrigin === allowedOrigin ||
    requestOrigin.startsWith('http://localhost:');

  const origin = estAutorise ? requestOrigin : '';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}
