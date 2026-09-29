# أمر التشغيل - قابل لإعادة التنفيذ بلا نسخ ثانية ولا فقد بيانات:
# بنية تحتية (compose up) ثم API ثم اللوحة، مع تخطي كل جزء يعمل أصلًا
# وفشل مبكر برسالة عربية عند غياب المتطلبات أو انشغال المنافذ.

. (Join-Path $PSScriptRoot "lib-common.ps1")

Set-Location $script:Root
Assert-Installed
Assert-DockerAvailable
$config = Get-LocalConfig
$apiPort = [int]$config["AB_API_PORT"]; $dashPort = [int]$config["AB_DASH_PORT"]
$pgPort = [int]$config["AB_PG_PORT"]; $redisPort = [int]$config["AB_REDIS_PORT"]
# الخدمات العاملة أصلًا تستثنى من فحص المنافذ كي يبقى التشغيل قابلًا للتكرار
$apiAlreadyUp = Wait-HttpOk -Url "http://127.0.0.1:$apiPort/health" -TimeoutSec 1
$dashAlreadyUp = Wait-HttpOk -Url "http://127.0.0.1:$dashPort/" -TimeoutSec 1
$portsToCheck = @($pgPort, $redisPort)
if (-not $apiAlreadyUp) { $portsToCheck += $apiPort }
if (-not $dashAlreadyUp) { $portsToCheck += $dashPort }
Assert-PortsFree -Ports $portsToCheck -Allow (Get-OwnContainerPorts)

Write-Step "تشغيل البنية التحتية (PostgreSQL وRedis - بياناتك في runtime\data لا تُمس)"
& docker compose --env-file (Join-Path $script:Secrets "compose.env") -f $script:ComposePath up -d
if ($LASTEXITCODE -ne 0) { Write-Host "خطأ: فشل تشغيل الحاويات - راجع رسالة docker أعلاه."; exit 1 }
foreach ($c in @($script:PgContainer, $script:RedisContainer)) {
  if (-not (Wait-ContainerHealthy -Name $c -TimeoutSec 90)) {
    Write-Host "خطأ: الحاوية $c لم تصبح جاهزة خلال المهلة - راجع: docker logs $c"
    exit 1
  }
  Write-Host "$c : جاهزة"
}

$apiPidFile = Join-Path $script:Pids "api.pid"
$dashPidFile = Join-Path $script:Pids "dashboard.pid"

$apiUp = $apiAlreadyUp
if (-not $apiUp) {
  Write-Step "تشغيل خدمة API على 127.0.0.1:$apiPort"
  $proc = Start-Process -FilePath "powershell" -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "run-api.ps1")) `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $script:Logs "api.log") `
    -RedirectStandardError (Join-Path $script:Logs "api.err.log")
  Set-Content -Path $apiPidFile -Value $proc.Id -Encoding ASCII
} else {
  Write-Host "API يعمل أصلًا - تخطّي التشغيل المزدوج."
}
if (-not (Wait-HttpOk -Url "http://127.0.0.1:$apiPort/health" -TimeoutSec 90)) {
  Write-Host "خطأ: خدمة API لم تصبح جاهزة خلال المهلة - آخر السجلات:"
  Get-Content (Join-Path $script:Logs "api.err.log") -Tail 25 -ErrorAction SilentlyContinue
  Get-Content (Join-Path $script:Logs "api.log") -Tail 25 -ErrorAction SilentlyContinue
  exit 1
}
Write-Host "API : جاهزة على http://127.0.0.1:$apiPort/health"

$dashUp = $dashAlreadyUp
if (-not $dashUp) {
  Write-Step "تشغيل لوحة التحكم على 127.0.0.1:$dashPort"
  $proc = Start-Process -FilePath "powershell" -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "run-dashboard.ps1")) `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $script:Logs "dashboard.log") `
    -RedirectStandardError (Join-Path $script:Logs "dashboard.err.log")
  Set-Content -Path $dashPidFile -Value $proc.Id -Encoding ASCII
} else {
  Write-Host "لوحة التحكم تعمل أصلًا - تخطّي التشغيل المزدوج."
}
if (-not (Wait-HttpOk -Url "http://127.0.0.1:$dashPort/" -TimeoutSec 90)) {
  Write-Host "خطأ: لوحة التحكم لم تصبح جاهزة خلال المهلة - آخر السجلات:"
  Get-Content (Join-Path $script:Logs "dashboard.err.log") -Tail 25 -ErrorAction SilentlyContinue
  Get-Content (Join-Path $script:Logs "dashboard.log") -Tail 25 -ErrorAction SilentlyContinue
  exit 1
}

Write-Host ""
Write-Host "كل الخدمات عاملة."
Write-Host "لوحة التحكم:  http://127.0.0.1:$dashPort/app"
Write-Host "الحالة:  agentbridge status   |   الإيقاف:  agentbridge stop"
