# مشغل لوحة التحكم في الخلفية - يخدم نسخة البناء الإنتاجية على منفذ الجهاز
# المحدد في runtime\local.env. وكيل /api مقروء من لقطة البناء (خطوة setup).

. (Join-Path $PSScriptRoot "lib-common.ps1")

$config = Get-LocalConfig
$dashPort = [int]$config["AB_DASH_PORT"]
# حارس مضيف اللوحة في المسار المحلي - المتغيران يقرؤهما middleware وقت التشغيل
$dashEnv = Join-Path $script:Runtime "dashboard.env"
if (Test-Path $dashEnv) { Import-EnvIntoSession (Read-EnvFile -Path $dashEnv) }
$nextDir = Join-Path $script:Root "apps\dashboard\.next"
if (-not (Test-Path $nextDir)) {
  Write-Host "خطأ: نسخة بناء اللوحة غير موجودة (apps\dashboard\.next) - شغّل agentbridge setup أو update أولًا."
  exit 1
}
Set-Location (Join-Path $script:Root "apps\dashboard")
# الربط بالحلقة المحلية حصراً في الوضع المحلي - اللوحة غير معروضة على الشبكة
& pnpm exec next start -H 127.0.0.1 -p $dashPort
exit $LASTEXITCODE
