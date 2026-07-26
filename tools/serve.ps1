# Tiny static file server for local development.
# There's no node or python on this machine, so this stands in for
# `npx serve` / `python -m http.server`.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\serve.ps1
#
# Binds every interface, so the site is reachable from a phone on the same
# wifi at http://<your-lan-ip>:5173/ — see README.md, Windows Firewall has to
# allow the port first. Pass -LocalOnly to go back to loopback only.
#
# Uses a raw TcpListener rather than HttpListener on purpose: HttpListener
# needs an admin-only `netsh http add urlacl` reservation for any prefix other
# than localhost, and this way the firewall rule is the only elevated step.
param(
  [string]$Root,
  [int]$Port = 5173,
  [switch]$LocalOnly
)

$ErrorActionPreference = 'Stop'

if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
$Root = [System.IO.Path]::GetFullPath($Root)

$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.webp' = 'image/webp'
  '.woff2'= 'font/woff2'
  '.ico'  = 'image/x-icon'
}

$reasons = @{ 200 = 'OK'; 400 = 'Bad Request'; 404 = 'Not Found'; 405 = 'Method Not Allowed' }

$bind = if ($LocalOnly) { [System.Net.IPAddress]::Loopback } else { [System.Net.IPAddress]::Any }
$listener = New-Object System.Net.Sockets.TcpListener($bind, $Port)
$listener.Start()

Write-Output "serving $Root"
Write-Output "  http://localhost:$Port/"
if (-not $LocalOnly) {
  Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    ForEach-Object { Write-Output "  http://$($_.IPAddress):$Port/   ($($_.InterfaceAlias))" }
}

while ($true) {
  $client = $listener.AcceptTcpClient()
  $status = 400
  $target = '-'
  try {
    $client.NoDelay = $true
    $stream = $client.GetStream()
    $stream.ReadTimeout = 5000

    # Read until the end of the header block. No request bodies are expected.
    $buf = New-Object byte[] 8192
    $sb = New-Object System.Text.StringBuilder
    while ($sb.ToString().IndexOf("`r`n`r`n") -lt 0 -and $sb.Length -lt 65536) {
      $n = $stream.Read($buf, 0, $buf.Length)
      if ($n -le 0) { break }
      [void]$sb.Append([System.Text.Encoding]::ASCII.GetString($buf, 0, $n))
    }

    $parts  = (($sb.ToString() -split "`r`n")[0]) -split ' '
    $method = $parts[0]
    $target = if ($parts.Count -ge 2) { $parts[1] } else { '/' }

    $bytes = [byte[]]@()
    $ctype = 'text/plain; charset=utf-8'

    if ($method -ne 'GET' -and $method -ne 'HEAD') {
      $status = 405
      $bytes = [System.Text.Encoding]::UTF8.GetBytes('method not allowed')
    } else {
      # Strip query and fragment, then decode.
      $rel = ($target -split '[?#]')[0]
      $rel = [System.Uri]::UnescapeDataString($rel).TrimStart('/')
      if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }

      $full = $null
      try { $full = [System.IO.Path]::GetFullPath((Join-Path $Root ($rel -replace '/', '\'))) } catch { }

      # Een map serveert haar index.html, net als GitHub Pages. Zonder dit gedraagt
      # de dev-server zich anders dan de plek waar het uiteindelijk staat.
      if ($full -and (Test-Path $full -PathType Container)) {
        $full = Join-Path $full 'index.html'
      }

      if ($full -and $full.StartsWith($Root) -and (Test-Path $full -PathType Leaf)) {
        $status = 200
        $ext = [System.IO.Path]::GetExtension($full).ToLower()
        if ($types.ContainsKey($ext)) { $ctype = $types[$ext] } else { $ctype = 'application/octet-stream' }
        $bytes = [System.IO.File]::ReadAllBytes($full)
      } else {
        $status = 404
        $bytes = [System.Text.Encoding]::UTF8.GetBytes('not found')
      }
    }

    $head = "HTTP/1.1 $status $($reasons[$status])`r`n" +
            "Content-Type: $ctype`r`n" +
            "Content-Length: $($bytes.Length)`r`n" +
            "Cache-Control: no-store`r`n" +
            "Connection: close`r`n`r`n"
    $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
    $stream.Write($hb, 0, $hb.Length)
    if ($method -ne 'HEAD') { $stream.Write($bytes, 0, $bytes.Length) }
    $stream.Flush()
  } catch {
    # A client that walked away mid-response is not worth crashing over.
  } finally {
    try { $client.Close() } catch { }
  }
  Write-Output "$status $target"
}
