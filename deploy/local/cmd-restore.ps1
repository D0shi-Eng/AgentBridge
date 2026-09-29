# أمر الاستعادة - يعيد قاعدة البيانات من نسخة احتياطية سابقة بعد إيقاف API.
# يتطلب تأكيدًا صريحًا (-Yes) لأن الاستعادة تستبدل محتوى قاعدة البيانات الحالية.
# بوابة تمهيدية fail-closed: تتحقق من سلامة ملف النسخة (SHA-256 من البيان) ومن
# وجود الأدوار المقيدة (agentbridge_owner/agentbridge_app/ab_app) في الهدف قبل
# إيقاف API أو لمس أي بيانات - لأن تفريغًا أعيد لهدف بلا هذه الأدوار يفشل جزئيًا
# بعد الضرر (أخطاء OWNER/ACL تترك المخطط بملكية ناقصة) بدل رفض نظيف قبل البدء.

param([string]$File = "", [switch]$Yes)

. (Join-Path $PSScriptRoot "lib-common.ps1")

if ($File -eq "") {
  Write-Host "خطأ: حدد ملف النسخة:  agentbridge restore -File `"<مسار .dump>`" -Yes"
  exit 1
}
if (-not (Test-Path $File)) {
  Write-Host "خطأ: ملف النسخة غير موجود: $File"
  exit 1
}
if (-not $Yes) {
  Write-Host "خطأ: الاستعادة تستبدل البيانات الحالية - أعد الأمر مع -Yes للتأكيد الصريح."
  exit 1
}

Set-Location $script:Root
Assert-Installed
Assert-DockerAvailable

# تحقق سلامة النسخة من بيانها إن وُجد - ملف تالف لا يُمس به الهدف أصلاً
$manifestPath = "$File.manifest.json"
if (Test-Path $manifestPath) {
  Write-Step "التحقق من بصمة النسخة قبل الاستعادة"
  $manifest = Get-Content $manifestPath | ConvertFrom-Json
  $actualHash = (Get-FileHash -Path $File -Algorithm SHA256).Hash.ToLower()
  if ($actualHash -ne $manifest.sha256) {
    Write-Host "خطأ: بصمة النسخة لا تطابق بيانها - الملف تالف أو متغير. رفض الاستعادة."
    Write-Host "المتوقع: $($manifest.sha256)"
    Write-Host "الفعلي:  $actualHash"
    exit 1
  }
  Write-Host "البصمة مطابقة للبيان."
}

# الأدوار المقيدة التي يفترضها التفريغ في كل عبارات الملكية - غياب أي منها
# يعني استعادة جزئية مضمونة، فالرفض تمهيدًا قبل إيقاف API أو المسّ بالبيانات
Write-Step "التحقق من أدوار الهدف المقيدة قبل الاستعادة"
foreach ($role in @("agentbridge_owner", "agentbridge_app", "ab_app")) {
  # "$out" تحول الخرج الفارغ إلى سلسلة فارغة بأمان - لا استدعاء دوال على null
  $out = (& docker exec $script:PgContainer psql -U agentbridge -d agentbridge -t -A -c "SELECT 1 FROM pg_roles WHERE rolname='$role'" 2>$null)
  if ("$out".Trim() -ne "1") {
    Write-Host "خطأ: الدور المقيد $role غير موجود في قاعدة الهدف - الاستعادة ستفشل جزئيًا (أخطاء ملكية)."
    Write-Host "أعد إعداد الأدوار المقيدة (خطوة setup) أو استهدف الخادم الأصلي ثم حاول مجددًا. لم يُمس أي بيان."
    exit 1
  }
}
Write-Host "الأدوار المقيدة الثلاث موجودة."

Write-Step "إيقاف API قبل الاستعادة (منع كتابة متزامنة أثناء الاستبدال)"
$apiPidFile = Join-Path $script:Pids "api.pid"
$apiWasRunning = Test-PidAlive -PidFile $apiPidFile
if ($apiWasRunning) {
  $procId = [int](Get-Content $apiPidFile | Select-Object -First 1)
  $null = Stop-ProcessTree -ProcId $procId
  Write-Host "API : أُوقفت مؤقتًا للاستعادة"
}

Write-Step "استعادة المحتوى من النسخة (pg_restore --clean --if-exists)"
& docker cp $File "${script:PgContainer}:/tmp/ab-restore.dump"
if ($LASTEXITCODE -ne 0) { Write-Host "خطأ: تعذر إدخال ملف النسخة إلى الحاوية."; exit 1 }
& docker exec $script:PgContainer pg_restore -U agentbridge -d agentbridge --clean --if-exists /tmp/ab-restore.dump
$restoreCode = $LASTEXITCODE
& docker exec $script:PgContainer rm /tmp/ab-restore.dump | Out-Null
if ($restoreCode -ne 0) {
  Write-Host "خطأ: فشل pg_restore (رمز $restoreCode) - قاعدة البيانات قد تكون جزئية."
  Write-Host "أعد الاستعادة من نفس النسخة بعد معالجة السبب، أو استعن بفحص: docker logs $script:PgContainer"
  exit 1
}

Write-Step "إعادة تشغيل API إن كانت عاملة قبل الاستعادة"
if ($apiWasRunning) {
  $proc = Start-Process -FilePath "powershell" -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "run-api.ps1")) `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $script:Logs "api.log") `
    -RedirectStandardError (Join-Path $script:Logs "api.err.log")
  Set-Content -Path $apiPidFile -Value $proc.Id -Encoding ASCII
  $config = Get-LocalConfig
  if (-not (Wait-HttpOk -Url "http://127.0.0.1:$([int]$config['AB_API_PORT'])/health" -TimeoutSec 90)) {
    Write-Host "خطأ: API لم تعد جاهزة بعد الاستعادة - راجع runtime\logs\api.err.log"
    exit 1
  }
  Write-Host "API : عادت للعمل"
}
Write-Host "تمت الاستعادة بنجاح من: $File"
