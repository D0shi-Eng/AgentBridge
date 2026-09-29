# أمر الإعداد - يُنفَّذ مرة واحدة (وآمن لإعادة التشغيل): مجلدات، أسرار مولدة
# محليًا، ملف compose، قاعدة البيانات والهجرات، الدور المقيد، بناء الصور،
# ثم حساب الإدارة ومساحة العمل. لا يكتب أي سر في المستودع أو السجلات.

. (Join-Path $PSScriptRoot "lib-common.ps1")

Set-Location $script:Root

Write-Step "فحص المتطلبات (Node وpnpm وDocker والمساحة والمنافذ)"
foreach ($tool in @("node", "pnpm", "git")) {
  if ($null -eq (Get-Command $tool -ErrorAction SilentlyContinue)) {
    Write-Host "خطأ: الأداة '$tool' غير مثبتة - ثبّتها أولًا (متطلبات: Node ≥ 20 وpnpm وgit)."; exit 1
  }
}
Assert-DockerAvailable
$drive = Get-PSDrive -Name ((Split-Path -Qualifier $script:Root).TrimEnd(":"))
if ($drive.Free -lt 5GB) { Write-Host "خطأ: مساحة القرص أقل من 5GB - حرّر مساحة ثم أعد المحاولة."; exit 1 }
$config = Get-LocalConfig
$apiPort = [int]$config["AB_API_PORT"]; $dashPort = [int]$config["AB_DASH_PORT"]
$pgPort = [int]$config["AB_PG_PORT"]; $redisPort = [int]$config["AB_REDIS_PORT"]
# الخدمات العاملة أصلًا لا تحسب انشغال منافذها - الاعداد قابل للتكرار
$portsToCheck = @($pgPort, $redisPort)
if (-not (Wait-HttpOk -Url "http://127.0.0.1:$apiPort/health" -TimeoutSec 1)) { $portsToCheck += $apiPort }
if (-not (Wait-HttpOk -Url "http://127.0.0.1:$dashPort/" -TimeoutSec 1)) { $portsToCheck += $dashPort }
Assert-PortsFree -Ports $portsToCheck -Allow (Get-OwnContainerPorts)

# على ويندوز تُقفل عملية API محرك Prisma وعملية اللوحة ملفات .next - نوقف
# الخدمات قبل خطوات البناء ونعيدها في النهاية إن كانت عاملة
$script:servicesWereRunning = (Wait-HttpOk -Url "http://127.0.0.1:$apiPort/health" -TimeoutSec 1) -or (Wait-HttpOk -Url "http://127.0.0.1:$dashPort/" -TimeoutSec 1)
if ($script:servicesWereRunning) {
  Write-Step "إيقاف الخدمات مؤقتًا (ملفات البناء مقفولة على ويندوز أثناء التشغيل)"
  & (Join-Path $PSScriptRoot "cmd-stop.ps1")
}

Write-Step "إنشاء مجلدات التشغيل المنفصلة (بيانات/أسرار/سجلات/نسخ احتياطية)"
foreach ($d in @($script:Runtime, $script:Secrets, $script:Logs, $script:Pids, $script:Backups,
                 (Join-Path $script:DataDir "postgres"), (Join-Path $script:DataDir "redis"))) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}
Protect-SecretPath -Path $script:Secrets -Directory

Write-Step "كتابة إعدادات الجهاز runtime\local.env (المنافذ والمسارات - بلا أسرار)"
if (-not (Test-Path $script:LocalEnvPath)) {
  $lines = foreach ($k in $script:LocalEnvDefaults.Keys) { "$k=$($script:LocalEnvDefaults[$k])" }
  $lines | Set-Content -Path $script:LocalEnvPath -Encoding ASCII
  Write-Host "كُتب ملف local.env بالقيم الافتراضية."
} else {
  Write-Host "local.env موجود - لن يُعدل (المنافذ الحالية كما هي)."
}

Write-Step "توليد الأسرار محليًا (تُنشأ مرة واحدة فقط ولا تُعرض على الشاشة)"

# 1) كلمات مرور الحاويات - الملف الموجود يحسم ويبقى، والقراءة منه تمنع التضارب
$null = Write-SecretFileIfMissing -Path (Join-Path $script:Secrets "compose.env") -Lines @(
  "POSTGRES_PASSWORD=$(New-RandomSecret -Bytes 24)",
  "REDIS_PASSWORD=$(New-RandomSecret -Bytes 24)")
$composeSecrets = Read-EnvFile -Path (Join-Path $script:Secrets "compose.env")
$pgPassword = $composeSecrets["POSTGRES_PASSWORD"]
$redisPassword = $composeSecrets["REDIS_PASSWORD"]

# 2) مفاتيح التشفير والتوقيع - Ed25519 عبر ملف JS مؤقت لأن تمرير -e مباشرة
#    يُفقد الاقتباسات المزدوجة عند استدعاء node من PowerShell
$encryptionKey = New-RandomSecret -Bytes 32 -Base64
$metricsToken = New-RandomSecret -Bytes 24
$jsGen = Join-Path $env:TEMP "ab-gen-ed25519.js"
@'
const { generateKeyPairSync } = require("node:crypto");
const { privateKey } = generateKeyPairSync("ed25519");
process.stdout.write(privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"));
'@ | Set-Content -Path $jsGen -Encoding ASCII
$orchKey = (& node $jsGen).Trim()
$certKey = (& node $jsGen).Trim()
$hitlKey = (& node $jsGen).Trim()
Remove-Item $jsGen -Force -ErrorAction SilentlyContinue

# 3) كلمة مرور الدور المقيد وعناوين الاتصال - الملف الموجود يحسم
# DSNs تُركّب وقت التشغيل بالدمج من أسرار مولدة محلياً - لا DSN كامل حرفي في المصدر
$abAppPassword = New-RandomSecret -Bytes 24
$abAppDsn = "postgresql://ab_app:" + $abAppPassword + "@127.0.0.1:" + $pgPort + "/agentbridge?options=-c role=agentbridge_app"
$adminDsn = "postgresql://agentbridge:" + $pgPassword + "@127.0.0.1:" + $pgPort + "/agentbridge"
$null = Write-SecretFileIfMissing -Path (Join-Path $script:Secrets "ops.env") -Lines @(
  "DATABASE_URL=$abAppDsn", "ADMIN_DATABASE_URL=$adminDsn", "AB_APP_PASSWORD=$abAppPassword")
$opsEnv = Read-EnvFile -Path (Join-Path $script:Secrets "ops.env")
$abAppPassword = $opsEnv["AB_APP_PASSWORD"]
$adminDsn = $opsEnv["ADMIN_DATABASE_URL"]
$abAppDsn = $opsEnv["DATABASE_URL"]

# 4) ملف أسرار API - يُبنى من القيم المعتمدة أعلاه لا من قيم الذاكرة
$null = Write-SecretFileIfMissing -Path (Join-Path $script:Secrets "api.env") -Lines @(
  "NODE_ENV=development", "PORT=$apiPort", "LOG_LEVEL=info", "PERSISTENCE=live",
  "LLM_PROVIDER=mock", "LLM_MONTHLY_BUDGET_USD=50",
  "ENCRYPTION_KEY=$encryptionKey",
  "DATABASE_URL=$abAppDsn",
  "REDIS_URL=redis://:$redisPassword@127.0.0.1:$redisPort/0",
  "APP_ORIGIN=http://127.0.0.1:$dashPort",
  "OIDC_REDIRECT_URI=http://127.0.0.1:$apiPort/auth/oidc/callback",
  "STAGING_HTTPS=0",
  "AGENTBRIDGE_LIVE_PROBES=1", "AGENTBRIDGE_SANDBOX_PROBES=1",
  "METRICS_TOKEN=$metricsToken",
  "ORCH_SNAPSHOT_PRIVATE_KEY=$orchKey",
  "CERT_SIGNING_PRIVATE_KEY=$certKey",
  "HITL_SIGNING_PRIVATE_KEY=$hitlKey")

Write-Step "توليد ملف compose المحلي runtime\docker-compose.local.yaml (القيم السرية عبر env-file)"
$dataPath = ($script:DataDir -replace "\\", "/")
@"
name: $script:ComposeProject

services:
  postgres:
    image: pgvector/pgvector:pg17
    container_name: $script:PgContainer
    restart: "no"
    ports:
      - "127.0.0.1:$pgPort`:5432"
    environment:
      POSTGRES_USER: agentbridge
      POSTGRES_PASSWORD: `${POSTGRES_PASSWORD}
      POSTGRES_DB: agentbridge
    volumes:
      - "$dataPath/postgres:/var/lib/postgresql/data"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U agentbridge -d agentbridge"]
      interval: 5s
      timeout: 3s
      retries: 24
    mem_limit: 768m
    security_opt:
      - no-new-privileges

  redis:
    image: redis:7-alpine
    container_name: $script:RedisContainer
    restart: "no"
    ports:
      - "127.0.0.1:$redisPort`:6379"
    command: ["redis-server", "--requirepass", "`${REDIS_PASSWORD}", "--appendonly", "yes", "--maxmemory", "192mb", "--maxmemory-policy", "noeviction"]
    environment:
      REDIS_PASSWORD: `${REDIS_PASSWORD}
    volumes:
      - "$dataPath/redis:/data"
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a \"`$`$REDIS_PASSWORD\" --no-auth-warning ping | grep -q PONG"]
      interval: 5s
      timeout: 3s
      retries: 24
    mem_limit: 256m
    security_opt:
      - no-new-privileges
"@ | Set-Content -Path $script:ComposePath -Encoding ASCII

Write-Step "تشغيل البنية التحتية المحلية (PostgreSQL وRedis) وانتظار جهوزيتها"
& docker compose --env-file (Join-Path $script:Secrets "compose.env") -f $script:ComposePath up -d
if ($LASTEXITCODE -ne 0) { Write-Host "خطأ: فشل تشغيل حاويات البنية التحتية - راجع رسالة docker أعلاه."; exit 1 }
foreach ($c in @($script:PgContainer, $script:RedisContainer)) {
  if (-not (Wait-ContainerHealthy -Name $c -TimeoutSec 120)) {
    Write-Host "خطأ: الحاوية $c لم تصبح جاهزة - راجع السجل: docker logs $c"
    exit 1
  }
  Write-Host "$c : جاهزة"
}

if (-not (Test-Path (Join-Path $script:Root "node_modules"))) {
  Write-Step "تثبيت تبعيات المشروع (pnpm install - مرة أولى فقط)"
  & pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { Write-Host "خطأ: فشل تثبيت التبعيات - راجع الرسالة أعلاه."; exit 1 }
}

Write-Step "تجهيز قاعدة البيانات: توليد عميل Prisma ثم تطبيق الهجرات"
Import-EnvIntoSession ([hashtable]@{ DATABASE_URL = $adminDsn })
try {
  & pnpm --filter @agentbridge/infra exec prisma generate
  if ($LASTEXITCODE -ne 0) { Write-Host "خطأ: فشل توليد عميل Prisma."; exit 1 }
  & pnpm --filter @agentbridge/infra exec prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { Write-Host "خطأ: فشل تطبيق هجرات قاعدة البيانات - تأكد أن PostgreSQL حي ثم أعد الإعداد."; exit 1 }
} finally {
  Remove-Item "env:DATABASE_URL" -ErrorAction SilentlyContinue
}

Write-Step "إسناد ملكية كائنات القاعدة إلى دور مالك نظيف الصفات (شرط فحص RLS fail-closed)"
$env:AB_PG_CONTAINER = $script:PgContainer
$env:AB_ADMIN_ROLE = "agentbridge"
try {
  & node (Join-Path $script:Root "scripts\assign-database-owner.mjs")
  if ($LASTEXITCODE -ne 0) { Write-Host "خطأ: فشل إسناد ملكية كائنات القاعدة."; exit 1 }
} finally {
  Remove-Item "env:AB_PG_CONTAINER", "env:AB_ADMIN_ROLE" -ErrorAction SilentlyContinue
}

Write-Step "تجهيز الدور المقيد ab_app فوق RLS (كلمة المرور في بيئة العملية فقط)"
$env:AB_APP_PASSWORD = $abAppPassword
$env:AB_PG_CONTAINER = $script:PgContainer
$env:AB_LIVE_DATABASE_URL = $adminDsn
try {
  & node (Join-Path $script:Root "scripts\prepare-restricted-role.mjs")
  if ($LASTEXITCODE -ne 0) { Write-Host "خطأ: فشل تجهيز الدور المقيد ab_app."; exit 1 }
} finally {
  Remove-Item "env:AB_APP_PASSWORD", "env:AB_PG_CONTAINER", "env:AB_LIVE_DATABASE_URL" -ErrorAction SilentlyContinue
}

Write-Step "بناء الحزم المطلوبة وصورة العزل agentbridge/sandbox-runner:isolated"
& pnpm --filter @agentbridge/shared build
if ($LASTEXITCODE -ne 0) { Write-Host "خطأ: فشل بناء حزمة shared."; exit 1 }
& pnpm --filter @agentbridge/hardening build
if ($LASTEXITCODE -ne 0) { Write-Host "خطأ: فشل بناء حزمة hardening."; exit 1 }
$sandboxCtx = Join-Path $script:Root "docker\sandbox-runner"
foreach ($d in @("shared-dist", "hardening-dist")) {
  if (Test-Path (Join-Path $sandboxCtx $d)) { Remove-Item (Join-Path $sandboxCtx $d) -Recurse -Force }
}
Copy-Item -Recurse -Force (Join-Path $script:Root "packages\shared\dist") (Join-Path $sandboxCtx "shared-dist")
Copy-Item -Recurse -Force (Join-Path $script:Root "packages\hardening\dist") (Join-Path $sandboxCtx "hardening-dist")
Copy-Item -Force (Join-Path $script:Root "packages\shared\package.json") (Join-Path $sandboxCtx "shared-package.json")
Copy-Item -Force (Join-Path $script:Root "packages\hardening\package.json") (Join-Path $sandboxCtx "hardening-package.json")
& docker build -t agentbridge/sandbox-runner:isolated $sandboxCtx
if ($LASTEXITCODE -ne 0) { Write-Host "خطأ: فشل بناء صورة العزل - راجع رسائل docker."; exit 1 }

Write-Step "بناء لوحة التحكم بوكيل API المربوط بالمنفذ $apiPort"
$env:AGENTBRIDGE_API_ORIGIN = "http://127.0.0.1:$apiPort"
try {
  & pnpm --filter @agentbridge/dashboard build
  if ($LASTEXITCODE -ne 0) { Write-Host "خطأ: فشل بناء لوحة التحكم."; exit 1 }
} finally {
  Remove-Item "env:AGENTBRIDGE_API_ORIGIN" -ErrorAction SilentlyContinue
}

Write-Step "إنشاء حساب الإدارة ومساحة العمل (المفتاح الخام يُكتب في ملف أسرار محمي)"
$adminKeyPath = Join-Path $script:Secrets "admin-credential.key"
if (Test-Path $adminKeyPath) {
  Write-Host "حساب الإدارة موجود مسبقًا ($adminKeyPath) - تخطّي الإنشاء."
} else {
  Import-EnvIntoSession (Read-EnvFile (Join-Path $script:Secrets "ops.env"))
  try {
    & pnpm exec tsx apps/cli/src/ops/ops-main.ts onboard-tenant --store live `
      --tenant $config["AB_TENANT_ID"] --name $config["AB_TENANT_NAME"] `
      --issuer "https://local.agentbridge.invalid" --subject "owner" `
      --permissions "resource:read,pipeline:run,pipeline:review,artifact:read,flywheel:read,flywheel:write,analytics:read" `
      --expires-in-days $config["AB_CREDENTIAL_DAYS"] --initial 1 --secret-output $adminKeyPath
    if ($LASTEXITCODE -ne 0) { Write-Host "خطأ: فشل إنشاء حساب الإدارة - راجع الرسالة أعلاه."; exit 1 }
  } finally {
    Remove-Item "env:DATABASE_URL", "env:ADMIN_DATABASE_URL" -ErrorAction SilentlyContinue
  }
}

Write-Host ""
Write-Step "تجهيز مساحة العمل المحلية ورمز الفتح المباشر (بلا شاشة مفتاح على جهازك)"
$localKeyPath = Join-Path $script:Secrets "local-credential.key"
if (-not (Test-Path $localKeyPath)) {
  Import-EnvIntoSession (Read-EnvFile (Join-Path $script:Secrets "ops.env"))
  try {
    & pnpm exec tsx apps/cli/src/ops/ops-main.ts onboard-tenant --store live `
      --tenant local --name "Local Workspace" `
      --issuer "https://local.agentbridge.invalid" --subject "local-owner" `
      --permissions "resource:read,pipeline:run,pipeline:review,artifact:read,flywheel:read,flywheel:write,analytics:read" `
      --expires-in-days 730 --secret-output $localKeyPath
    if ($LASTEXITCODE -ne 0) { Write-Host "خطأ: فشل إنشاء مساحة العمل المحلية - راجع الرسالة أعلاه."; exit 1 }
  } finally {
    Remove-Item "env:DATABASE_URL", "env:ADMIN_DATABASE_URL" -ErrorAction SilentlyContinue
  }
}

# متغيرات جلسة الوضع المحلي في api.env وحارس مضيف اللوحة - الإضافة لا الاستبدال.
# الجلسة تؤسس تلقائياً عند فتح /app: لا رمز ولا رابط خاص إطلاقاً.
$null = Ensure-EnvLines -Path (Join-Path $script:Secrets "api.env") -Lines @(
  "LOCAL_BOOTSTRAP=1",
  "LOCAL_TENANT_ID=local",
  "LOCAL_CREDENTIAL_ID=bootstrap-local",
  "LOCAL_ENFORCE_HOST=1")
$dashboardEnvPath = Join-Path $script:Runtime "dashboard.env"
@("LOCAL_ENFORCE_HOST=1", "DASHBOARD_PORT=$dashPort") | Set-Content -Path $dashboardEnvPath -Encoding ASCII
Write-Host "مساحة العمل المحلية جاهزة - افتح اللوحة بـ agentbridge open أو على /app مباشرة"

Write-Host ""
# إعادة تشغيل الخدمات إن كانت عاملة قبل الإعداد
if ($script:servicesWereRunning) {
  Write-Step "إعادة تشغيل الخدمات"
  & (Join-Path $PSScriptRoot "cmd-start.ps1")
}
Write-Host "اكتمل الإعداد بنجاح."
Write-Host "لوحة التحكم بعد التشغيل:  http://127.0.0.1:$dashPort/app"
Write-Host "معرف مساحة العمل:        $($config['AB_TENANT_ID'])"
Write-Host "ملف مفتاح الدخول (لا تُشاركه): $adminKeyPath"
Write-Host "التشغيل:  agentbridge start   |   الحالة:  agentbridge status"
