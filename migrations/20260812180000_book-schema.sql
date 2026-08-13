CREATE TABLE public.books (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  year INT,
  publisher TEXT,
  isbn TEXT,
  description TEXT,
  file_name TEXT,
  page_count INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.chapters (
  id BIGSERIAL PRIMARY KEY,
  book_id BIGINT NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  title TEXT NOT NULL,
  start_page INT,
  end_page INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (book_id, number)
);

CREATE TABLE public.sections (
  id BIGSERIAL PRIMARY KEY,
  chapter_id BIGINT NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  title TEXT NOT NULL,
  start_page INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chapter_id, number)
);

CREATE INDEX chapters_book_id_idx ON public.chapters(book_id);
CREATE INDEX sections_chapter_id_idx ON public.sections(chapter_id);

ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read books"
ON public.books
FOR SELECT TO anon, authenticated
USING (true);

CREATE POLICY "public read chapters"
ON public.chapters
FOR SELECT TO anon, authenticated
USING (true);

CREATE POLICY "public read sections"
ON public.sections
FOR SELECT TO anon, authenticated
USING (true);

GRANT SELECT ON public.books TO anon, authenticated;
GRANT SELECT ON public.chapters TO anon, authenticated;
GRANT SELECT ON public.sections TO anon, authenticated;
