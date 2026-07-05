# MCP Terminal Bridge

A lightweight **OAuth2-protected MCP (Model Context Protocol) server** that exposes your local terminal and Burp Suite to AI agents like Claude. Supports running shell commands remotely, controlling Burp Suite, and scanning web targets — all over a secure Cloudflare tunnel.

> **Developed by JOJIN JOHN** | Works on Windows & Kali Linux

---

## Features

- 🔐 **OAuth2 Authorization Flow** — dynamic client registration, auth codes, bearer tokens
- 🖥️ **Remote Shell Execution** — run any command on your machine via AI
- 🕷️ **Full Burp Suite Integration** — proxy history, sitemap, repeater, intruder, scanner, macros
- 🌐 **Cloudflare Tunnel** — automatic public HTTPS URL, no port forwarding needed
- 🔑 **Auto-generated Master Key** — shown once at startup, never stored
- 🐧 **Cross-platform** — Windows (PowerShell) & Kali Linux (Bash)

---

## Prerequisites

| Requirement | Windows | Kali Linux |
|-------------|---------|------------|
| Node.js v18+ | [nodejs.org](https://nodejs.org) | `sudo apt install nodejs npm` |
| Cloudflared | bundled `cloudflared.exe` | install via `.deb` (see below) |
| Git | [git-scm.com](https://git-scm.com) | `sudo apt install git` |
| openssl | built-in | `sudo apt install openssl` |

---

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/jojin1709/MCP-Terminal-Bridge.git
cd MCP-Terminal-Bridge
```

### 2. Install Node Dependencies

```bash
npm install
```

### 3. Install Cloudflared

**Kali Linux:**
```bash
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb
cloudflared --version
```

**Windows:**  
Already bundled as `cloudflared.exe` in the project folder. No extra install needed.

---

## Running the Server

### 🐧 Kali Linux

```bash
# Make the script executable (first time only)
chmod +x start.sh

# Start the server
./start.sh
```

### 🪟 Windows (PowerShell)

```powershell
# If script execution is blocked, run this first (once):
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned

# Start the server
.\start.ps1
```

The script will:
1. Kill any old cloudflared/node processes
2. Start a fresh Cloudflare tunnel
3. Generate a random master key (shown once)
4. Print the MCP connector URL
5. Start the Node.js server

**Example output:**
```
[*] Tunnel is live at: https://abc123.trycloudflare.com
==========================================
 MASTER KEY (only shown here, don't paste
 this into any chat, ever):

 a1b2c3d4e5f6...
==========================================

[*] Connector URL for claude.ai:
 https://abc123.trycloudflare.com/mcp
```

---

## Connecting to Claude

1. Go to **claude.ai → Settings → Integrations**
2. Click **Add Integration**
3. Paste your connector URL: `https://xxxx.trycloudflare.com/mcp`
4. Claude will open a browser auth page — enter your **master key**
5. Done! Claude can now run commands on your machine

---

## Manual / Advanced Usage

### Set Environment Variables Manually

**Kali Linux:**
```bash
export PUBLIC_URL=https://your-tunnel-domain.trycloudflare.com
export MASTER_KEY=your-secret-key
export BURP_BRIDGE_URL=http://127.0.0.1:9876      # optional
export BURP_REST_URL=http://127.0.0.1:1337          # optional (Burp Pro)
export BURP_REST_KEY=your-burp-api-key              # optional (Burp Pro)
node server.js
```

**Windows (PowerShell):**
```powershell
$env:PUBLIC_URL  = "https://your-tunnel-domain.trycloudflare.com"
$env:MASTER_KEY  = "your-secret-key"
$env:BURP_BRIDGE_URL = "http://127.0.0.1:9876"     # optional
$env:BURP_REST_URL   = "http://127.0.0.1:1337"     # optional (Burp Pro)
$env:BURP_REST_KEY   = "your-burp-api-key"         # optional (Burp Pro)
node server.js
```

### Start Cloudflared Manually

**Kali Linux:**
```bash
cloudflared tunnel --url http://localhost:8787
```

**Windows:**
```powershell
.\cloudflared.exe tunnel --url http://localhost:8787
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/.well-known/oauth-authorization-server` | OAuth2 server metadata |
| `GET` | `/.well-known/oauth-protected-resource` | OAuth2 resource metadata |
| `POST` | `/register` | Dynamic client registration |
| `GET` | `/authorize` | Authorization (enter master key) |
| `POST` | `/token` | Exchange auth code for bearer token |
| `POST` | `/mcp` | **MCP endpoint** (requires Bearer token) |

### Test the Server Locally

**Kali Linux:**
```bash
# Check OAuth metadata
curl http://localhost:8787/.well-known/oauth-authorization-server

# Register a client
curl -X POST http://localhost:8787/register \
  -H "Content-Type: application/json" \
  -d '{"redirect_uris": ["http://localhost:3000/callback"]}'

# Check protected resource metadata
curl http://localhost:8787/.well-known/oauth-protected-resource
```

**Windows (PowerShell):**
```powershell
# Check OAuth metadata
Invoke-RestMethod http://localhost:8787/.well-known/oauth-authorization-server

# Register a client
Invoke-RestMethod -Method POST http://localhost:8787/register `
  -ContentType "application/json" `
  -Body '{"redirect_uris": ["http://localhost:3000/callback"]}'

# Check protected resource metadata
Invoke-RestMethod http://localhost:8787/.well-known/oauth-protected-resource
```

---

## Available MCP Tools

### Terminal

| Tool | Description |
|------|-------------|
| `run_command` | Run any shell command — returns stdout, stderr, exit code |

### Burp Suite (requires BurpBridge extension on port 9876)

| Tool | Description |
|------|-------------|
| `burp_proxy_history` | Get recent proxy traffic (method, URL, status, raw request/response base64) |
| `burp_sitemap` | Get all URLs Burp has seen for the target |
| `burp_send_request` | Send a request through Burp's engine (like Repeater) and get the response |
| `burp_open_in_repeater` | Open a request as a visible Repeater tab in Burp UI |
| `burp_open_in_intruder` | Stage a request in Burp's Intruder UI |
| `burp_scope_add` | Add a URL/host to Burp's target scope |
| `burp_scope_check` | Check if a URL is in Burp's scope |
| `burp_run_macro` | Run multi-step request chains with variable extraction (login → grab CSRF → use it) |
| `burp_edit_and_send` | Build or modify a raw HTTP request and send it or open in Repeater |

### Burp Suite Pro (requires native REST API on port 1337)

| Tool | Description |
|------|-------------|
| `burp_scan_start` | Start an active scan (Pro only) |
| `burp_scan_status` | Poll raw scan status and issues |
| `burp_scan_issues` | Get simplified, cleaned-up list of found vulnerabilities |

---

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `PUBLIC_URL` | *(required)* | Your tunnel URL, e.g. `https://xxx.trycloudflare.com` |
| `MASTER_KEY` | `changeme` | Auth key shown to user on first connect |
| `BURP_BRIDGE_URL` | `http://127.0.0.1:9876` | URL of BurpBridge extension |
| `BURP_REST_URL` | `http://127.0.0.1:1337` | URL of Burp Pro native REST API |
| `BURP_REST_KEY` | *(empty)* | API key for Burp Pro REST API |

---

## Troubleshooting

### Port Already in Use

**Kali Linux:**
```bash
# Find what's using port 8787
sudo lsof -i :8787

# Kill it
sudo kill -9 <PID>

# Or kill all node processes
pkill -f "node server.js"
```

**Windows:**
```powershell
# Find what's using port 8787
netstat -ano | findstr :8787

# Kill by PID
Stop-Process -Id <PID> -Force

# Or kill all node processes
Get-Process node | Stop-Process -Force
```

---

### Cloudflared Not Found

**Kali Linux:**
```bash
# Reinstall
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb

# Verify
cloudflared --version
```

**Windows:**
Make sure `cloudflared.exe` is in the project folder. If missing, download from:
```
https://github.com/cloudflare/cloudflared/releases/latest
```

---

### Node.js Not Found

**Kali Linux:**
```bash
# Install Node.js via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version
```

**Windows:**
Download the LTS installer from [nodejs.org](https://nodejs.org) and install it. Then restart PowerShell.

---

### PowerShell Execution Policy Error

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

---

### npm install Fails

```bash
# Clear cache and retry
npm cache clean --force
npm install
```

---

### Missing Dependencies

```bash
npm install
```

---

## Security Notes

- **Never share your MASTER_KEY** — it grants full shell access to your machine
- **Never paste the key into Claude or any chat** — the start scripts warn you about this
- The server uses **in-memory token storage** — tokens are lost on restart (by design, for personal use)
- Always use **HTTPS** (Cloudflare tunnel provides this automatically)
- The `run_command` tool has **no restrictions** — any authenticated client can run any command

---

## Project Structure

```
mcp-terminal/
├── server.js          # Main MCP + OAuth2 server
├── start.sh           # Kali Linux startup script
├── start.ps1          # Windows PowerShell startup script
├── package.json       # Node.js dependencies
├── cloudflared.exe    # Cloudflared binary for Windows
├── cloudflared.deb    # Cloudflared package for Linux
└── README.md          # This file
```

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -am 'Add your feature'`
4. Push: `git push origin feature/your-feature`
5. Open a Pull Request

---

## FAQ

**What is MCP?**  
Model Context Protocol — a standard for exposing tools and data to AI agents. This server implements the MCP spec over HTTP with OAuth2 auth.

**Can I use this without Burp Suite?**  
Yes! The `run_command` tool works independently. Burp tools will just return connection errors if Burp isn't running.

**Is it safe to run on a public URL?**  
The server is protected by OAuth2 + master key. Do not share the key. Cloudflare tunnel URLs are randomly generated and expire when you stop cloudflared.

**Does it work on WSL (Windows Subsystem for Linux)?**  
Yes — treat it like Kali Linux and use `start.sh`.

---

## License

MIT

---

*Developed by JOJIN JOHN — Software Engineer | Ethical Hacker | Bug Bounty Hunter*
