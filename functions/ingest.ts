import { createAdminClient } from 'npm:@insforge/sdk';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const OPENROUTER_URL = 'https://openrouter.ai/api/v1';
const EMBEDDING_MODEL = Deno.env.get('EMBEDDING_MODEL') ?? 'openai/text-embedding-3-small';
const CHUNK_TARGET_TOKENS = Number(Deno.env.get('CHUNK_TARGET_TOKENS') ?? 500);
const CHUNK_OVERLAP_TOKENS = Number(Deno.env.get('CHUNK_OVERLAP_TOKENS') ?? 50);
const EMBED_BATCH_SIZE = Number(Deno.env.get('EMBED_BATCH_SIZE') ?? 100);
const INSERT_BATCH_SIZE = Number(Deno.env.get('INSERT_BATCH_SIZE') ?? 100);
const MAX_TEXT_CHARS = Number(Deno.env.get('MAX_TEXT_CHARS') ?? 5_000_000);

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// PostgreSQL rejects some control characters (notably \u0000) in TEXT values,
// and PDF extraction can produce them. Strip those and fold the rest to spaces.
function sanitizeText(text: string): string {
  return text
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .trim();
}

// Chunking heuristic: ~1.3 tokens per word is a good approximation for English.
function chunkText(text: string): string[] {
  const tokensPerWord = 1.3;
  const chunkSize = Math.max(1, Math.round(CHUNK_TARGET_TOKENS / tokensPerWord));
  const overlap = Math.max(1, Math.round(CHUNK_OVERLAP_TOKENS / tokensPerWord));

  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    let end = Math.min(start + chunkSize, words.length);

    // Break on a sentence boundary near the end of the chunk when possible.
    const boundaryFloor = Math.max(start, end - Math.floor(chunkSize / 3));
    for (let i = end - 1; i > boundaryFloor; i--) {
      if (/[.!?;:]$/.test(words[i])) {
        end = i + 1;
        break;
      }
    }

    chunks.push(words.slice(start, end).join(' '));
    if (end >= words.length) break;
    start = Math.max(start + chunkSize - overlap, start + 1);
  }

  return chunks.filter((c) => c.length > 0);
}

async function embed(texts: string[]): Promise<number[][]> {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!apiKey) throw new Error('Missing secret: OPENROUTER_API_KEY');

  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const res = await fetch(`${OPENROUTER_URL}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenRouter embeddings error (${res.status}): ${body.slice(0, 500)}`);
    }

    const result = await res.json();
    out.push(...result.data.map((d: { embedding: number[] }) => d.embedding));
  }

  return out;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed. Use POST.' }, 405);

  let body: { text?: unknown; source?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const text = sanitizeText(typeof body.text === 'string' ? body.text : '');
  const source = typeof body.source === 'string' && body.source.trim()
    ? body.source.trim()
    : 'document';

  if (!text) return json({ error: 'Missing required field: text' }, 400);
  if (text.length > MAX_TEXT_CHARS) {
    return json({ error: `Text too large: ${text.length} chars (max ${MAX_TEXT_CHARS}).` }, 413);
  }

  try {
    const chunks = chunkText(text);
    const embeddings = await embed(chunks);

    const rows = chunks.map((content, i) => ({
      content,
      source,
      embedding: embeddings[i],
      embedding_model: EMBEDDING_MODEL,
    }));

    const baseUrl = Deno.env.get('INSFORGE_BASE_URL');
    const apiKey = Deno.env.get('API_KEY');
    if (!baseUrl || !apiKey) throw new Error('Missing secrets: INSFORGE_BASE_URL or API_KEY');

    const admin = createAdminClient({ baseUrl, apiKey });
    const inserted: Record<string, unknown>[] = [];
    for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
      const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
      const { data, error } = await admin.database.from('documents').insert(batch).select();
      if (error) throw new Error(`DB insert error: ${JSON.stringify(error)}`);
      inserted.push(...(data ?? []));
    }

    return json({
      ingested: chunks.length,
      source,
      chunk_ids: inserted.map((r) => r.id ?? null),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
}
