# SimpleRAG

**A question-answering assistant over your personal documents using Retrieval-Augmented Generation (RAG), built on InsForge.**

## Description

SimpleRAG lets you upload documents (plain text and PDFs) and ask questions about their content. The system answers only from the information present in the documents, without inventing data or using prior knowledge.

## Answer strategies

The assistant combines two strategies and decides which one to use based on the type of question. That decision is made by an LLM:

1. **Semantic search (RAG)** — Every document chunk is converted into an embedding using `openai/text-embedding-3-small` (1536 dimensions) and stored in a vector column (pgvector). Conceptual questions are translated into English to improve similarity, embedded, and the most relevant chunks are retrieved to draft an answer with context. Ideal for explaining concepts: *"what is a category?"*, *"what is the Yoneda lemma?"*.

2. **SQL queries** — The model generates a PostgreSQL `SELECT` statement over the `books`, `chapters`, and `sections` tables, validated as read-only and capped at 50 rows. Ideal for structured data: *"how many chapters does Caramello's book have?"*, *"what sections does chapter 4 of Riehl have?"*.

Routing is decided by `openai/gpt-4o-mini`, with a heuristic fallback if the classification fails.

## Architecture

- **Frontend** (React + Vite): chat with file upload. PDFs are extracted in the browser (pdfjs-dist) and indexed automatically when selected.
- **Edge Functions** (Deno, on InsForge):
  - `ingest`: splits the text into chunks, generates embeddings, and inserts them into the `documents` table.
  - `ask`: classifies the question with the LLM and answers via semantic search or SQL.
- **Database** (Postgres + pgvector):
  - `documents`: indexed content with vector embeddings.
  - `books`, `chapters`, `sections`: book metadata (author, year, table of contents, structure).
  - Functions: `match_documents` (cosine similarity search) and `exec_readonly_sql` (safe `SELECT` execution with a row cap).

## Backend with InsForge

InsForge is an open-source platform built on PostgreSQL that acts as an integration backend:

- Database with vector extensions (pgvector), RLS, and versioned migrations via CLI.
- Edge Functions in Deno/TypeScript, deployable with a single command.
- Model Gateway (AI): a single endpoint to call models, with centralized credential and cost management.
- Auth, storage, realtime, and payments ready to scale.

Models are invoked through OpenRouter; InsForge also exposes the Model Gateway as a centralized LLM integration layer.

## Tech stack

- React + Vite
- InsForge (Postgres + Edge Functions + CLI)
- pgvector
- OpenRouter — `openai/text-embedding-3-small`, `openai/gpt-4o-mini`
- pdfjs-dist
