# NCERT Portal

An AI study companion for NCERT students (Classes 7–12) that answers questions strictly from their own textbook — not a generic chatbot bolted onto a syllabus.

## How it works

- **Agentic retrieval, not a fixed pipeline.** A single model drives the whole conversation and decides, turn by turn, whether it needs to search the textbook or already has enough context to answer — via OpenAI tool-calling rather than a separate classify → retrieve → generate pipeline. It can search more than once in a turn if the first pass isn't enough.
- **Grounded answers.** Every syllabus claim has to come from a `search_textbook` result (or something already established earlier in the conversation) — the system prompt ([lib/rag/prompt.ts](lib/rag/prompt.ts)) explicitly forbids filling gaps with general knowledge, with one narrow, tagged exception for short out-of-syllabus factual questions.
- **RAG over the real textbooks.** NCERT PDFs are downloaded, chunked, and embedded (`pgvector`) per class/subject; retrieval is scoped to exactly the book the student selected.
- **Streaming responses** over SSE, with sources (chapter + page) surfaced alongside each answer.

## Coverage

| Classes | Subjects |
|---|---|
| 7–10 | Mathematics, Science, Social Science, English |
| 11–12 | Physics, Chemistry, Biology, Accountancy, Business Studies, Economics |

## Stack

Next.js (App Router) · TypeScript · OpenAI (gpt-4o + text-embedding-3-small) · Postgres/pgvector · Drizzle ORM

## Getting started

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL and OPENAI_API_KEY
npm run db:migrate
npm run dev
```

To ingest a textbook into the database (see [scripts/ingest](scripts/ingest)):

```bash
npm run ingest:download
npm run ingest:extract
npm run ingest:embed
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for production deployment notes.
