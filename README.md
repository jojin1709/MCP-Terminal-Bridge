# MCP Terminal Bridge

A lightweight OAuth2-protected MCP (Model Context Protocol) server that exposes your local terminal and Burp Suite to AI agents like Claude. Supports running shell commands remotely, controlling Burp Suite, and scanning web targets — all over a secure Cloudflare tunnel.

> **Developed by [JOJIN JOHN](https://github.com/jojin1709)** — Software Engineer | Ethical Hacker | Bug Bounty Hunter | Works on Windows & Kali Linux (native or WSL)

## Features
- 🔐 OAuth2 Authorization Flow — dynamic client registration, auth codes, bearer tokens
- 🖥️ Remote Shell Execution — run any command on your machine via AI
- 🕷️ Full Burp Suite Integration — proxy history, sitemap, repeater, intruder, scanner, macros
- 🌐 Cloudflare Tunnel — automatic public HTTPS URL, no port forwarding needed
- 🔑 Auto-generated Master Key — shown once at startup, never stored
- 🐧 Cross-platform — Windows (PowerShell), Kali Linux (Bash), and WSL2

## Prerequisites

| Requirement | Windows | Kali Linux / WSL |
|---|---|---|
| Node.js v18+ | [nodejs.org](https://nodejs.org) | `sudo apt install nodejs npm` |
| Maven + JDK 17+ (to build the Burp extension) | see below | `sudo apt install maven openjdk-17-jdk` |
| Cloudflared | bundled `cloudflared.exe` | install via `.deb` (see below) |
| Git | [git-scm.com](https://git-scm.com) | `sudo apt install git` |

### Installing Maven + JDK on Windows
```powershell
winget install EclipseAdoptium.Temurin.17.JDK
# If winget isn't available:
Invoke-WebRequest -Uri "https://dlcdn.apache.org/maven/maven-3/3.9.16/binaries/apache-maven-3.9.16-bin.zip" -OutFile "$HOME\Downloads\maven.zip"
Expand-Archive -Path "$HOME\Downloads\maven.zip" -DestinationPath "C:\Tools"
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\Tools\apache-maven-3.9.16\bin", "User")
# open a new terminal after this, then confirm:
mvn -v
```

## Installation

```bash
git clone https://github.com/jojin1709/MCP-Terminal-Bridge.git
cd MCP-Terminal-Bridge
npm install
```

### Install Cloudflared
**Kali Linux / WSL:**
```bash
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb
cloudflared --version
```
**Windows:** already bundled as `cloudflared.exe` in the project folder.

## Burp Suite Extension (BurpBridge)

`BurpBridge/` is a small Maven project that builds a Java extension exposing an HTTP API inside Burp on port `9876`, powering all `burp_*` tools.

**Important:** this extension depends on Gson for JSON handling. Burp's built-in "compile from source" option for extensions can't resolve third-party dependencies, so you must build a jar with Maven first — you cannot just point Burp at the raw `.java` file.

### Build it
```bash
cd BurpBridge
mvn package
```
This produces `target/burp-bridge.jar`.

### Load it in Burp
1. Open Burp Suite
2. **Extensions** tab → **Add**
3. Extension type: **Java**
4. Select file → `BurpBridge/target/burp-bridge.jar`
5. Check the **Output** tab for: `BurpBridge listening on :9876`

### Enable Burp's native REST API (Pro, optional — needed for `burp_scan_*` tools)
**Settings → Suite → REST API** → tick "Service running" → click **New** under API Keys → save the key.

### Networking note (WSL users, read this)
BurpBridge binds to **all network interfaces**, not just `127.0.0.1` — this is required so WSL (which has its own network namespace, separate from Windows) can reach it. Burp itself runs on Windows; if your bridge server runs inside WSL, `127.0.0.1` inside WSL does **not** reach Windows.

This has two real consequences:
- **Security tradeoff:** anything on your LAN can technically reach port 9876/1337 if they know to try — there's no auth on those ports (unlike the OAuth-protected `/mcp` endpoint). Fine on a trusted home network, worth knowing otherwise.
- **You need your Windows host IP from inside WSL:**
  ```bash
  cat /etc/resolv.conf | grep nameserver
  ```
  Use that IP for `BURP_BRIDGE_URL` / `BURP_REST_URL` below, and also set Burp's native REST API to bind on **all interfaces** (Settings → Suite → REST API → Change), not just loopback.
- **Windows Firewall must allow it in** — run once in an elevated PowerShell:
  ```powershell
  New-NetFirewallRule -DisplayName "WSL Burp Bridge" -Direction Inbound -LocalPort 9876,1337 -Protocol TCP -Action Allow
  ```

If your bridge server runs directly on Windows (not WSL) alongside Burp, none of this networking section applies — `127.0.0.1` just works.

### Verify the extension is reachable
```bash
curl http://127.0.0.1:9876/sitemap          # same machine
curl http://<windows-host-ip>:9876/sitemap  # from WSL
```
You should get back `{"items":[],"returned":0,...}` or similar.

## Running the Server

**Kali Linux / WSL:**
```bash
chmod +x start.sh
./start.sh
```

**Windows (PowerShell):**
```powershell
# If script execution is blocked, run once:
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned

.\start.ps1
```

The script will:
1. Kill any old cloudflared/node processes
2. Start a fresh Cloudflare tunnel
3. Generate a random master key (shown once — **never paste this into any chat**)
4. Print the MCP connector URL
5. Start the Node.js server

Example output:
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

**Note:** a new tunnel URL and master key are generated every run. If you restart the bridge, you'll need to update the connector URL in claude.ai and re-authorize.

## Connecting to Claude

1. Go to **claude.ai → Settings → Connectors → Add custom connector**
2. **Name:** anything, e.g. `Terminal + Burp`
3. **Remote MCP server URL:** paste the printed `.../mcp` URL
4. Leave OAuth Client ID/Secret blank — the server handles its own auth
5. Click **Add** — it'll redirect to an authorize page asking for the master key
6. Enter it there (not in chat) → approve
7. Claude can now run commands and use the Burp tools

## Available MCP Tools

### Terminal
| Tool | Description |
|---|---|
| `run_command` | Run any shell command — returns stdout, stderr, exit code |

### Burp Suite (requires BurpBridge extension on port 9876)
| Tool | Description |
|---|---|
| `burp_proxy_history` | Recent proxy traffic. Params: `scope_only` (filter to in-scope hosts, recommended), `limit` (default 100, max 500), `include_body` (default false — headers only unless you need raw bytes) |
| `burp_sitemap` | URLs Burp has seen for the target. Params: `scope_only`, `limit` (default 200, max 1000) |
| `burp_send_request` | Send a request through Burp's engine (like Repeater) and get the response — silent, no UI trace |
| `burp_open_in_repeater` | Open a request as a visible Repeater tab in Burp's UI |
| `burp_open_in_intruder` | Stage a request in Burp's Intruder UI (you configure payloads and launch manually — Burp's API doesn't allow automating the actual attack or reading results) |
| `burp_scope_add` | Add a URL/host to Burp's target scope |
| `burp_scope_check` | Check if a URL is in Burp's scope |
| `burp_run_macro` | Run multi-step request chains with regex-based variable extraction (login → grab CSRF/session token → use it on the real request) |
| `burp_edit_and_send` | Build or modify a raw HTTP request and send it, or open it in Repeater |

### Burp Suite Pro (requires native REST API on port 1337)
| Tool | Description |
|---|---|
| `burp_scan_start` | Start a scan. Pass `scan_configurations` for a crawl-only pass instead of full audit |
| `burp_scan_status` | Raw scan status and issue events |
| `burp_scan_issues` | Simplified, cleaned-up list of found vulnerabilities |

## Environment Variables Reference

| Variable | Default | Description |
|---|---|---|
| `PUBLIC_URL` | (required) | Your tunnel URL, e.g. `https://xxx.trycloudflare.com` |
| `MASTER_KEY` | `changeme` | Auth key shown to user on first connect |
| `BURP_BRIDGE_URL` | `http://127.0.0.1:9876` | URL of BurpBridge extension — use Windows host IP from WSL |
| `BURP_REST_URL` | `http://127.0.0.1:1337` | URL of Burp Pro native REST API — use Windows host IP from WSL |
| `BURP_REST_KEY` | (empty) | API key for Burp Pro REST API |

## Troubleshooting

**"Address already in use" when loading the extension in Burp**
The previous instance didn't release the socket cleanly. Fully close and reopen Burp, then reload the extension.

**`burp_*` tools return connection errors**
1. Is Burp open with BurpBridge loaded? Check the Output tab for the listening message.
2. Running the bridge server from WSL? See the Networking section above — you almost certainly need the Windows host IP, not `127.0.0.1`.
3. Firewall blocking it? Re-run the `New-NetFirewallRule` command above from an elevated PowerShell.

**`mvn` not recognized**
Maven isn't on PATH for this session. Either re-run:
```powershell
$env:Path += ";C:\Tools\apache-maven-3.9.16\bin"
```
or make it permanent (see Prerequisites above), then open a **new** terminal.

**Port 8787 already in use**
```bash
# Kali/WSL
pkill -f "node server.js"
```
```powershell
# Windows
Get-Process node | Stop-Process -Force
```

**PowerShell execution policy error**
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

## Security Notes
- **Never share your `MASTER_KEY`** — it grants full shell access to your machine, and it's shown only once per run.
- **Never paste the key into Claude or any chat** — the start scripts warn you about this for a reason.
- BurpBridge listens on **all network interfaces** (needed for WSL) — anyone on your LAN can technically reach it; there's no auth on that port. Fine on a trusted network, not something to run on a shared/public one.
- The server uses in-memory token storage — tokens are lost on restart (by design, for personal single-user use).
- Always use HTTPS (Cloudflare tunnel provides this automatically).
- `run_command` has no restrictions — any authenticated client can run any command. Treat the master key like a root password.

## Project Structure
```
mcp-terminal/
├── server.js              # Main MCP + OAuth2 server
├── start.sh               # Kali Linux / WSL startup script
├── start.ps1              # Windows PowerShell startup script
├── package.json           # Node.js dependencies
├── cloudflared.exe        # Cloudflared binary for Windows (not in git)
├── cloudflared.deb        # Cloudflared package for Linux (not in git)
├── BurpBridge/
│   ├── pom.xml                       # Maven build file
│   ├── src/main/java/burpbridge/
│   │   └── BurpBridgeExtension.java  # Burp Suite extension source
│   └── target/burp-bridge.jar        # built jar (gitignored, build it yourself)
└── README.md              # This file
```

## FAQ

**What is MCP?**
Model Context Protocol — a standard for exposing tools and data to AI agents. This server implements the MCP spec over HTTP with OAuth2 auth.

**Can I use this without Burp Suite?**
Yes — `run_command` works independently. Burp tools will just return connection errors if Burp isn't running or reachable.

**Is it safe to run on a public URL?**
The `/mcp` endpoint is protected by OAuth2 + master key. The BurpBridge extension's own ports (9876/1337) are not — see Security Notes. Don't share the master key, and don't leave the tunnel running longer than you need it.

**Does it work on WSL?**
Yes, but read the Networking section above first — it's the single most common thing that breaks for WSL users.

## License

Copyright (c) 2025 **JOJIN JOHN**

MIT License — Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

*Developed by **JOJIN JOHN** — Software Engineer | Ethical Hacker | Bug Bounty Hunter*
