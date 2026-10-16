# MB Dental PDKS aktarici
# Erom "Bilgi Aktar ZK" programinin yazdigi okutma dosyasini ERP'ye gonderir.
# Gorev Zamanlayici her 5 dakikada bir calistirir. Dosya degismediyse yalniz 15 dakikada bir "buradayim" sinyali yollar.
# Ayni okutma ERP'de ikinci kez eklenmez; bu yuzden dosyanin tamami gonderilir.
$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logFile = Join-Path $dir "aktarici.log"
$stateFile = Join-Path $dir "durum.json"

function Log($msg) {
  $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -Path $logFile -Value $line -Encoding UTF8
  if ((Get-Item $logFile).Length -gt 512KB) {
    $keep = Get-Content $logFile -Tail 2000
    Set-Content -Path $logFile -Value $keep -Encoding UTF8
  }
}

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $cfg = Get-Content (Join-Path $dir "ayar.json") -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not $cfg.url -or -not $cfg.token -or -not $cfg.dosya) { throw "ayar.json eksik (url, token, dosya)" }

  $state = @{ hash = ""; son_gonderim = "2000-01-01T00:00:00" }
  if (Test-Path $stateFile) {
    $s = Get-Content $stateFile -Raw | ConvertFrom-Json
    if ($s.hash) { $state.hash = $s.hash }
    if ($s.son_gonderim) { $state.son_gonderim = $s.son_gonderim }
  }

  $text = ""
  $hash = ""
  if (Test-Path -LiteralPath $cfg.dosya) {
    $bytes = [IO.File]::ReadAllBytes($cfg.dosya)
    $text = [Text.Encoding]::GetEncoding(1254).GetString($bytes)
    $sha = [Security.Cryptography.SHA256]::Create()
    $hash = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "")
    $lines = $text -split "`r?`n"
    if ($lines.Count -gt 20000) { $text = ($lines | Select-Object -Last 20000) -join "`r`n" }
  } else {
    Log "Dosya bulunamadi: $($cfg.dosya)"
  }

  $changed = $hash -ne "" -and $hash -ne $state.hash
  $sinceLast = (Get-Date) - [datetime]::Parse($state.son_gonderim)
  if (-not $changed -and $sinceLast.TotalMinutes -lt 15) { exit 0 }

  $body = if ($changed) { $text } else { "" }
  $headers = @{ Authorization = "Bearer $($cfg.token)"; "x-file-name" = [IO.Path]::GetFileName($cfg.dosya) }
  $r = Invoke-RestMethod -Uri $cfg.url -Method Post -Headers $headers -ContentType "text/plain; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 60

  if ($changed) {
    $state.hash = $hash
    Log ("Gonderildi: {0} okutma, {1} yeni, {2} zaten vardi" -f $r.read, $r.inserted, $r.dup)
  }
  $state.son_gonderim = (Get-Date).ToString("s")
  $state | ConvertTo-Json | Set-Content -Path $stateFile -Encoding UTF8
} catch {
  Log ("HATA: " + $_.Exception.Message)
  exit 1
}
