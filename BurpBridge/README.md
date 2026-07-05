# BurpBridge Extension

This is the Burp Suite extension that powers the Burp tools in the MCP Terminal Bridge.
It runs a small HTTP server on `127.0.0.1:9876` inside Burp, allowing the MCP server (`server.js`) to control Burp programmatically.

---

## What It Does

Creates a local REST API inside Burp Suite on port `9876` with these endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/proxy/history` | GET | Returns last 200 proxy requests (url, method, status, base64 raw req/resp) |
| `/sitemap` | GET | Returns up to 500 URLs from Burp's site map |
| `/repeater/send` | POST | Sends a request through Burp and returns the response |
| `/repeater/open` | POST | Opens a request as a new Repeater tab in Burp UI |
| `/intruder/open` | POST | Stages a request in Burp's Intruder UI |
| `/scope/add` | POST | Adds a URL to Burp's target scope |
| `/scope/check` | GET | Checks if a URL is in scope |

---

## Requirements

- **Burp Suite** (Community or Pro) — v2023.x or newer (Montoya API)
- **Java 17+** (bundled with Burp)
- **Gson library** (`gson-2.10.1.jar` or newer) — needed for JSON handling

---

## How to Build the JAR

### Option A — Using Burp's built-in compiler (easiest)

1. Open Burp Suite
2. Go to **Extensions → Add**
3. Select **Extension type: Java**
4. Point it at `BurpBridgeExtension.java` directly — Burp compiles it for you  
   *(This works for simple single-file extensions)*

### Option B — Build manually with `javac` + `jar`

You need:
- `burp-montoya-api.jar` (download from [Burp's GitHub](https://github.com/PortSwigger/burp-extensions-montoya-api/releases))
- `gson-2.10.1.jar` (download from [Maven Central](https://repo1.maven.org/maven2/com/google/code/gson/gson/2.10.1/gson-2.10.1.jar))

**Kali Linux / macOS / Linux:**
```bash
# Create output directory
mkdir -p out

# Compile
javac -cp burp-montoya-api.jar:gson-2.10.1.jar \
      -d out \
      BurpBridgeExtension.java

# Package into JAR (include gson inside)
cd out
jar xf ../gson-2.10.1.jar
cd ..
jar cf BurpBridgeExtension.jar -C out .
```

**Windows (PowerShell):**
```powershell
# Create output directory
New-Item -ItemType Directory -Force out

# Compile
javac -cp "burp-montoya-api.jar;gson-2.10.1.jar" `
      -d out `
      BurpBridgeExtension.java

# Package into JAR (include gson inside)
Set-Location out
jar xf ..\gson-2.10.1.jar
Set-Location ..
jar cf BurpBridgeExtension.jar -C out .
```

---

## How to Install in Burp Suite

1. Open **Burp Suite**
2. Go to **Extensions** tab → **Installed** → **Add**
3. Set **Extension type** to `Java`
4. Under **Extension file**, click **Select file** and choose:
   - The compiled `BurpBridgeExtension.jar` (if you built it), **OR**
   - The `.java` source file directly (Burp can compile it)
5. Click **Next** — you should see in the **Output** tab:
   ```
   BurpBridge listening on 127.0.0.1:9876
   ```
6. Done! The MCP server can now control Burp.

---

## Verify It's Working

**Kali Linux:**
```bash
curl http://127.0.0.1:9876/proxy/history
```

**Windows (PowerShell):**
```powershell
Invoke-RestMethod http://127.0.0.1:9876/proxy/history
```

You should get a JSON array of proxy history entries.

---

## Notes

- The extension only listens on `127.0.0.1` (localhost) — it is **not** exposed to the network
- Works with both **Burp Community** and **Burp Pro**
- Scan tools (`burp_scan_start`, `burp_scan_status`, `burp_scan_issues`) require **Burp Pro** with REST API enabled on port `1337`
- If port `9876` is already in use, edit `PORT = 9876` in the Java file and update `BURP_BRIDGE_URL` in your `.env` or start script
