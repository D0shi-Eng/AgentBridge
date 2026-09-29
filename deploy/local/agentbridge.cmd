@echo off
rem نافذة أوامر رقيقة — تمرر كل المعاملات إلى سكربت PowerShell الموحد
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agentbridge.ps1" %*
