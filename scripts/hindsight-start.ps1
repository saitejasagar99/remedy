<#
.SYNOPSIS
  Boots the local Hindsight memory server for REMEDY.

.DESCRIPTION
  Runs the bare-metal `hindsight-api` server against an embedded database, with
  Ollama serving as the LLM for fact extraction, consolidation and reflection.

  No API keys and no Docker are required.

.NOTES
  Idempotent: if a healthy server is already listening, this exits immediately.
  ASCII-only on purpose: Windows PowerShell reads .ps1 as ANSI unless a BOM is
  present, so non-ASCII characters here can break parsing.
#>
$ErrorActionPreference = 'Stop'

$Venv = Join-Path $env:USERPROFILE '.remedy\hindsight-venv'
$HindsightExe = Join-Path $Venv 'Scripts\hindsight-api.exe'
$BaseUrl = if ($env:HINDSIGHT_URL) { $env:HINDSIGHT_URL } else { 'http://localhost:8888' }
$OllamaUrl = if ($env:LLM_BASE_URL) { $env:LLM_BASE_URL } else { 'http://localhost:11434/v1' }
$Model = if ($env:LLM_MODEL) { $env:LLM_MODEL } else { 'gemma3:4b' }

function Test-Server {
    try {
        $r = Invoke-WebRequest -Uri "$BaseUrl/version" -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
        return ($r.StatusCode -eq 200)
    } catch { return $false }
}

if (Test-Server) {
    Write-Host "Hindsight already running at $BaseUrl"
    exit 0
}

if (-not (Test-Path $HindsightExe)) {
    Write-Error "hindsight-api not found at $HindsightExe. Create the venv and run: pip install hindsight-api"
    exit 1
}

# Verify the LLM backend is up before starting, so failures are legible.
try {
    $probe = Invoke-WebRequest -Uri "$OllamaUrl/models" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
    if (-not ("$($probe.StatusCode)".StartsWith('2'))) { throw 'bad status' }
    Write-Host "LLM backend OK: $OllamaUrl (model: $Model)"
} catch {
    Write-Warning "LLM backend not reachable at $OllamaUrl - Hindsight will start but retain will fail. Is Ollama running?"
}

# Hindsight prints a banner containing box-drawing characters. Windows consoles
# default to cp1252, which cannot encode them, so the server dies at startup
# with UnicodeEncodeError. Force UTF-8 for the child process.
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUTF8 = '1'

# Hindsight LLM configuration.
$env:HINDSIGHT_API_LLM_PROVIDER = 'ollama'
$env:HINDSIGHT_API_LLM_BASE_URL = $OllamaUrl
$env:HINDSIGHT_API_LLM_MODEL = $Model
# Local small models cannot reach the 64k default output budget. The only hard
# requirement is that this exceeds HINDSIGHT_API_RETAIN_CHUNK_SIZE (default 3000).
# Keep this as low as the constraint allows: on a CPU-only box (~12 tok/s) the
# model will otherwise run all the way to the cap, turning a 300 character
# retain into a 20+ minute call that blows every client timeout.
if (-not $env:HINDSIGHT_API_RETAIN_MAX_COMPLETION_TOKENS) {
    $env:HINDSIGHT_API_RETAIN_MAX_COMPLETION_TOKENS = '4000'
}
if (-not $env:HINDSIGHT_API_LLM_TIMEOUT) {
    $env:HINDSIGHT_API_LLM_TIMEOUT = '300'
}

# Auto-consolidation fires after every retain and runs its own LLM passes in a
# background worker. On one CPU-bound Ollama instance that worker and fact
# extraction take turns, so each retain waits behind consolidation retries.
# REMEDY's recall works off the retained facts directly, so consolidation is
# not needed; disabling it keeps retain latency predictable.
if (-not $env:HINDSIGHT_API_ENABLE_AUTO_CONSOLIDATION) {
    $env:HINDSIGHT_API_ENABLE_AUTO_CONSOLIDATION = 'false'
}

Write-Host "Starting Hindsight at $BaseUrl (LLM: ollama/$Model)..."
Write-Host "Data directory: $env:USERPROFILE\.pg0"
& $HindsightExe
