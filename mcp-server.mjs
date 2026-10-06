#!/usr/bin/env node
// RAGnarok MCP server — single-file, dependency-free (Node stdlib only).
//
// Runs the Model Context Protocol over stdio (newline-delimited JSON-RPC 2.0)
// and exposes permission-aware retrieval from a RAGnarok deployment via its
// HTTP API. Nothing here touches the database or embeds text: the server side
// owns retrieval, embeddings and visibility enforcement.
//
// Run:
//   RAGNAROK_URL=http://localhost:3000 node mcp-server.mjs
// or, without cloning this repo:
//   curl -fsSL https://raw.githubusercontent.com/Nutomic/RAGnarok//main/mcp-server.mjs | node
//
// Environment:
//   RAGNAROK_URL  base URL (default: https://rag.nutomic.com)

import { createInterface } from "node:readline";

const BASE_URL = (process.env.RAGNAROK_URL || "https://rag.nutomic.com").replace(/\/+$/, "");

// --- MCP protocol plumbing ---------------------------------------------------

const PROTOCOL_VERSION = "2025-06-18";

const SERVER_INFO = {
  name: "ragnarok",
  version: "0.1.0",
};

const TOOLS = [
  {
    name: "search_documents",
    description:
      "Hybrid search (pgvector + German full-text) over EU law documents " +
      "(DS-GVO, AI Act) from a RAGnarok deployment. Returns excerpts with " +
      "citation labels and EUR-Lex links. Visibility is enforced server-side " +
      "per profile.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text (German)" },
        k: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          description: "Number of results (default 5)",
        },
        profile: {
          type: "string",
          enum: ["public", "compliance"],
          description:
            "Demo profile: 'public' sees only the KI-Verordnung, 'compliance' sees everything (default public)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_documents",
    description: "List the ingested corpus: titles, EUR-Lex CELEX ids, links and visibility.",
    inputSchema: { type: "object", properties: {} },
  },
];

function write(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function respond(id, result) {
  write({ jsonrpc: "2.0", id, result });
}

function respondError(id, code, message) {
  write({ jsonrpc: "2.0", id, error: { code, message } });
}

// --- Tool implementations (thin fetch clients) -------------------------------

async function api(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status} from ${path}`);
  return body;
}

async function searchDocuments(args) {
  const params = new URLSearchParams({
    q: args.query,
    profile: args.profile || "public",
    ...(args.k !== undefined ? { k: String(args.k) } : {}),
  });
  const data = await api(`/api/search?${params}`);
  if (!Array.isArray(data.results) || data.results.length === 0) {
    return { content: [{ type: "text", text: "No results." }] };
  }
  const text = data.results
    .map((r, i) => `[${i + 1}] ${r.label}:\n${r.excerpt}\n${r.url}`)
    .join("\n\n");
  return {
    content: [
      {
        type: "text",
        text:
          `Searched RAGnarok for "${data.query}" (profile: ${data.visibility}), ` +
          `${data.results.length} result(s):\n\n${text}`,
      },
    ],
  };
}

async function listDocuments() {
  const data = await api("/api/documents");
  if (!data.documents || data.documents.length === 0) {
    return { content: [{ type: "text", text: "No documents ingested." }] };
  }
  const text = data.documents
    .map(
      (d) =>
        `- ${d.title} (${d.visibility}) — ${d.chunkCount} chunks\n  CELEX ${d.celex}: ${d.sourceUrl}`,
    )
    .join("\n");
  return {
    content: [{ type: "text", text: `Corpus (${data.documents.length} documents):\n${text}` }],
  };
}

async function callTool(name, args) {
  switch (name) {
    case "search_documents":
      return searchDocuments(args);
    case "list_documents":
      return listDocuments();
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// --- Request dispatch ---------------------------------------------------------

async function handle(msg) {
  if (msg.jsonrpc !== "2.0" || typeof msg.id === "undefined") return; // notifications ignored
  const { id, method, params } = msg;
  try {
    switch (method) {
      case "initialize":
        respond(id, {
          protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
        break;
      case "ping":
        respond(id, {});
        break;
      case "tools/list":
        respond(id, { tools: TOOLS });
        break;
      case "tools/call": {
        try {
          respond(id, await callTool(params?.name, params?.arguments ?? {}));
        } catch (err) {
          respond(id, {
            content: [{ type: "text", text: `Error: ${err.message}` }],
            isError: true,
          });
        }
        break;
      }
      default:
        respondError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    respondError(id, -32603, `Internal error: ${err.message}`);
  }
}

// MCP stdio framing: one JSON-RPC message per line; stderr stays free for logs.
createInterface({ input: process.stdin }).on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  handle(msg);
});
