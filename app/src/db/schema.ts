import {
  boolean,
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// multilingual-e5-base embeddings are 768-dim; e5-small is 384, bge-m3 is 1024.
// Set once, the vector column is fixed at migration time.
export const VECTOR_DIM = 768;

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return `vector(${VECTOR_DIM})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return JSON.parse(value);
  },
});

const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

export const visibilityEnum = pgEnum("visibility", ["public", "compliance"]);

// Demo profiles replace real auth in the MVP. A profile sees documents whose
// visibility is "public" or matches its own visibility. Real users/groups/
// workspaces land post-v0.1.
export const demoProfiles = pgTable("demo_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  visibility: visibilityEnum("visibility").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: varchar("title", { length: 500 }).notNull().unique(),
    sourceUrl: text("source_url"),
    celex: varchar("celex", { length: 32 }),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    visibility: visibilityEnum("visibility").notNull().default("public"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("documents_content_hash_idx").on(t.contentHash)],
);

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    position: integer("position").notNull(),
    // Citation metadata: article/recital identifier and the EUR-Lex HTML anchor
    // ("art_32", "rct_5") for the deep link.
    sectionType: varchar("section_type", { length: 16 }).notNull(),
    sectionNumber: integer("section_number").notNull(),
    sectionTitle: varchar("section_title", { length: 500 }).notNull(),
    anchor: varchar("anchor", { length: 64 }),
    embedding: vector("embedding"),
    tsvector: tsvector("tsvector"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("chunks_document_idx").on(t.documentId),
    index("chunks_embedding_hnsw_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id").references(() => demoProfiles.id, { onDelete: "set null" }),
    prompt: text("prompt").notNull(),
    model: varchar("model", { length: 255 }),
    chunkIds: uuid("chunk_ids").array(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    cacheHit: boolean("cache_hit").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("audit_logs_profile_idx").on(t.profileId)],
);

// Exact-match cache for prompt embeddings. Keyed on the full prompt text; no
// similarity search, a hit requires a byte-identical prompt.
export const embeddingCache = pgTable("embedding_cache", {
  textHash: varchar("text_hash", { length: 64 }).primaryKey(),
  embedding: vector("embedding").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Replays the generated answer for an identical generation input. The key pins
// model, system prompt (which contains the retrieved chunk content), history
// and profile visibility, so a corpus change produces a new key and a deleted
// document can never be served from cache again. document_ids additionally
// lets deletion wipe the stored answer text before the TTL would.
export const answerCache = pgTable("answer_cache", {
  keyHash: varchar("key_hash", { length: 64 }).primaryKey(),
  answerText: text("answer_text").notNull(),
  model: varchar("model", { length: 255 }).notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  documentIds: uuid("document_ids").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
