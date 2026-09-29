# أمر النسخ الاحتياطي - تفريغ PostgreSQL بتنسيق مخصص إلى runtime\backups
# عبر docker cp (نقل ملفات ثنائي سليم بلا تشويه ترميز)، مع بيان وثائقي
# بالبصمة والحجم. الأسرار لا تُنسخ تلقائيًا - مجلد runtime\secrets مسؤوليتك.

param([string]$Name = "")

. (Join-Path $PSScriptRoot "lib-common.ps1")

Set-Location $script:Root
Assert-Installed
Assert-DockerAvailable

if (-not (Test-Path $script:Backups)) { New-Item -ItemType Directory -Path $script:Backups -Force | Out-Null }
$stamp = (Get-Date).ToString("yyyyMMdd-HHmmss")
$suffix = ""
if ($Name -ne "") { $suffix = "-$Name" }
$dumpFile = Join-Path $script:Backups "agentbridge-$stamp$suffix.dump"

Write-Step "تفريغ قاعدة البيانات داخل الحاوية ثم نقلها إلى runtime\backups"
& docker exec $script:PgContainer pg_dump -U agentbridge -d agentbridge -Fc -f /tmp/ab-backup.dump
if ($LASTEXITCODE -ne 0) { Write-Host "خطأ: فشل pg_dump داخل الحاوية - راجع رسالة docker."; exit 1 }
& docker cp "${script:PgContainer}:/tmp/ab-backup.dump" $dumpFile
if ($LASTEXITCODE -ne 0) { Write-Host "خطأ: تعذر نقل ملف النسخة من الحاوية."; exit 1 }
& docker exec $script:PgContainer rm /tmp/ab-backup.dump | Out-Null

$hash = (Get-FileHash -Path $dumpFile -Algorithm SHA256).Hash.ToLower()
$size = (Get-Item $dumpFile).Length
$manifest = [ordered]@{
  file = (Split-Path -Leaf $dumpFile)
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  database = "agentbridge"
  sha256 = $hash
  bytes = $size
}
$manifest | ConvertTo-Json | Set-Content -Path "$dumpFile.manifest.json" -Encoding ASCII

Write-Host "تمت النسخة الاحتياطية: $dumpFile"
Write-Host "الحجم: $size بايت | SHA-256: $hash"
Write-Host "الاستعادة لاحقًا:  agentbridge restore -File `"$dumpFile`" -Yes"
