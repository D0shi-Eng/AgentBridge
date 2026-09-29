# مكتبة الدوال المشتركة لحزمة التشغيل المحلية - تُستدعى من أوامر agentbridge.ps1
# تمنع التكرار: مسارات، تحليل env، فحص المنافذ، انتظار الخدمة، فحص Docker.

$ErrorActionPreference = "Stop"

# جذر المستودع = أب deployment من مجلد deploy الذي يحوي هذا الملف
$script:Root = (Get-Item (Join-Path $PSScriptRoot "..\..")).FullName
$script:Runtime = Join-Path $script:Root "runtime"
$script:Secrets = Join-Path $script:Runtime "secrets"
$script:Logs = Join-Path $script:Runtime "logs"
$script:Pids = Join-Path $script:Runtime "pids"
$script:Backups = Join-Path $script:Runtime "backups"
$script:DataDir = Join-Path $script:Runtime "data"
$script:LocalEnvPath = Join-Path $script:Runtime "local.env"
$script:ComposePath = Join-Path $script:Runtime "docker-compose.local.yaml"

# القيم الافتراضية لإعداد الجهاز - تُكتب مرة واحدة في runtime\local.env ولا تُعاد كتابتها
$script:LocalEnvDefaults = [ordered]@{
  AB_API_PORT = "3410"
  AB_DASH_PORT = "3411"
  AB_PG_PORT = "3412"
  AB_REDIS_PORT = "3413"
  AB_TENANT_ID = "owner-local"
  AB_TENANT_NAME = "Owner Local Workspace"
  AB_CREDENTIAL_DAYS = "365"
  # أسماء حاويات Docker واسم مشروع compose - قابلة للضبط كي يتسع أكثر من
  # تثبيت على الجهاز الواحد بلا تصادم أسماء؛ الافتراضي يُبقي التثبيتات القائمة كما هي
  AB_COMPOSE_PROJECT = "agentbridge-local"
  AB_PG_CONTAINER = "agentbridge-local-postgres"
  AB_REDIS_CONTAINER = "agentbridge-local-redis"
}

function Read-EnvFile {
  param([string]$Path)
  $map = @{}
  if (-not (Test-Path $Path)) { return $map }
  foreach ($line in Get-Content -Path $Path -Encoding UTF8) {
    $t = $line.Trim()
    if ($t.Length -eq 0 -or $t.StartsWith("#")) { continue }
    $i = $t.IndexOf("=")
    if ($i -lt 1) { continue }
    $map[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim()
  }
  return $map
}

# أسماء الحاويات الفعالة = local.env فوق الافتراضيات - تُحل عند التحميل لأن
# كل الأوامر (backup/restore/status/start/stop) تستخدمها قبل أي قراءة أخرى
$bootEnv = Read-EnvFile -Path $script:LocalEnvPath
$script:PgContainer = if ($bootEnv.ContainsKey("AB_PG_CONTAINER")) { $bootEnv["AB_PG_CONTAINER"] } else { $script:LocalEnvDefaults["AB_PG_CONTAINER"] }
$script:RedisContainer = if ($bootEnv.ContainsKey("AB_REDIS_CONTAINER")) { $bootEnv["AB_REDIS_CONTAINER"] } else { $script:LocalEnvDefaults["AB_REDIS_CONTAINER"] }
$script:ComposeProject = if ($bootEnv.ContainsKey("AB_COMPOSE_PROJECT")) { $bootEnv["AB_COMPOSE_PROJECT"] } else { $script:LocalEnvDefaults["AB_COMPOSE_PROJECT"] }

# الإعدادات الفعالة = local.env فوق الافتراضيات - بلا كلمات سر هنا حصراً
function Get-LocalConfig {
  $map = Read-EnvFile -Path $script:LocalEnvPath
  foreach ($k in $script:LocalEnvDefaults.Keys) {
    if (-not $map.ContainsKey($k)) { $map[$k] = $script:LocalEnvDefaults[$k] }
  }
  return $map
}

# يفشل برسالة عربية واضحة إن غاب أي ملف من ملفات الإعداد المطلوبة
function Assert-Installed {
  $missing = @()
  foreach ($p in @($script:LocalEnvPath, (Join-Path $script:Secrets "api.env"), (Join-Path $script:Secrets "compose.env"))) {
    if (-not (Test-Path $p)) { $missing += (Split-Path -Leaf $p) }
  }
  if ($missing.Count -gt 0) {
    Write-Host "التثبيت غير مكتمل - الملفات الغائبة: $($missing -join ', ')"
    Write-Host "شغّل الإعداد أولًا:  agentbridge setup"
    exit 1
  }
}

function Assert-DockerAvailable {
  $cmd = Get-Command docker -ErrorAction SilentlyContinue
  if ($null -eq $cmd) {
    Write-Host "خطأ: Docker غير مثبت على هذا الجهاز - ثبّت Docker Desktop ثم أعد المحاولة."
    exit 1
  }
  $null = & docker info --format "{{.ServerVersion}}" 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "خطأ: Docker مثبت لكن الخدمة لا تعمل (الخادم لا يستجيب)."
    Write-Host "افتح Docker Desktop يدويًا ثم أعد المحاولة - لن نشغّل أو نوقف Docker نيابة عنك."
    exit 1
  }
}

# يعيد كائن (OwnerPid, Name) إن كان المنفذ مشغولًا أو $null إن كان شاغرًا
function Get-PortListener {
  param([int]$Port)
  $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($null -eq $conns -or @($conns).Count -eq 0) { return $null }
  $ownerPid = @($conns)[0].OwningProcess
  $name = "?"
  try { $name = (Get-Process -Id $ownerPid -ErrorAction Stop).ProcessName } catch { }
  return [pscustomobject]@{ OwnerPid = $ownerPid; Name = $name }
}

# منافذ منشورة لحاويات هذا التثبيت حصرًا - تُستثنى من فحص الانشغال لأنها ملكنا
function Get-OwnContainerPorts {
  $ports = @()
  foreach ($c in @($script:PgContainer, $script:RedisContainer)) {
    $out = & docker ps --filter "name=$c" --format "{{.Ports}}" 2>$null
    foreach ($line in $out) {
      foreach ($m in [regex]::Matches($line, "127\.0\.0\.1:(\d+)->")) { $ports += [int]$m.Groups[1].Value }
    }
  }
  return $ports
}

# يوقف التنفيذ برسالة مفهومة إن كان أي منفذ مطلوب مشغولًا بغير حاوياتنا
function Assert-PortsFree {
  param([int[]]$Ports, [int[]]$Allow = @())
  foreach ($port in $Ports) {
    if ($Allow -contains $port) { continue }
    $listener = Get-PortListener -Port $port
    if ($null -ne $listener) {
      Write-Host "خطأ: المنفذ $port مشغول حاليًا بعملية '$($listener.Name)' (PID $($listener.OwnerPid))."
      Write-Host "حرّر المنفذ أو عدّل المنافذ في runtime\local.env ثم أعد المحاولة."
      exit 1
    }
  }
}

# انتظار استجابة HTTP من خدمة محلية حتى مهلة قصوى - $true عند النجاح
function Wait-HttpOk {
  param([string]$Url, [int]$TimeoutSec)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) { return $true }
    } catch { }
    Start-Sleep -Milliseconds 800
  }
  return $false
}

# انتظار وصول حاوية إلى حالة healthy - مع كشف الموت المبكر برسالة أوضح
function Wait-ContainerHealthy {
  param([string]$Name, [int]$TimeoutSec)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $st = & docker inspect --format "{{.State.Health.Status}}" $Name 2>$null
    if ($st -eq "healthy") { return $true }
    $running = & docker inspect --format "{{.State.Running}}" $Name 2>$null
    if ($running -eq "false") { return $false }
    Start-Sleep -Seconds 2
  }
  return $false
}

# هل العملية في ملف pid حية فعلًا؟ يعيد $true فقط لعروية قائمة
function Test-PidAlive {
  param([string]$PidFile)
  if (-not (Test-Path $PidFile)) { return $false }
  $raw = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  $procId = 0
  if (-not [int]::TryParse("$raw", [ref]$procId)) { return $false }
  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  return ($null -ne $proc)
}

# إنهاء شجرة عملية كاملة (pnpm → node) بمُعرّفها - أقوى من إيقاف الوالد وحده
function Stop-ProcessTree {
  param([int]$ProcId)
  & taskkill /PID $ProcId /T /F 2>$null | Out-Null
  return ($LASTEXITCODE -eq 0)
}

# توليد سر عشوائي آمن بالتمرير الصحي - hex أو base64
function New-RandomSecret {
  param([int]$Bytes, [switch]$Base64)
  $buf = New-Object byte[] $Bytes
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($buf) } finally { $rng.Dispose() }
  if ($Base64) { return [Convert]::ToBase64String($buf) }
  return (($buf | ForEach-Object { $_.ToString("x2") }) -join "")
}

# حماية ملف/مجلد أسرار بصلاحيات Windows: المستخدم الحالي وSYSTEM فقط
function Protect-SecretPath {
  param([string]$Path, [switch]$Directory)
  $identity = "$env:USERDOMAIN\$env:USERNAME"
  if ($Directory) {
    & icacls $Path /inheritance:r /grant:r "${identity}:(OI)(CI)F" /grant:r "SYSTEM:(OI)(CI)F" | Out-Null
  } else {
    & icacls $Path /inheritance:r /grant:r "${identity}:F" /grant:r "SYSTEM:F" | Out-Null
  }
  if ($LASTEXITCODE -ne 0) { throw "فشل ضبط صلاحيات Windows على: $Path" }
}

# يكتب ملف أسرار جديد فقط إن غاب - لا استبدال أبدًا (idempotent وآمن)
function Write-SecretFileIfMissing {
  param([string]$Path, [string[]]$Lines)
  if (Test-Path $Path) { return $false }
  $dir = Split-Path -Parent $Path
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $Lines | Set-Content -Path $Path -Encoding ASCII
  Protect-SecretPath -Path $Path
  return $true
}

# تشغيل أمر بإعدادات من ملف env دون طباعة القيم - يضبط $env: داخل الجلسة الحالية
function Import-EnvIntoSession {
  param([hashtable]$Map)
  foreach ($k in $Map.Keys) { Set-Item -Path "env:$k" -Value $Map[$k] }
}

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message"
}

# يضمن وجود أسطر env في ملف أسرار قائم - يضيف الغائب فقط ولا يعدل الموجود،
# ويعيد ضبط الصلاحيات بعد الكتابة. يعيد عدد الأسطر المضافة.
function Ensure-EnvLines {
  param([string]$Path, [string[]]$Lines)
  $existing = Read-EnvFile -Path $Path
  $toAdd = @()
  foreach ($line in $Lines) {
    $eq = $line.IndexOf("=")
    if ($eq -lt 1) { continue }
    $key = $line.Substring(0, $eq)
    if (-not $existing.ContainsKey($key)) { $toAdd += $line }
  }
  if ($toAdd.Count -gt 0) {
    $toAdd | Add-Content -Path $Path -Encoding ASCII
    Protect-SecretPath -Path $Path
  }
  return $toAdd.Count
}

# يحذف أسطر env بمفاتيح محددة من ملف أسرار - ترحيل الإعدادات المهجورة
# بعد تحديث المصدر. يعيد عدد الأسطر المحذوفة.
function Remove-EnvKeys {
  param([string]$Path, [string[]]$Keys)
  if (-not (Test-Path $Path)) { return 0 }
  $drop = @{}
  foreach ($k in $Keys) { $drop[$k] = $true }
  $all = Get-Content -Path $Path -Encoding UTF8
  $kept = @()
  foreach ($line in $all) {
    $t = $line.Trim()
    $i = $t.IndexOf("=")
    if ($i -ge 1 -and $drop.ContainsKey($t.Substring(0, $i).Trim())) { continue }
    $kept += $line
  }
  Set-Content -Path $Path -Value $kept -Encoding ASCII
  Protect-SecretPath -Path $Path
  return $all.Count - $kept.Count
}
