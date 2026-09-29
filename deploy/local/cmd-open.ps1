# أمر الفتح - يضمن عمل الخدمات ثم يفتح اللوحة في المتصفح الافتراضي مباشرة.
# التثبيت المحلي الفردي يؤسس الجلسة تلقائياً عند فتح /app: بلا معرف مساحة
# عمل، وبلا مفتاح API، وبلا أي رمز في الرابط أو سجل المتصفح.

. (Join-Path $PSScriptRoot "lib-common.ps1")

Set-Location $script:Root
Assert-Installed

$config = Get-LocalConfig
$dashPort = [int]$config["AB_DASH_PORT"]
$url = "http://127.0.0.1:$dashPort/app"

# الخدمات متوقفة؟ التشغيل أولاً - الفتح لا ينجح إلا على خدمات عامة فعلاً
$dashUp = Wait-HttpOk -Url "http://127.0.0.1:$dashPort/" -TimeoutSec 1
if (-not $dashUp) {
  Write-Host "الخدمات متوقفة - تشغيلها أولاً..."
  & (Join-Path $PSScriptRoot "cmd-start.ps1")
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# فتح المتصفح الافتراضي على اللوحة مباشرة - الرابط نظيف بلا أي رمز
Start-Process $url | Out-Null
Write-Host ""
Write-Host "فُتحت اللوحة في متصفحك: $url"
Write-Host "الجلسة المحلية تُؤسس تلقائياً - لا شاشة دخول ولا مفتاح."
Write-Host "إن ظهرت رسالة تعذر الوصول فانتظر ثوانٍ وأعد المحاولة (قد تكون الخدمات ما زالت تجهز)."
