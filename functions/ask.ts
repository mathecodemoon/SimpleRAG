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
const MAX_ROWS = 50;
const MAX_CONTEXT_CHARS = Number(Deno.env.get('MAX_CONTEXT_CHARS') ?? 12000);

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// LLM (OpenRouter directo; el Model Gateway de InsForge requiere plan de pago)
// ---------------------------------------------------------------------------
async function chat(
  messages: { role: string; content: string }[],
  temperature = 0.3,
  maxTokens = 600,
): Promise<string> {
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
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter chat error (${res.status}): ${body.slice(0, 500)}`);
  }

  const result = await res.json();
  return result.choices?.[0]?.message?.content ?? '';
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

// ---------------------------------------------------------------------------
// Auto-routing: preguntas de datos/estructura -> SQL; conceptos -> RAG
// ---------------------------------------------------------------------------
const SQL_KEYWORDS = [
  'capítulo', 'capitulo', 'capítulos', 'capitulos',
  'sección', 'seccion', 'secciones',
  'cuántos', 'cuantos', 'cuántas', 'cuantas', 'cuánto', 'cuanto',
  'libro', 'libros',
  'autor', 'autora', 'autores',
  'año', 'anio', 'página', 'pagina', 'páginas', 'paginas',
  'título', 'titulo', 'editorial', 'isbn', 'publisher',
  'índice', 'indice', 'lista', 'listar', 'contar', 'conteo',
  'número', 'numero', 'cuál', 'cual', 'cuáles', 'cuales',
];

const RAG_STRONG = [
  'qué es', 'que es',
  'explícame', 'explicame', 'explica', 'explique', 'explicar',
  'definición', 'definicion',
  'diferencia',
  'ejemplo',
  'cómo funciona', 'como funciona',
  'significa', 'concepto', 'introduce', 'introducción',
];

function isSqlQuestion(question: string): boolean {
  const lower = question.toLowerCase();
  if (RAG_STRONG.some((k) => lower.includes(k))) return false;
  return SQL_KEYWORDS.some((k) => lower.includes(k));
}

// El LLM decide el modo; la heurística solo se usa como respaldo si falla.
const ROUTER_PROMPT = `Eres un clasificador de intenciones para una base de datos de libros de teoría de categorías (tablas books, chapters, sections) y un sistema de documentos (RAG).

Decide la mejor forma de responder la pregunta del usuario. Responde ÚNICAMENTE con un JSON de este formato:
{"mode": "sql"} o {"mode": "rag"}

Usa "sql" cuando la pregunta pide datos estructurados de la base de datos, por ejemplo:
- Cuántos o cuáles capítulos/secciones tiene un libro.
- Títulos, autores, años, editorial, ISBN, páginas, índices, listas, conteos, estructura del libro.

Usa "rag" cuando la pregunta pide explicar conceptos o teoría, por ejemplo:
- "Qué es una categoría?", "Qué es el lema de Yoneda?", "explica las adjunciones", "diferencia entre X y Y".

No agregues nada más que el JSON.`;

async function classifyMode(question: string): Promise<'sql' | 'rag'> {
  try {
    const raw = await chat(
      [
        { role: 'system', content: ROUTER_PROMPT },
        { role: 'user', content: question },
      ],
      0,
      30,
    );
    const match = raw.match(/"mode"\s*:\s*"(sql|rag)"/i);
    if (match) return match[1].toLowerCase() as 'sql' | 'rag';
    if (/\bsql\b/i.test(raw)) return 'sql';
    if (/\brag\b/i.test(raw)) return 'rag';
  } catch {
    // Si el router falla, usamos la heurística como respaldo.
  }
  return isSqlQuestion(question) ? 'sql' : 'rag';
}

// ---------------------------------------------------------------------------
// Modo SQL (texto a SQL sobre books/chapters/sections)
// ---------------------------------------------------------------------------
const SCHEMA = `
Tablas de la base de datos (nombres reales en inglés; el usuario se refiere a ellas en español como Libros, Capítulos, Secciones):

1) books — "Libros"
   id BIGINT PK
   slug TEXT
   title TEXT
   author TEXT
   year INT
   publisher TEXT
   isbn TEXT
   description TEXT
   file_name TEXT
   page_count INT
   created_at TIMESTAMPTZ

2) chapters — "Capítulos"
   id BIGINT PK
   book_id BIGINT FK -> books.id
   number TEXT       (ej. '1', '2', ..., 'E' para epílogo; comparar siempre con comillas: number = '4')
   title TEXT
   start_page INT
   end_page INT
   created_at TIMESTAMPTZ

3) sections — "Secciones"
   id BIGINT PK
   chapter_id BIGINT FK -> chapters.id
   number TEXT        (ej. '4.1'; comparar con comillas)
   title TEXT
   start_page INT
   created_at TIMESTAMPTZ

Notas:
- IMPORTANTE: si la pregunta menciona a una persona (autor/a) como "Emily Riehl", "Riehl", "Olivia Caramello" o "Caramello", filtra por books.author ILIKE '%<apellido>%'. NUNCA filtres por books.title cuando la persona es la autora.
- "capítulo 4 de Riehl" => unir books y chapters por book_id, filtrar por autor de Riehl y chapters.number = '4'.
- Siempre usa los nombres reales de las columnas (en minúsculas).
`;

const SQL_SYSTEM = `Eres un generador de consultas SQL de PostgreSQL para una base de datos de libros de teoría de categorías.
A partir del schema de abajo y de la pregunta del usuario, genera UNA consulta SELECT válida.
Reglas:
- Devuelve SOLO el SQL en una línea, sin explicaciones, sin bloques de código markdown y sin punto y coma final.
- Solo se permiten instrucciones SELECT (solo lectura).
- No uses INSERT, UPDATE, DELETE, DROP ni ALTER.
- Si la consulta puede devolver muchas filas, usa LIMIT ${MAX_ROWS}.
- En las columnas TEXT (number, slug, title, author) usa comillas simples en los literales.

Schema:
${SCHEMA}`;

const ANSWER_SYSTEM = `Eres un asistente que responde en español.
Redacta una respuesta clara y concisa basándote ÚNICAMENTE en los datos (JSON) que te dan.
- Si los datos están vacíos, di que no se encontró información.
- No inventes datos que no estén en el JSON.
- Menciona números, títulos o conteos exactos que aparezcan en los datos.`;

const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|VACUUM|EXECUTE|COMMENT|REINDEX|CALL|DO|PREPARE|DEALLOCATE|NOTIFY|LISTEN|UNLISTEN|SET)\b/i;

function cleanSql(raw: string): string {
  return raw
    .replace(/```[a-z]*/gi, '')
    .replace(/```/g, '')
    .trim()
    .replace(/;+\s*$/, '')
    .trim();
}

async function handleSql(
  admin: ReturnType<typeof createAdminClient>,
  question: string,
): Promise<Response> {
  // 1) Generar la consulta SELECT.
  const sql = cleanSql(
    await chat(
      [
        { role: 'system', content: SQL_SYSTEM },
        { role: 'user', content: question },
      ],
      0,
      300,
    ),
  );

  // 2) Validar: solo SELECT/WITH y sin instrucciones peligrosas.
  if (!sql) return json({ error: 'El modelo no generó una consulta SQL válida.' }, 500);
  if (!/^\s*(SELECT|WITH)\b/i.test(sql)) {
    return json({ error: 'La consulta generada no es un SELECT.' }, 400);
  }
  if (FORBIDDEN.test(sql)) {
    return json({ error: 'La consulta contiene una instrucción no permitida (INSERT/UPDATE/DELETE/DROP/ALTER...).' }, 400);
  }

  // 3) Ejecutar (solo lectura, tope de 50 filas).
  const { data: rows, error: execError } = await admin.database.rpc('exec_readonly_sql', {
    p_query: sql,
  });
  if (execError) {
    const message =
      typeof execError === 'object' && execError !== null && 'message' in execError
        ? String((execError as { message?: unknown }).message)
        : JSON.stringify(execError);
    return json({ error: `Error al ejecutar la consulta: ${message}` }, 500);
  }

  const rowsArr = Array.isArray(rows) ? rows : [];

  // Sin resultados: mejor pasamos a RAG por si el concepto está en los documentos.
  if (rowsArr.length === 0) return handleRag(admin, question);

  // 4) Redactar la respuesta en español con los resultados.
  const answer = await chat(
    [
      { role: 'system', content: ANSWER_SYSTEM },
      {
        role: 'user',
        content:
          `Pregunta: ${question}\n\n` +
          `Resultados (JSON):\n${JSON.stringify(rowsArr).slice(0, MAX_CONTEXT_CHARS)}`,
      },
    ],
    0.3,
    600,
  );

  const answerWithSql = `${answer}\n\nConsulta SQL utilizada:\n${sql}`;

  return json({ answer: answerWithSql, sql, rows: rowsArr, mode: 'sql' });
}

// ---------------------------------------------------------------------------
// Modo RAG (explicaciones de conceptos con embeddings sobre los documentos)
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `Eres un asistente que responde preguntas usando SOLO la información que aparece en el contexto delimitado por <contexto> y </contexto>.
- No uses conocimiento previo ni inventes datos.
- Si la respuesta NO está en el contexto, responde exactamente: "No tengo esa información en mis documentos".
- Cuando uses información del contexto, indica las fuentes (campo source) al final de la respuesta.
- Responde en el mismo idioma de la pregunta.`;

const NO_INFO = 'No tengo esa información en mis documentos';

// Los documentos están en inglés; traducir la pregunta a inglés antes de
// recuperar dispara mucho la similitud del embedding (multilingüe → inglés).
async function translateToEnglish(text: string): Promise<string> {
  try {
    const translated = await chat(
      [
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
      ],
      0,
      200,
    );
    const clean = translated.trim().replace(/^["'`]+|["'`]+$/g, '');
    return clean || text;
  } catch {
    return text;
  }
}

async function handleRag(
  admin: ReturnType<typeof createAdminClient>,
  question: string,
): Promise<Response> {
  const searchQuery = await translateToEnglish(question);
  const queryEmbedding = await embed(searchQuery);

  const { data: matches, error: searchError } = await admin.database.rpc('match_documents', {
    query_embedding: queryEmbedding,
    match_count: MATCH_COUNT,
    match_threshold: MATCH_THRESHOLD,
  });
  if (searchError) {
    throw new Error(`match_documents error: ${JSON.stringify(searchError)}`);
  }

  const documents: { id: number; content: string; source: string; similarity: number }[] =
    matches ?? [];

  if (documents.length === 0) {
    return json({ answer: NO_INFO, sources: [], model: null, mode: 'rag' }, 200);
  }

  const context = documents.map((d) => `[Fuente: ${d.source}]\n${d.content}`).join('\n\n');

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

  return json({ answer, sources, model: CHAT_MODEL, mode: 'rag' });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
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

    const mode = await classifyMode(question);
    if (mode === 'sql') return await handleSql(admin, question);
    return await handleRag(admin, question);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
}
