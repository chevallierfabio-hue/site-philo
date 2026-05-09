export default async (req, context) => {
  // Autoriser seulement les POST
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.json();

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': Netlify.env.get('ANTHROPIC_API_KEY'),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return Response.json(data, { status: response.status });

  } catch (error) {
    return Response.json(
      { error: 'Erreur serveur', detail: error.message },
      { status: 500 }
    );
  }
};

export const config = { path: '/api/claude' };
