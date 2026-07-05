# Kills old processes, starts a fresh cloudflared tunnel, then launches the merged
# terminal+Burp MCP server with the tunnel URL and a fresh master key.

Write-Host "[*] Killing any old cloudflared/node processes..."
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*node.exe" } | ForEach-Object {
    try { $_.CloseMainWindow() | Out-Null } catch {}
}
Start-Sleep -Seconds 1

Write-Host "[*] Starting fresh tunnel..."
$cfLog = "$env:TEMP\cf.log"
Remove-Item $cfLog -ErrorAction SilentlyContinue
Start-Process -FilePath ".\cloudflared.exe" -ArgumentList "tunnel --url http://localhost:8787" `
    -RedirectStandardOutput $cfLog -RedirectStandardError "$cfLog.err" -WindowStyle Hidden

Write-Host "[*] Waiting for tunnel URL..."
$url = $null
for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 1
    $content = ""
    if (Test-Path $cfLog) { $content += Get-Content $cfLog -Raw }
    if (Test-Path "$cfLog.err") { $content += Get-Content "$cfLog.err" -Raw }
    if ($content -match 'https://[a-zA-Z0-9.\-]*\.trycloudflare\.com') {
        $url = $matches[0]
        break
    }
}

if (-not $url) {
    Write-Host "[!] Failed to get tunnel URL, check $cfLog and $cfLog.err"
    exit 1
}

Write-Host "[*] Tunnel is live at: $url"

$masterKey = -join ((1..32) | ForEach-Object { "{0:x}" -f (Get-Random -Maximum 16) })
Write-Host ""
Write-Host "=========================================="
Write-Host " MASTER KEY (only shown here, don't paste"
Write-Host " this into any chat, ever):"
Write-Host ""
Write-Host " $masterKey"
Write-Host "=========================================="
Write-Host ""
Write-Host "[*] Connector URL for claude.ai:"
Write-Host " $url/mcp"
Write-Host ""
Write-Host "[*] Starting server..."

$env:PUBLIC_URL = $url
$env:MASTER_KEY = $masterKey
# Point these at your running Burp extension / native REST API if they differ:
if (-not $env:BURP_BRIDGE_URL) { $env:BURP_BRIDGE_URL = "http://127.0.0.1:9876" }
if (-not $env:BURP_REST_URL)   { $env:BURP_REST_URL = "http://127.0.0.1:1337" }
# Set $env:BURP_REST_KEY yourself before running this script if you want burp_scan_* tools to work.

node server.js
