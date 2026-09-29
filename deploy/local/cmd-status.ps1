# أمر الحالة - جدول موجز لكل مكوّن مع رمز خروج صريح: 0 سليم، 1 متدهور.

. (Join-Path $PSScriptRoot "lib-common.ps1")

$config = Get-LocalConfig
$apiPort = [int]$config["AB_API_PORT"]; $dashPort = [int]$config["AB_DASH_PORT"]
$healthy = $true

function Format-Flag([bool]$Ok) { if ($Ok) { return "OK" } return "DOWN" }

Write-Host "== AgentBridge Local - الحالة =="
$dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
if ($null -eq $dockerCmd) {
  Write-Host "docker   : غير مثبت"; $healthy = $false
} else {
  $null = & docker info --format "{{.ServerVersion}}" 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "docker   : الخدمة متوقفة (افتح Docker Desktop)"; $healthy = $false
  } else {
    foreach ($c in @($script:PgContainer, $script:RedisContainer)) {
      $st = & docker inspect --format "{{.State.Health.Status}}" $c 2>$null
      if ($st -eq "healthy") { Write-Host "$c : OK" } else { Write-Host "$c : $st"; if ($st -ne "exiting") { $healthy = $false } }
    }
  }
}

$apiOk = Wait-HttpOk -Url "http://127.0.0.1:$apiPort/health" -TimeoutSec 3
Write-Host "api      : $(Format-Flag $apiOk)  (http://127.0.0.1:$apiPort/health)"
if (-not $apiOk) { $healthy = $false }
$dashOk = Wait-HttpOk -Url "http://127.0.0.1:$dashPort/" -TimeoutSec 3
Write-Host "dashboard: $(Format-Flag $dashOk)  (http://127.0.0.1:$dashPort/app)"
if (-not $dashOk) { $healthy = $false }

if ($healthy) {
  Write-Host ""
  Write-Host "الخلاصة: سليم - اللوحة على http://127.0.0.1:$dashPort/app"
  exit 0
} else {
  Write-Host ""
  Write-Host "الخلاصة: متدهور - شغّل: agentbridge start"
  exit 1
}
