# نقطة الدخول الموحدة لحزمة التشغيل المحلية - AgentBridge على جهاز واحد.
# الاستخدام من أي مكان (عبر agentbridge.cmd):
#   agentbridge <setup|start|status|stop|update|backup|restore> [معاملات]
# كل الأوامر تعمل فوق runtime\ المحلي فقط ولا تلمس أي تثبيت آخر.

$ErrorActionPreference = "Stop"
$command = if ($args.Count -gt 0) { $args[0].ToLower() } else { "" }
$rest = @()
if ($args.Count -gt 1) { $rest = $args[1..($args.Count - 1)] }

$usage = @"
AgentBridge Local - حزمة تشغيل المنصة محليًا على 127.0.0.1

الأوامر:
  setup              الإعداد الأولي (مجلدات + أسرار مولدة + قاعدة بيانات + حساب إدارة)
  start              تشغيل كل الخدمات (قابل لإعادة التنفيذ بلا فقد بيانات)
  status             حالة كل مكوّن (رمز خروج 0 سليم / 1 متدهور)
  stop               إيقاف الخدمات مع بقاء البيانات
  update             سحب المصدر وبناء الجديد وتطبيق الهجرات بأمان
  backup [-Name s]   نسخة احتياطية من قاعدة البيانات إلى runtime\backups
  open               فتح اللوحة في المتصفح الافتراضي (تشغيل الخدمات إن كانت متوقفة)
  restore -File <f> -Yes   استعادة نسخة احتياطية (تأكيد صريح إلزامي)
"@

# كل أمر يُنفَّذ كعملية فرعية حتى ينتقل رمز الخروج بصدق - الاستدعاء
# المتداخل داخل نفس الجلسة يُفقد رمز الخروج (سلوك PowerShell الموثق)
switch ($command) {
  "setup"   { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "cmd-setup.ps1") @rest; exit $LASTEXITCODE }
  "start"   { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "cmd-start.ps1") @rest; exit $LASTEXITCODE }
  "status"  { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "cmd-status.ps1") @rest; exit $LASTEXITCODE }
  "stop"    { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "cmd-stop.ps1") @rest; exit $LASTEXITCODE }
  "update"  { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "cmd-update.ps1") @rest; exit $LASTEXITCODE }
  "open"    { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "cmd-open.ps1") @rest; exit $LASTEXITCODE }
  "backup"  { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "cmd-backup.ps1") @rest; exit $LASTEXITCODE }
  "restore" { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "cmd-restore.ps1") @rest; exit $LASTEXITCODE }
  "help" { Write-Host $usage }
  "--help" { Write-Host $usage }
  "-h" { Write-Host $usage }
  default {
    Write-Host $usage
    if ($command -ne "") { Write-Host ""; Write-Host "أمر غير معروف: $command"; exit 2 }
    exit 2
  }
}
