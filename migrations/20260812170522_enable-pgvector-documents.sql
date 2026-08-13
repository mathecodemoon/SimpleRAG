CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE public.documents (
  id BIGSERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  embedding_model TEXT NOT NULL DEFAULT 'openai/text-embedding-3-small',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read documents"
ON public.documents
FOR SELECT TO anon, authenticated
USING (true);

CREATE POLICY "public insert documents"
ON public.documents
FOR INSERT TO anon, authenticated
WITH CHECK (true);

GRANT SELECT, INSERT ON public.documents TO anon, authenticated;
GRANT USAGE ON SEQUENCE public.documents_id_seq TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.match_documents(
  query_embedding vector(1536),
  match_count INT DEFAULT 5,
  match_threshold DOUBLE PRECISION DEFAULT 0.78
)
RETURNS TABLE (
  id BIGINT,
  content TEXT,
  source TEXT,
  similarity DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    public.documents.id,
    public.documents.content,
    public.documents.source,
    1 - (public.documents.embedding <=> query_embedding) AS similarity
  FROM public.documents
  WHERE 1 - (public.documents.embedding <=> query_embedding) >= match_threshold
  ORDER BY public.documents.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_documents(vector, INT, DOUBLE PRECISION)
TO anon, authenticated;

CREATE INDEX documents_embedding_hnsw_idx
ON public.documents
USING hnsw (embedding vector_cosine_ops);
