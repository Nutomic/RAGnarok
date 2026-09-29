import {
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

// bge-m3 embeddings are 1024-dim; multilingual-e5-small is 384. Set once,
// the vector column is fixed at migration time.
export const VECTOR_DIM = 1024;

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
    title: varchar("title", { length: 500 }).notNull(),
    sourceUrl: text("source_url"),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    visibility: visibilityEnum("visibility").notNull().default("public"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
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
    embedding: vector("embedding"),
    tsvector: tsvector("tsvector"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("chunks_document_idx").on(t.documentId)],
);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id").references(() => demoProfiles.id, { onDelete: "set null" }),
  prompt: text("prompt").notNull(),
  model: varchar("model", { length: 255 }),
  chunkIds: uuid("chunk_ids").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
