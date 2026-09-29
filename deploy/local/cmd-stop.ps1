# أمر الإيقاف - يوقف اللوحة ثم API ثم الحاويات بسلامة.
# البيانات في runtime\data باقية حرفيًا: الإيقاف لا يمس مجلدات البيانات أبدًا.

. (Join-Path $PSScriptRoot "lib-common.ps1")

Set-Location $script:Root
$config = Get-LocalConfig
$dashPort = [int]$config["AB_DASH_PORT"]

Write-Step "إيقاف لوحة التحكم وخدمة API"
foreach ($name in @("dashboard", "api")) {
  $pidFile = Join-Path $script:Pids "$name.pid"
  if (Test-PidAlive -PidFile $pidFile) {
    $procId = [int](Get-Content $pidFile | Select-Object -First 1)
    $null = Stop-ProcessTree -ProcId $procId
    Write-Host "$name : أُوقفت (شجرة العملية $procId)"
  } elseif (Test-Path $pidFile) {
    Remove-Item $pidFile -Force
    Write-Host "$name : لم تكن عاملة (مُسح ملف قديم)"
  } else {
    Write-Host "$name : لم تكن عاملة"
  }
}

Write-Step "إيقاف الحاويات (البيانات تبقى محفوظة في runtime\data)"
$dockerOk = $true
$null = & docker info --format "{{.ServerVersion}}" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "تنبيه: Docker غير متاح الآن - الحاويات إن كانت عاملة ستظل كذلك حتى إتاحته."
  $dockerOk = $false
}
if ($dockerOk) {
  if (Test-Path $script:ComposePath) {
    & docker compose --env-file (Join-Path $script:Secrets "compose.env") -f $script:ComposePath stop
    if ($LASTEXITCODE -ne 0) { Write-Host "خطأ: تعذر إيقاف الحاويات - راجع رسالة docker أعلاه."; exit 1 }
  } else {
    & docker stop $script:PgContainer $script:RedisContainer 2>$null | Out-Null
  }
}
Write-Host "تم الإيقاف. للتشغيل من جديد:  agentbridge start"
