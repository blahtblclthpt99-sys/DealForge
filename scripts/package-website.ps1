$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "Building DealForge for website upload (standalone Node server)..."
$env:NODE_OPTIONS = "--use-system-ca"
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$standaloneSrc = Join-Path $Root ".next\standalone"
if (-not (Test-Path $standaloneSrc)) {
  Write-Error "Missing .next/standalone - ensure next.config.ts has output standalone"
}

$releaseDir = Join-Path $Root "release"
$staging = Join-Path $releaseDir "dealforge-web"
$zipPath = Join-Path $releaseDir "DealForge-Web.zip"

if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Force -Path $staging | Out-Null

Write-Host "Staging standalone server..."
Copy-Item -Path (Join-Path $standaloneSrc "*") -Destination $staging -Recurse -Force

$staticSrc = Join-Path $Root ".next\static"
$staticDest = Join-Path $staging ".next\static"
New-Item -ItemType Directory -Force -Path (Split-Path $staticDest) | Out-Null
Copy-Item -Path $staticSrc -Destination $staticDest -Recurse -Force

$publicSrc = Join-Path $Root "public"
if (Test-Path $publicSrc) {
  Copy-Item -Path $publicSrc -Destination (Join-Path $staging "public") -Recurse -Force
}

$prismaDest = Join-Path $staging "prisma"
New-Item -ItemType Directory -Force -Path $prismaDest | Out-Null
Copy-Item (Join-Path $Root "prisma\schema.prisma") $prismaDest -Force
$db = Join-Path $Root "prisma\dev.db"
if (Test-Path $db) {
  Copy-Item $db $prismaDest -Force
  $dbMb = [math]::Round((Get-Item $db).Length / 1MB, 1)
  Write-Host "Packed prisma/dev.db - $dbMb megabytes"
} else {
  Write-Warning "prisma/dev.db not found - run npm run db:setup before packaging."
}

$envLines = @(
  'DATABASE_URL="file:./prisma/dev.db"'
  'AUTH_SECRET="CHANGE-ME-generate-a-long-random-string"'
  'ADMIN_EMAIL="admin@dealforge.com"'
  'ADMIN_PASSWORD="ChangeMeAdmin123!"'
  'AMAZON_ASSOCIATE_TAG="titanfieldos-20"'
  'AMAZON_PARTNER_TAG="titanfieldos-20"'
  'NEXT_PUBLIC_APP_URL="https://YOUR-DOMAIN.com"'
  'NEXT_PUBLIC_APP_NAME="DealForge"'
  'PORT=3000'
)
$envLines | Set-Content (Join-Path $staging ".env") -Encoding UTF8

$batLines = @(
  '@echo off'
  'cd /d "%~dp0"'
  'echo Starting DealForge on http://localhost:3000'
  'set PORT=3000'
  'node server.js'
)
$batLines | Set-Content (Join-Path $staging "START.bat") -Encoding ASCII

$psLines = @(
  '$ErrorActionPreference = "Stop"'
  'Set-Location $PSScriptRoot'
  'if (-not $env:PORT) { $env:PORT = "3000" }'
  'Write-Host "DealForge -> http://localhost:$env:PORT"'
  'node server.js'
)
$psLines | Set-Content (Join-Path $staging "START.ps1") -Encoding UTF8

$readme = @(
  'DealForge - Website upload package'
  '================================='
  ''
  'OPTION A - Vercel (recommended)'
  '-------------------------------'
  '1. Import at https://vercel.com/new (root directory: .)'
  '2. Add env vars from .env.production.example (PostgreSQL for DATABASE_URL)'
  '3. Deploy'
  '4. Point IONOS domain CNAME to Vercel (see Vercel dashboard)'
  ''
  'OPTION B - Self-hosted Node (VPS / Node hosting)'
  '------------------------------------------------'
  '1. Unzip DealForge-Web.zip on the server'
  '2. Edit .env - set AUTH_SECRET and NEXT_PUBLIC_APP_URL'
  '3. Install Node.js 20+'
  '4. Run START.bat or: node server.js'
  '5. Reverse-proxy port 3000 with Nginx/Apache if needed'
  ''
  'OPTION C - IONOS static-only hosting (NOT supported)'
  '----------------------------------------------------'
  'DealForge needs Node.js (API routes + database). Use Option A or B.'
  ''
  'After deploy: visit / and /categories/electronics'
  'Admin: admin@dealforge.com (change password in .env first)'
  'Amazon tag: titanfieldos-20'
)
$readme | Set-Content (Join-Path $staging "UPLOAD-INSTRUCTIONS.txt") -Encoding UTF8

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zipPath -Force

Write-Host ""
Write-Host "Website package ready:"
Write-Host "  $zipPath"
Write-Host "See UPLOAD-INSTRUCTIONS.txt inside the zip."
