# أمر التحديث - سحب المصدر (fast-forward فقط) ثم تبعيات وبناء وهجرات وصورة
# العزل، وإعادة تشغيل الخدمات إن كانت عاملة. لا يمس runtime\data إطلاقًا.

. (Join-Path $PSScriptRoot "lib-common.ps1")

Set-Location $script:Root
Assert-Installed
Assert-DockerAvailable

Write-Step "سحب أحدث المصدر (fast-forward فقط - لا فرض تاريخ)"
& git pull --ff-only
if ($LASTEXITCODE -ne 0) {
  Write-Host "خطأ: تعذر السحب السريع (تغيرات محلية أو تباعد عن البعيد)."
  Write-Host "راجع: git status - ثم حل الاختلاف يدويًا قبل إعادة المحاولة."
  exit 1
}

# ترحيل جلسة الوضع المحلي: مفتاح ملف بصمة الرمز المهجور يُحذف من api.env
# وملفا الرمز/البصمة القديمان يُحذفان - الجلسة الآن تلقائية بلا رمز إطلاقاً
$apiEnvPath = Join-Path $script:Secrets "api.env"
$null = Remove-EnvKeys -Path $apiEnvPath -Keys @("LOCAL_BOOTSTRAP_HASH_FILE")
foreach ($stale in @("local-bootstrap.code", "local-bootstrap.hash")) {
  $stalePath = Join-Path $script:Secrets $stale
  if (Test-Path $stalePath) { Remove-Item $stalePath -Force }
}

# على Windows تُقفل عملية API ملف محرك Prisma وprocess اللوحة ملفات .next -
# لذلك نوقف الخدمات قبل أي تثبيت/بناء ونعيدها في النهاية إن كانت عاملة.
$config = Get-LocalConfig
$dashPort = [int]$config["AB_DASH_PORT"]
$apiPort = [int]$config["AB_API_PORT"]
$wasRunning = (Wait-HttpOk -Url "http://127.0.0.1:$apiPort/health" -TimeoutSec 1) -or (Wait-HttpOk -Url "http://127.0.0.1:$dashPort/" -TimeoutSec 1)
if ($wasRunning) {
  Write-Step "إيقاف الخدمات مؤقتًا (ملفات البناء مقفولة على Windows أثناء التشغيل)"
  & (Join-Path $PSScriptRoot "cmd-stop.ps1")
}

Write-Step "تثبيت التبعيات وبناء الحزم واللوحة"
& pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { Write-Host "خطأ: فشل تثبيت التبعيات."; exit 1 }
& pnpm --filter @agentbridge/infra exec prisma generate
if ($LASTEXITCODE -ne 0) { Write-Host "خطأ: فشل توليد عميل Prisma."; exit 1 }
& pnpm --filter @agentbridge/shared build
if ($LASTEXITCODE -ne 0) { Write-Host "خطأ: فشل بناء shared."; exit 1 }
& pnpm --filter @agentbridge/hardening build
if ($LASTEXITCODE -ne 0) { Write-Host "خطأ: فشل بناء hardening."; exit 1 }

Write-Step "إعادة بناء صورة العزل من المصدر الجديد"
$sandboxCtx = Join-Path $script:Root "docker\sandbox-runner"
foreach ($d in @("shared-dist", "hardening-dist")) {
  $dest = Join-Path $sandboxCtx $d
  if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
}
Copy-Item -Recurse -Force (Join-Path $script:Root "packages\shared\dist") (Join-Path $sandboxCtx "shared-dist")
Copy-Item -Recurse -Force (Join-Path $script:Root "packages\hardening\dist") (Join-Path $sandboxCtx "hardening-dist")
Copy-Item -Force (Join-Path $script:Root "packages\shared\package.json") (Join-Path $sandboxCtx "shared-package.json")
Copy-Item -Force (Join-Path $script:Root "packages\hardening\package.json") (Join-Path $sandboxCtx "hardening-package.json")
& docker build -t agentbridge/sandbox-runner:isolated $sandboxCtx
if ($LASTEXITCODE -ne 0) { Write-Host "خطأ: فشل بناء صورة العزل."; exit 1 }

Write-Step "بناء اللوحة وربط وكيل API بمنفذ التشغيل"
$config = Get-LocalConfig
$env:AGENTBRIDGE_API_ORIGIN = "http://127.0.0.1:$([int]$config['AB_API_PORT'])"
try {
  & pnpm --filter @agentbridge/dashboard build
  if ($LASTEXITCODE -ne 0) { Write-Host "خطأ: فشل بناء اللوحة."; exit 1 }
} finally {
  Remove-Item "env:AGENTBRIDGE_API_ORIGIN" -ErrorAction SilentlyContinue
}

Write-Step "تجهيز البنية التحتية للهجرات (PostgreSQL وRedis)"
& docker compose --env-file (Join-Path $script:Secrets "compose.env") -f $script:ComposePath up -d
if ($LASTEXITCODE -ne 0) { Write-Host "خطأ: فشل تشغيل الحاويات."; exit 1 }
foreach ($c in @($script:PgContainer, $script:RedisContainer)) {
  if (-not (Wait-ContainerHealthy -Name $c -TimeoutSec 120)) {
    Write-Host "خطأ: الحاوية $c لم تصبح جاهزة - راجع: docker logs $c"
    exit 1
  }
}

Write-Step "تطبيق هجرات قاعدة البيانات الجديدة (idempotent - لا يمس البيانات القائمة)"
# الهجرات تُنفذ بعنوان الإدارة (مالك الكائنات) لا بحساب التشغيل المقيد ab_app
$opsEnv = Read-EnvFile -Path (Join-Path $script:Secrets "ops.env")
Import-EnvIntoSession ([hashtable]@{ DATABASE_URL = $opsEnv["ADMIN_DATABASE_URL"] })
try {
  & pnpm --filter @agentbridge/infra exec prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { Write-Host "خطأ: فشل تطبيق الهجرات."; exit 1 }
} finally {
  Remove-Item "env:DATABASE_URL" -ErrorAction SilentlyContinue
}

# الهجرات الجديدة تنشئ كائنات باسم المدير - إعادة الإسناد لشرط فحص المالك
$env:AB_PG_CONTAINER = $script:PgContainer
$env:AB_ADMIN_ROLE = "agentbridge"
try {
  & node (Join-Path $script:Root "scripts\assign-database-owner.mjs")
  if ($LASTEXITCODE -ne 0) { Write-Host "خطأ: فشل إسناد ملكية كائنات القاعدة."; exit 1 }
} finally {
  Remove-Item "env:AB_PG_CONTAINER", "env:AB_ADMIN_ROLE" -ErrorAction SilentlyContinue
}

# إعادة التشغيل فقط إن كانت الخدمات عاملة قبل التحديث
if ($wasRunning) {
  Write-Step "إعادة تشغيل الخدمات"
  & (Join-Path $PSScriptRoot "cmd-start.ps1")
} else {
  Write-Host "الخدمات كانت متوقفة - اكتمل التحديث. للتشغيل: agentbridge start"
}
