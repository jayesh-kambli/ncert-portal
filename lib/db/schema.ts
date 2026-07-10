import {
  pgTable,
  uuid,
  smallint,
  text,
  integer,
  vector,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    class: smallint("class").notNull(),
    subject: text("subject").notNull(),
    chapter: text("chapter").notNull(),
    chapterNumber: smallint("chapter_number").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    pageNumber: integer("page_number"),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("chunks_class_subject_idx").on(table.class, table.subject),
    index("chunks_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
  ]
);

export type Chunk = typeof chunks.$inferSelect;
export type NewChunk = typeof chunks.$inferInsert;
