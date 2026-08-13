const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  const text = await req.text();
  let json: unknown = null;
  let parseError: string | null = null;
  try {
    json = JSON.parse(text);
  } catch (e) {
    parseError = String(e);
  }
  return new Response(
    JSON.stringify({ method: req.method, contentType: req.headers.get('content-type'), bodyLength: text.length, bodyPrefix: text.slice(0, 200), json, parseError }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
