// Worker Cloudflare — ficheeclair-api
// Génération de fiches de révision via Claude Vision.

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const corsHeaders = buildCorsHeaders(env.ALLOWED_ORIGIN, origin);

    // Preflight CORS
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Seul endpoint exposé
    const url = new URL(req.url);
    if (req.method !== 'POST' || url.pathname !== '/generate-fiche') {
      return json({ error: 'Introuvable' }, 404, corsHeaders);
    }

    try {
      // 1. Authentification
      const authHeader = req.headers.get('Authorization') || '';
      const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!jwt) {
        return json({ error: 'Non autorisé' }, 401, corsHeaders);
      }

      const supaRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'apikey': env.SUPABASE_ANON_KEY,
        },
      });
      if (supaRes.status !== 200) {
        return json({ error: 'Non autorisé' }, 401, corsHeaders);
      }
      const userData = await supaRes.json();
      const userId = userData.id;

      // 2. Quota journalier
      const minuitUTC = new Date();
      minuitUTC.setUTCHours(0, 0, 0, 0);
      const minuitISO = minuitUTC.toISOString();

      const quotaRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/fiches?select=id&user_id=eq.${userId}&created_at=gte.${minuitISO}`,
        {
          headers: {
            'Authorization': `Bearer ${jwt}`,
            'apikey': env.SUPABASE_ANON_KEY,
            'Prefer': 'count=exact',
          },
        }
      );

      // Le header content-range a la forme "0-N/TOTAL" (ou "*/TOTAL" si 0 résultats)
      const contentRange = quotaRes.headers.get('content-range') || '*/0';
      const total = parseInt(contentRange.split('/')[1], 10) || 0;
      const quotaMax = parseInt(env.QUOTA_PAR_JOUR, 10);

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
  },
};

// --- Utilitaires ---

function buildCorsHeaders(allowedOrigin, requestOrigin) {
  // N'autorise que l'origine configurée
  const origin = requestOrigin === allowedOrigin ? allowedOrigin : '';
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
