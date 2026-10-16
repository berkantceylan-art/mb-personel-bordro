@echo off
chcp 65001 >nul
setlocal
set "SRC=%~dp0"
set "DEST=%LOCALAPPDATA%\MBDentalPDKS"
set "BILGIAKTAR=C:\Program Files (x86)\EromPDKS\Bilgi Aktar ZK\Bilgi_Aktar 4.0.0.60.exe"

echo MB Dental PDKS aktarici kuruluyor...
if not exist "%SRC%ayar.json" (
  echo HATA: ayar.json bu klasorde yok. ERP'de Puantaj ^> Otomatik aktarim ekranindan indirip buraya koyun.
  pause
  exit /b 1
)

if not exist "%DEST%" mkdir "%DEST%"
copy /Y "%SRC%aktarici.ps1" "%DEST%\" >nul
copy /Y "%SRC%gizli.vbs" "%DEST%\" >nul
copy /Y "%SRC%ayar.json" "%DEST%\" >nul

rem 5 dakikada bir calisan gorev (bu kullanici oturumunda)
schtasks /Create /F /TN "MB Dental PDKS aktarici" /SC MINUTE /MO 5 /TR "wscript.exe \"%DEST%\gizli.vbs\"" >nul
if errorlevel 1 (
  echo HATA: Gorev Zamanlayici gorevi olusturulamadi.
  pause
  exit /b 1
)

rem Bilgi Aktar bilgisayar acilinca kendiliginden baslasin
if exist "%BILGIAKTAR%" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\Bilgi Aktar ZK.lnk'); $s.TargetPath='%BILGIAKTAR%'; $s.WorkingDirectory=[IO.Path]::GetDirectoryName('%BILGIAKTAR%'); $s.Save()"
  echo Bilgi Aktar ZK baslangica eklendi.
) else (
  echo UYARI: Bilgi Aktar programi bulunamadi, baslangica eklenmedi.
)

echo Ilk aktarim yapiliyor...
powershell -NoProfile -ExecutionPolicy Bypass -File "%DEST%\aktarici.ps1"
if exist "%DEST%\aktarici.log" powershell -NoProfile -Command "Get-Content '%DEST%\aktarici.log' -Tail 3"
echo.
echo Kurulum tamam. Aktarici 5 dakikada bir calisacak. Durumu ERP'de Puantaj ^> Otomatik aktarim ekraninda gorebilirsiniz.
pause
