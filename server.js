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

// Burp bridge (BurpBridge extension) + Burp's native scan REST API (Pro only)
const BURP_BRIDGE_URL = process.env.BURP_BRIDGE_URL || "http://127.0.0.1:9876";
const BURP_REST_URL = process.env.BURP_REST_URL || "http://127.0.0.1:1337";
const BURP_REST_KEY = process.env.BURP_REST_KEY || "";

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
  const server = new McpServer({ name: "kali-terminal-burp", version: "1.0.0" });

  // ── Terminal tool (your original) ──
  server.registerTool(
    "run_command",
    {
      title: "Run shell command",
      description: "Execute a shell command in the connected terminal and return stdout/stderr.",
      inputSchema: { command: z.string().describe("Full shell command to run") },
    },
    async ({ command }) => new Promise((resolve) => {
      exec(command, { timeout: 120000, maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
        resolve({ content: [{ type: "text", text: `EXIT: ${err ? err.code : 0}\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}` }] });
      });
    })
  );

  // ── Burp tools ──
  server.registerTool(
    "burp_proxy_history",
    {
      title: "Burp proxy history",
      description: "Get recent Burp proxy history (url, method, status). Headers-only by default to keep results small and reliable; pass include_body=true for full base64 request/response bytes on a smaller/filtered set. Use scope_only=true to cut out browser noise (telemetry, ads, etc.) and only see traffic to your added scope.",
      inputSchema: {
        scope_only: z.boolean().optional().describe("Only return requests to hosts in Burp's scope (recommended - cuts out browser noise)"),
        limit: z.number().optional().describe("Max entries to return, most recent first (default 100, max 500)"),
        include_body: z.boolean().optional().describe("Include full base64 request/response bodies (default false - keep this off unless you actually need bodies, it's what causes oversized/unreliable responses)"),
      },
    },
    async ({ scope_only, limit, include_body }) => {
      const qs = new URLSearchParams();
      if (scope_only) qs.set("scope_only", "true");
      if (limit) qs.set("limit", String(limit));
      if (include_body) qs.set("include_body", "true");
      const r = await fetch(`${BURP_BRIDGE_URL}/proxy/history?${qs}`);
      return { content: [{ type: "text", text: await r.text() }] };
    }
  );

  server.registerTool(
    "burp_sitemap",
    {
      title: "Burp site map",
      description: "Get Burp's site map entries (urls Burp has seen for the target). Use scope_only=true to cut out noise.",
      inputSchema: {
        scope_only: z.boolean().optional().describe("Only return entries in Burp's scope"),
        limit: z.number().optional().describe("Max entries to return (default 200, max 1000)"),
      },
    },
    async ({ scope_only, limit }) => {
      const qs = new URLSearchParams();
      if (scope_only) qs.set("scope_only", "true");
      if (limit) qs.set("limit", String(limit));
      const r = await fetch(`${BURP_BRIDGE_URL}/sitemap?${qs}`);
      return { content: [{ type: "text", text: await r.text() }] };
    }
  );

  server.registerTool(
    "burp_send_request",
    {
      title: "Send request via Burp",
      description: "Send an HTTP request through Burp's engine (equivalent to Repeater) and return the response.",
      inputSchema: {
        url: z.string().describe("Target URL, e.g. https://host/path"),
        raw_base64: z.string().optional().describe("Optional full raw HTTP request bytes, base64-encoded"),
      },
    },
    async ({ url, raw_base64 }) => {
      const r = await fetch(`${BURP_BRIDGE_URL}/repeater/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, raw: raw_base64 || "" }),
      });
      return { content: [{ type: "text", text: await r.text() }] };
    }
  );

  server.registerTool(
    "burp_open_in_repeater",
    {
      title: "Open in Burp Repeater",
      description: "Open a request as a visible tab in Burp's Repeater UI (so you can see and manually resend it in Burp itself). Does not return a response — use burp_send_request for that.",
      inputSchema: {
        url: z.string().describe("Target URL, e.g. https://host/path"),
        raw_base64: z.string().optional().describe("Optional full raw HTTP request bytes, base64-encoded"),
        tab_name: z.string().optional().describe("Name for the Repeater tab (default: MCP)"),
      },
    },
    async ({ url, raw_base64, tab_name }) => {
      const r = await fetch(`${BURP_BRIDGE_URL}/repeater/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, raw: raw_base64 || "", tabName: tab_name || "MCP" }),
      });
      return { content: [{ type: "text", text: await r.text() }] };
    }
  );

  server.registerTool(
    "burp_scope_add",
    {
      title: "Add to Burp scope",
      description: "Add a URL/host to Burp's target scope.",
      inputSchema: { url: z.string() },
    },
    async ({ url }) => {
      const r = await fetch(`${BURP_BRIDGE_URL}/scope/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      return { content: [{ type: "text", text: await r.text() }] };
    }
  );

  server.registerTool(
    "burp_scope_check",
    {
      title: "Check Burp scope",
      description: "Check whether a URL is currently in Burp's scope.",
      inputSchema: { url: z.string() },
    },
    async ({ url }) => {
      const r = await fetch(`${BURP_BRIDGE_URL}/scope/check?url=${encodeURIComponent(url)}`);
      return { content: [{ type: "text", text: await r.text() }] };
    }
  );

  server.registerTool(
    "burp_scan_start",
    {
      title: "Start Burp active scan",
      description: "Start a scan via Burp's native REST API (Burp Pro only; requires REST API enabled with an API key). Pass scan_configurations to run a crawl-only pass instead of a full audit, e.g. [{name:'Crawl strategy - fastest'}] (names must match entries in Burp's Configuration Library).",
      inputSchema: {
        urls: z.array(z.string()),
        scan_configurations: z.array(z.object({ type: z.string().optional(), name: z.string() })).optional(),
      },
    },
    async ({ urls, scan_configurations }) => {
      const payload = { urls };
      if (scan_configurations) payload.scan_configurations = scan_configurations;
      const r = await fetch(`${BURP_REST_URL}/v0.1/scan?key=${BURP_REST_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const loc = r.headers.get("location") || "";
      const taskId = loc.split("/").pop();
      return { content: [{ type: "text", text: JSON.stringify({ task_id: taskId, http_status: r.status }) }] };
    }
  );

  server.registerTool(
    "burp_scan_status",
    {
      title: "Burp scan status",
      description: "Poll status and issues for a scan task started with burp_scan_start.",
      inputSchema: { task_id: z.string() },
    },
    async ({ task_id }) => {
      const r = await fetch(`${BURP_REST_URL}/v0.1/scan/${task_id}?key=${BURP_REST_KEY}`);
      return { content: [{ type: "text", text: await r.text() }] };
    }
  );

  server.registerTool(
    "burp_open_in_intruder",
    {
      title: "Open in Burp Intruder",
      description: "Open a request as a new tab in Burp's Intruder UI so you can configure payload positions and launch the attack yourself. Burp's public API does not allow configuring payload sets or reading attack results programmatically, so this only stages the tab — you click Start in Burp.",
      inputSchema: {
        url: z.string(),
        raw_base64: z.string().optional(),
      },
    },
    async ({ url, raw_base64 }) => {
      const r = await fetch(`${BURP_BRIDGE_URL}/intruder/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, raw: raw_base64 || "" }),
      });
      return { content: [{ type: "text", text: await r.text() }] };
    }
  );

  server.registerTool(
    "burp_run_macro",
    {
      title: "Run a request macro (login chains, tokens)",
      description: "Run a sequence of HTTP requests through Burp, extracting a value from each response via regex and substituting it into later steps with {{var_name}} placeholders (in the URL or in a raw request's headers/body). Replicates what Burp's UI session-handling rules/macros do — e.g. log in, grab a CSRF token or session cookie, then use it on the real request.",
      inputSchema: {
        steps: z.array(z.object({
          url: z.string(),
          raw_base64: z.string().optional().describe("Optional raw request; {{var_name}} placeholders get substituted before sending"),
          extract: z.object({
            regex: z.string(),
            group: z.number().optional(),
            var_name: z.string(),
          }).optional(),
        })),
      },
    },
    async ({ steps }) => {
      const vars = {};
      const results = [];
      const substitute = (text) => text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");

      for (const step of steps) {
        const url = substitute(step.url);
        let rawB64 = step.raw_base64;
        if (rawB64) {
          const rawText = Buffer.from(rawB64, "base64").toString("utf-8");
          rawB64 = Buffer.from(substitute(rawText), "utf-8").toString("base64");
        }
        const r = await fetch(`${BURP_BRIDGE_URL}/repeater/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, raw: rawB64 || "" }),
        });
        let respJson;
        try { respJson = await r.json(); } catch { respJson = {}; }
        let extracted = null;
        if (step.extract && respJson.responseB64) {
          const respText = Buffer.from(respJson.responseB64, "base64").toString("utf-8");
          const m = respText.match(new RegExp(step.extract.regex));
          if (m) {
            extracted = m[step.extract.group ?? 1] ?? m[0];
            vars[step.extract.var_name] = extracted;
          }
        }
        results.push({ url, status: respJson.status, extracted });
      }
      return { content: [{ type: "text", text: JSON.stringify({ vars, results }) }] };
    }
  );

  server.registerTool(
    "burp_edit_and_send",
    {
      title: "Edit and send a request",
      description: "Build a raw HTTP request from scratch (method/headers/body), or start from an existing raw request and override specific headers/body, then send it through Burp — either silently (mode=send) or opened visibly in Repeater (mode=repeater).",
      inputSchema: {
        url: z.string(),
        method: z.string().optional(),
        raw_request_text: z.string().optional().describe("Full raw HTTP request as plain text, to start from an existing captured request instead of building fresh"),
        set_headers: z.record(z.string(), z.string()).optional(),
        body: z.string().optional(),
        mode: z.enum(["send", "repeater"]).optional(),
        tab_name: z.string().optional(),
      },
    },
    async ({ url, method, raw_request_text, set_headers, body, mode, tab_name }) => {
      let requestText = raw_request_text;
      if (!requestText) {
        const u = new URL(url);
        const m = method || (body ? "POST" : "GET");
        let headers = `Host: ${u.host}\r\nConnection: close\r\n`;
        for (const [k, v] of Object.entries(set_headers || {})) headers += `${k}: ${v}\r\n`;
        if (body) headers += `Content-Length: ${Buffer.byteLength(body)}\r\n`;
        requestText = `${m} ${u.pathname}${u.search} HTTP/1.1\r\n${headers}\r\n${body || ""}`;
      } else if (set_headers || body !== undefined) {
        const parts = requestText.split("\r\n\r\n");
        const headPart = parts[0];
        const bodyPart = parts.slice(1).join("\r\n\r\n");
        let lines = headPart.split("\r\n");
        for (const [k, v] of Object.entries(set_headers || {})) {
          const idx = lines.findIndex((l) => l.toLowerCase().startsWith(k.toLowerCase() + ":"));
          if (idx >= 0) lines[idx] = `${k}: ${v}`;
          else lines.push(`${k}: ${v}`);
        }
        requestText = lines.join("\r\n") + "\r\n\r\n" + (body !== undefined ? body : bodyPart);
      }
      const rawB64 = Buffer.from(requestText, "utf-8").toString("base64");
      const endpoint = mode === "repeater" ? "/repeater/open" : "/repeater/send";
      const r = await fetch(`${BURP_BRIDGE_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, raw: rawB64, tabName: tab_name || "MCP" }),
      });
      return { content: [{ type: "text", text: await r.text() }] };
    }
  );

  server.registerTool(
    "burp_scan_issues",
    {
      title: "Get Burp scan issues",
      description: "Fetch a scan task's status and pull out a simplified list of found issues (type, severity, confidence, affected URL, description) from Burp's native REST API. Falls back to the raw response if the issue fields don't match the expected shape (API format can vary slightly by Burp version).",
      inputSchema: { task_id: z.string() },
    },
    async ({ task_id }) => {
      const r = await fetch(`${BURP_REST_URL}/v0.1/scan/${task_id}?key=${BURP_REST_KEY}`);
      let data;
      try { data = await r.json(); } catch {
        return { content: [{ type: "text", text: `Non-JSON response (status ${r.status})` }] };
      }
      const events = data.issue_events || data.issues || [];
      if (!Array.isArray(events) || events.length === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ scan_status: data.scan_status || data.status, issue_count: 0, raw: data }) }] };
      }
      const simplified = events.map((e) => {
        const issue = e.issue || e;
        return {
          name: issue.name || issue.issue_type_name || issue.type,
          severity: issue.severity,
          confidence: issue.confidence,
          url: issue.origin && issue.path ? `${issue.origin}${issue.path}` : (issue.url || issue.origin || issue.path),
          description: (issue.description || "").replace(/<[^>]+>/g, "").slice(0, 300),
        };
      });
      return { content: [{ type: "text", text: JSON.stringify({ scan_status: data.scan_status || data.status, issue_count: simplified.length, issues: simplified }) }] };
    }
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
app.listen(PORT, () => console.log(`MCP terminal+burp bridge running on :${PORT}, public=${PUBLIC_URL}`));
