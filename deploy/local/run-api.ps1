# مشغل خدمة API في الخلفية - يضبط بيئة العملية من ملفات الأسرار المحلية فقط
# ويشغّل الخادم. لا يطبع أي قيمة سرية على الإطلاق (المخرجات إلى ملف السجل).

. (Join-Path $PSScriptRoot "lib-common.ps1")

$config = Get-LocalConfig
$apiEnv = Read-EnvFile -Path (Join-Path $script:Secrets "api.env")
if ($apiEnv.Count -eq 0) {
  Write-Host "خطأ: ملف أسرار API غير موجود - شغّل agentbridge setup أولًا."
  exit 1
}
Import-EnvIntoSession $apiEnv
Set-Location $script:Root
& pnpm --filter @agentbridge/api start
exit $LASTEXITCODE
