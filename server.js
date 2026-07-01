import express from "express";
import crypto from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { exec } from "child_process";

// ── CONFIG ────────────────────────────────────────────────
const MASTER_KEY = process.env.MASTER_KEY || "changeme"; // only YOU need to know this
const PUBLIC_URL = process.env.PUBLIC_URL; // e.g. https://xxxx.trycloudflare.com  (no trailing slash)
if (!PUBLIC_URL) { console.error("Set PUBLIC_URL=https://your-tunnel-domain"); process.exit(1); }

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// in-memory stores (fine for personal single-user use)
const clients = new Map();      // client_id -> { redirect_uris }
const authCodes = new Map();    // code -> { client_id, expires }
const accessTokens = new Set(); // valid bearer tokens

// ── OAuth metadata discovery (bare + path-specific, some clients probe both) ─
const asMetadata = {
  issuer: PUBLIC_URL,
  authorization_endpoint: `${PUBLIC_URL}/authorize`,
  token_endpoint: `${PUBLIC_URL}/token`,
  registration_endpoint: `${PUBLIC_URL}/register`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code"],
  code_challenge_methods_supported: ["S256", "plain"],
  token_endpoint_auth_methods_supported: ["none"],
};
const prMetadata = {
  resource: `${PUBLIC_URL}/mcp`,
  authorization_servers: [PUBLIC_URL],
};

app.get("/.well-known/oauth-authorization-server", (req, res) => res.json(asMetadata));
app.get("/.well-known/oauth-authorization-server/mcp", (req, res) => res.json(asMetadata));
app.get("/.well-known/oauth-protected-resource", (req, res) => res.json(prMetadata));
app.get("/.well-known/oauth-protected-resource/mcp", (req, res) => res.json(prMetadata));

// ── Dynamic Client Registration ──────────────────────────
app.post("/register", (req, res) => {
  const client_id = crypto.randomUUID();
  clients.set(client_id, { redirect_uris: req.body.redirect_uris || [] });
  res.status(201).json({
    client_id,
    redirect_uris: req.body.redirect_uris || [],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code"],
    response_types: ["code"],
  });
});

// ── Authorize: auto-approves if master key matches ───────
app.get("/authorize", (req, res) => {
  const { client_id, redirect_uri, state, key } = req.query;
  if (!redirect_uri) return res.status(400).send("missing redirect_uri");
  if (key !== MASTER_KEY) {
    return res.send(`
      <form method="GET">
        <input type="hidden" name="client_id" value="${client_id || ""}">
        <input type="hidden" name="redirect_uri" value="${redirect_uri}">
        <input type="hidden" name="state" value="${state || ""}">
        <p>Enter master key to approve this connection:</p>
        <input name="key" type="password" autofocus>
        <button type="submit">Approve</button>
      </form>`);
  }
  const code = crypto.randomUUID();
  authCodes.set(code, { client_id, expires: Date.now() + 5 * 60 * 1000 });
  const url = new URL(redirect_uri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  res.redirect(url.toString());
});

// ── Token exchange ────────────────────────────────────────
app.post("/token", (req, res) => {
  const { code, grant_type } = req.body;
  if (grant_type !== "authorization_code") return res.status(400).json({ error: "unsupported_grant_type" });
  const entry = authCodes.get(code);
  if (!entry || entry.expires < Date.now()) return res.status(400).json({ error: "invalid_grant" });
  authCodes.delete(code);
  const access_token = crypto.randomBytes(32).toString("hex");
  accessTokens.add(access_token);
  res.json({ access_token, token_type: "Bearer", expires_in: 3600 * 24 * 365 });
});

// ── MCP endpoint, protected ──────────────────────────────
function buildServer() {
  const server = new McpServer({ name: "kali-terminal", version: "1.0.0" });
  server.registerTool(
    "run_command",
    {
      title: "Run shell command",
      description: "Execute a shell command in the connected WSL Kali terminal and return stdout/stderr.",
      inputSchema: { command: z.string().describe("Full shell command to run") },
    },
    async ({ command }) => new Promise((resolve) => {
      exec(command, { timeout: 120000, maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
        resolve({ content: [{ type: "text", text: `EXIT: ${err ? err.code : 0}\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}` }] });
      });
    })
  );
  return server;
}

app.post("/mcp", async (req, res) => {
  const auth = req.headers["authorization"];
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token || !accessTokens.has(token)) {
    res.setHeader("WWW-Authenticate", `Bearer realm="mcp", resource_metadata="${PUBLIC_URL}/.well-known/oauth-protected-resource/mcp"`);
    return res.status(401).json({ error: "unauthorized" });
  }
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const PORT = 8787;
app.listen(PORT, () => console.log(`MCP terminal bridge running on :${PORT}, public=${PUBLIC_URL}`));
