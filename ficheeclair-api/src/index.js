// Worker Cloudflare — ficheeclair-api
// Squelette authentifié + vérification de quota.
// L'appel à Claude Vision sera ajouté dans une mission ultérieure.

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

      // 3. OK — l'appel à Claude sera ajouté ici dans une mission ultérieure
      return json(
        {
          ok: true,
          user_id: userId,
          quota_utilise: total,
          quota_restant: quotaMax - total,
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
