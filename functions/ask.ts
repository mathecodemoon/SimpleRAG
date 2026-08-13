import { createAdminClient } from 'npm:@insforge/sdk';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const OPENROUTER_URL = 'https://openrouter.ai/api/v1';
const EMBEDDING_MODEL = Deno.env.get('EMBEDDING_MODEL') ?? 'openai/text-embedding-3-small';
const CHAT_MODEL = Deno.env.get('CHAT_MODEL') ?? 'openai/gpt-4o-mini';
const MATCH_COUNT = Number(Deno.env.get('MATCH_COUNT') ?? 5);
const MATCH_THRESHOLD = Number(Deno.env.get('MATCH_THRESHOLD') ?? 0.45);

const SYSTEM_PROMPT = `Eres un asistente que responde preguntas usando SOLO la información que aparece en el contexto delimitado por <contexto> y </contexto>.
- No uses conocimiento previo ni inventes datos.
- Si la respuesta NO está en el contexto, responde exactamente: "No tengo esa información en mis documentos".
- Cuando uses información del contexto, indica las fuentes (campo source) al final de la respuesta.
- Responde en el mismo idioma de la pregunta.`;

const NO_INFO = 'No tengo esa información en mis documentos';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function embed(text: string): Promise<number[]> {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!apiKey) throw new Error('Missing secret: OPENROUTER_API_KEY');

  const res = await fetch(`${OPENROUTER_URL}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter embeddings error (${res.status}): ${body.slice(0, 500)}`);
  }

  const result = await res.json();
  return result.data[0].embedding as number[];
}

async function chat(messages: { role: string; content: string }[]): Promise<string> {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!apiKey) throw new Error('Missing secret: OPENROUTER_API_KEY');

  const res = await fetch(`${OPENROUTER_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages,
      temperature: 0.2,
      max_tokens: 500,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter chat error (${res.status}): ${body.slice(0, 500)}`);
  }

  const result = await res.json();
  return result.choices[0]?.message?.content ?? '';
}

// Los documentos están en inglés; traducir la pregunta a inglés antes de
// recuperar dispara mucho la similitud del embedding (multilingüe → inglés).
async function translateToEnglish(text: string): Promise<string> {
  try {
    const translated = await chat([
      {
        role: 'system',
        content:
          'You are a translation engine specialized in mathematics and category theory. ' +
          'Translate the user question into English using standard mathematical and ' +
          'category-theory terminology (e.g. adjunto = adjoint, monada = monad, funtor = functor, ' +
          'categoria = category, topo = topos, flecha = arrow, morfismo = morphism, objeto = object). ' +
          'Reply with ONLY the translation, without quotes, comments or extra text.',
      },
      { role: 'user', content: text },
    ]);
    const clean = translated.trim().replace(/^["'`]+|["'`]+$/g, '');
    return clean || text;
  } catch {
    return text;
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed. Use POST.' }, 405);

  let body: { question?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) return json({ error: 'Missing required field: question' }, 400);

  try {
    const baseUrl = Deno.env.get('INSFORGE_BASE_URL');
    const apiKey = Deno.env.get('API_KEY');
    if (!baseUrl || !apiKey) throw new Error('Missing secrets: INSFORGE_BASE_URL or API_KEY');

    const admin = createAdminClient({ baseUrl, apiKey });

    const searchQuery = await translateToEnglish(question);
    const queryEmbedding = await embed(searchQuery);

    const { data: matches, error: searchError } = await admin.database.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_count: MATCH_COUNT,
      match_threshold: MATCH_THRESHOLD,
    });
    if (searchError) throw new Error(`match_documents error: ${JSON.stringify(searchError)}`);

    const documents: { id: number; content: string; source: string; similarity: number }[] =
      matches ?? [];

    if (documents.length === 0) {
      return json({ answer: NO_INFO, sources: [], model: null }, 200);
    }

    const context = documents
      .map((d) => `[Fuente: ${d.source}]\n${d.content}`)
      .join('\n\n');

    const answer = await chat([
      { role: 'system', content: `${SYSTEM_PROMPT}\n\n<contexto>\n${context}\n</contexto>` },
      { role: 'user', content: question },
    ]);

    const sources = documents.map((d) => ({
      id: d.id,
      source: d.source,
      content: d.content,
      similarity: Number(d.similarity.toFixed(4)),
    }));

    return json({ answer, sources, model: CHAT_MODEL });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
}
