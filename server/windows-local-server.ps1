# Neon dependency-free Windows loopback launcher. It verifies copied production bytes before exposing them to this PC.
# Neon 零依赖 Windows 回环启动器：先校验搬移后的生产文件，再仅向本机提供游戏。
[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$EntryName = 'Neon_Autopilot_HighSpeed_DroneHeat.html'
$EntryPath = Join-Path $ProjectRoot $EntryName
$ManifestPath = Join-Path $PSScriptRoot 'windows-production-manifest.json'
$AllowedDirectories = @('assets', 'errors', 'src', 'styles', 'vendor')
$FirstPort = 48723
$LastPort = 48732
$Utf8 = [System.Text.UTF8Encoding]::new($false)
$Utf8WithBom = [System.Text.UTF8Encoding]::new($true)
$Ascii = [System.Text.Encoding]::ASCII
$script:LaunchLogPath = [System.Environment]::GetEnvironmentVariable('Neon_LAUNCH_LOG')
if ([string]::IsNullOrWhiteSpace($script:LaunchLogPath)) {
  $script:LaunchLogPath = Join-Path ([System.IO.Path]::GetTempPath()) 'Neon-Windows-launch.log'
}
$script:LaunchLogReady = $false

function Initialize-LaunchLog {
  try {
    $logDirectory = [System.IO.Path]::GetDirectoryName($script:LaunchLogPath)
    if (-not [System.IO.Directory]::Exists($logDirectory)) {
      [void][System.IO.Directory]::CreateDirectory($logDirectory)
    }
    $header = "Neon Windows local launcher log - $(Get-Date -Format 'o')`r`n"
    [System.IO.File]::WriteAllText($script:LaunchLogPath, $header, $Utf8WithBom)
    $script:LaunchLogReady = $true
  } catch {
    # Logging is diagnostic-only; a locked TEMP folder must not replace the real startup result.
    Write-Warning "无法创建启动日志：$($_.Exception.Message)"
  }
}

function Write-LauncherMessage {
  param(
    [string]$Message,
    [System.ConsoleColor]$ForegroundColor = [System.ConsoleColor]::Gray
  )
  Write-Host "[Neon] $Message" -ForegroundColor $ForegroundColor
  if (-not $script:LaunchLogReady) { return }
  try {
    $line = "$(Get-Date -Format 'o') [Neon] $Message`r`n"
    [System.IO.File]::AppendAllText($script:LaunchLogPath, $line, $Utf8)
  } catch {
    # Stop retrying after a diagnostic-log failure so gameplay startup remains independent of TEMP.
    $script:LaunchLogReady = $false
    Write-Warning "无法继续写入启动日志：$($_.Exception.Message)"
  }
}

function Write-LauncherDiagnostic {
  param([System.Management.Automation.ErrorRecord]$ErrorRecord)
  if (-not $script:LaunchLogReady) { return }
  try {
    $details = ($ErrorRecord | Out-String) + "`r`n"
    [System.IO.File]::AppendAllText($script:LaunchLogPath, $details, $Utf8)
  } catch {
    $script:LaunchLogReady = $false
    Write-Warning "无法写入错误详情：$($_.Exception.Message)"
  }
}

function Stop-WithFailure {
  param([string]$Message, [int]$ExitCode = 1)
  $failure = [System.InvalidOperationException]::new($Message)
  $failure.Data['NeonExitCode'] = $ExitCode
  throw $failure
}

function Test-PathInsideRoot {
  param([string]$Candidate)
  $rootPrefix = $ProjectRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) `
    + [System.IO.Path]::DirectorySeparatorChar
  return $Candidate.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Assert-ProductionIntegrity {
  if (-not (Test-Path -LiteralPath $EntryPath -PathType Leaf)) {
    Stop-WithFailure "主游戏文件缺失：$EntryName。请重新复制完整游戏目录。" 2
  }
  if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
    Stop-WithFailure '完整性清单缺失：server\windows-production-manifest.json。' 2
  }

  try {
    $manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    Stop-WithFailure "无法读取完整性清单：$($_.Exception.Message)" 2
  }
  if ($manifest.schemaVersion -ne 2 -or [string]::IsNullOrWhiteSpace([string]$manifest.release)) {
    Stop-WithFailure '完整性清单版本无效。' 2
  }

  $entrySource = [System.IO.File]::ReadAllText($EntryPath, $Utf8)
  $escapedRelease = [System.Text.RegularExpressions.Regex]::Escape([string]$manifest.release)
  if ($entrySource -notmatch '"state"\s*:\s*"stable"' `
    -or $entrySource -notmatch ('"noticeId"\s*:\s*"' + $escapedRelease + '"')) {
    Stop-WithFailure "主文件与资源代次不一致；应为 $($manifest.release)。请等待云盘同步完成或重新复制。" 3
  }

  $fileCount = @($manifest.files).Count
  $verifiedCount = 0
  Write-LauncherMessage "正在校验 $fileCount 个启动与运行文件……" Cyan
  foreach ($file in @($manifest.files)) {
    $relativePath = [string]$file.path
    if ([string]::IsNullOrWhiteSpace($relativePath) `
      -or [System.IO.Path]::IsPathRooted($relativePath) `
      -or $relativePath.Contains('..') `
      -or $relativePath.Contains([char]0)) {
      Stop-WithFailure "完整性清单包含非法路径：$relativePath" 3
    }
    $platformPath = $relativePath.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    $fullPath = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot $platformPath))
    if (-not (Test-PathInsideRoot $fullPath) -or -not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
      Stop-WithFailure "运行文件缺失：$relativePath。请确认 iCloud 已完整下载。" 3
    }
    $length = (Get-Item -LiteralPath $fullPath).Length
    if ($length -ne [Int64]$file.size) {
      Stop-WithFailure "运行文件大小不匹配：$relativePath。请等待同步完成后重试。" 3
    }
    try {
      $digest = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
    } catch {
      Stop-WithFailure "无法完整读取运行文件：$relativePath。$($_.Exception.Message)" 3
    }
    if ($digest -ne ([string]$file.sha256).ToLowerInvariant()) {
      Stop-WithFailure "运行文件内容不匹配：$relativePath。请删除旧副本并重新复制完整目录。" 3
    }
    $verifiedCount += 1
    if (($verifiedCount % 10) -eq 0 -or $verifiedCount -eq $fileCount) {
      Write-LauncherMessage "完整性校验 $verifiedCount / $fileCount" DarkCyan
    }
  }
  Write-LauncherMessage "文件完整性通过，发布代次 $($manifest.release)。" Green
}

function New-LoopbackListener {
  foreach ($port in $FirstPort..$LastPort) {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
    try {
      $listener.Start(32)
      return [PSCustomObject]@{ Listener = $listener; Port = $port }
    } catch [System.Net.Sockets.SocketException] {
      $listener.Stop()
    }
  }
  Stop-WithFailure "本机端口 $FirstPort-$LastPort 均被占用。请关闭旧的 Neon 启动窗口后重试。" 4
}

function Get-MimeType {
  param([string]$Path)
  switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    '.css' { return 'text/css; charset=utf-8' }
    '.html' { return 'text/html; charset=utf-8' }
    '.js' { return 'text/javascript; charset=utf-8' }
    '.json' { return 'application/json; charset=utf-8' }
    '.mp3' { return 'audio/mpeg' }
    '.ogg' { return 'audio/ogg' }
    '.png' { return 'image/png' }
    '.wav' { return 'audio/wav' }
    default { return 'application/octet-stream' }
  }
}

function Resolve-PublicFile {
  param([string]$EncodedPath)
  try {
    $decodedPath = [System.Uri]::UnescapeDataString($EncodedPath)
  } catch {
    return $null
  }
  if ($decodedPath -eq '/') { return $EntryPath }
  if (-not $decodedPath.StartsWith('/') -or $decodedPath.StartsWith('//') `
    -or $decodedPath.Contains('\') -or $decodedPath.Contains([char]0)) {
    return $null
  }

  $segments = @($decodedPath.Substring(1).Split('/'))
  if ($segments.Count -lt 2 -or $AllowedDirectories -notcontains $segments[0]) { return $null }
  foreach ($segment in $segments) {
    if ([string]::IsNullOrWhiteSpace($segment) -or $segment -eq '.' -or $segment -eq '..' `
      -or $segment.StartsWith('.')) {
      return $null
    }
  }
  $relativePath = [string]::Join([System.IO.Path]::DirectorySeparatorChar, $segments)
  $candidate = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot $relativePath))
  if (-not (Test-PathInsideRoot $candidate) -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
    return $null
  }
  return $candidate
}

function Resolve-ByteRange {
  param([string]$Header, [Int64]$Size)
  if ([string]::IsNullOrWhiteSpace($Header)) { return $null }
  $match = [System.Text.RegularExpressions.Regex]::Match($Header.Trim(), '^bytes=(\d*)-(\d*)$')
  if (-not $match.Success -or $Size -le 0 `
    -or ([string]::IsNullOrEmpty($match.Groups[1].Value) `
      -and [string]::IsNullOrEmpty($match.Groups[2].Value))) {
    return [PSCustomObject]@{ Unsatisfiable = $true }
  }

  if ([string]::IsNullOrEmpty($match.Groups[1].Value)) {
    [Int64]$suffixLength = $match.Groups[2].Value
    if ($suffixLength -le 0) { return [PSCustomObject]@{ Unsatisfiable = $true } }
    $start = [Math]::Max(0, $Size - $suffixLength)
    $end = $Size - 1
  } else {
    [Int64]$start = $match.Groups[1].Value
    $end = if ([string]::IsNullOrEmpty($match.Groups[2].Value)) {
      $Size - 1
    } else {
      [Int64]$match.Groups[2].Value
    }
    if ($start -ge $Size -or $end -lt $start) {
      return [PSCustomObject]@{ Unsatisfiable = $true }
    }
    $end = [Math]::Min($end, $Size - 1)
  }
  return [PSCustomObject]@{
    Unsatisfiable = $false
    Start = [Int64]$start
    End = [Int64]$end
    Length = [Int64]($end - $start + 1)
  }
}

function Write-Headers {
  param(
    [System.IO.Stream]$Stream,
    [int]$StatusCode,
    [string]$Reason,
    [hashtable]$Headers
  )
  $lines = [System.Collections.Generic.List[string]]::new()
  $lines.Add("HTTP/1.1 $StatusCode $Reason")
  foreach ($name in $Headers.Keys) { $lines.Add("$name`: $($Headers[$name])") }
  $lines.Add('Connection: close')
  $headerBytes = $Ascii.GetBytes(([string]::Join("`r`n", $lines) + "`r`n`r`n"))
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
}

function Write-TextResponse {
  param(
    [System.IO.Stream]$Stream,
    [int]$StatusCode,
    [string]$Reason,
    [string]$Message,
    [bool]$HeadOnly = $false,
    [hashtable]$ExtraHeaders = @{}
  )
  $body = $Utf8.GetBytes($Message)
  $headers = @{
    'Cache-Control' = 'no-store'
    'Content-Length' = $body.Length
    'Content-Type' = 'text/plain; charset=utf-8'
    'X-Content-Type-Options' = 'nosniff'
  }
  foreach ($name in $ExtraHeaders.Keys) { $headers[$name] = $ExtraHeaders[$name] }
  Write-Headers $Stream $StatusCode $Reason $headers
  if (-not $HeadOnly -and $body.Length -gt 0) { $Stream.Write($body, 0, $body.Length) }
}

function Send-FileResponse {
  param(
    [System.IO.Stream]$Stream,
    [string]$FilePath,
    [string]$Method,
    [string]$RangeHeader
  )
  $fileInfo = Get-Item -LiteralPath $FilePath
  $range = Resolve-ByteRange $RangeHeader $fileInfo.Length
  if ($range -and $range.Unsatisfiable) {
    Write-TextResponse $Stream 416 'Range Not Satisfiable' 'Requested byte range is unavailable.' `
      ($Method -eq 'HEAD') @{ 'Content-Range' = "bytes */$($fileInfo.Length)" }
    return
  }

  $start = if ($range) { $range.Start } else { [Int64]0 }
  $length = if ($range) { $range.Length } else { [Int64]$fileInfo.Length }
  $statusCode = if ($range) { 206 } else { 200 }
  $reason = if ($range) { 'Partial Content' } else { 'OK' }
  $headers = @{
    'Accept-Ranges' = 'bytes'
    'Cache-Control' = 'no-cache'
    'Content-Length' = $length
    'Content-Type' = Get-MimeType $FilePath
    'Content-Security-Policy' = "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self' data: blob:; media-src 'self'; object-src 'none'; script-src 'self'; style-src 'self'"
    'Cross-Origin-Opener-Policy' = 'same-origin'
    'Cross-Origin-Resource-Policy' = 'same-origin'
    'Referrer-Policy' = 'no-referrer'
    'X-Content-Type-Options' = 'nosniff'
    'X-Frame-Options' = 'DENY'
  }
  if ($range) { $headers['Content-Range'] = "bytes $($range.Start)-$($range.End)/$($fileInfo.Length)" }
  Write-Headers $Stream $statusCode $reason $headers
  if ($Method -eq 'HEAD' -or $length -eq 0) { return }

  $fileStream = [System.IO.File]::Open($FilePath, [System.IO.FileMode]::Open, `
    [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
  try {
    [void]$fileStream.Seek($start, [System.IO.SeekOrigin]::Begin)
    $buffer = New-Object byte[] 65536
    [Int64]$remaining = $length
    while ($remaining -gt 0) {
      $read = $fileStream.Read($buffer, 0, [int][Math]::Min($buffer.Length, $remaining))
      if ($read -le 0) { throw 'Unexpected end of verified production file.' }
      $Stream.Write($buffer, 0, $read)
      $remaining -= $read
    }
  } finally {
    $fileStream.Dispose()
  }
}

function Handle-Client {
  param([System.Net.Sockets.TcpClient]$Client, [int]$Port)
  $Client.NoDelay = $true
  # Browsers can leave speculative preconnections empty; bound them so one socket cannot stall the server.
  $Client.ReceiveTimeout = 2000
  $Client.SendTimeout = 30000
  $stream = $Client.GetStream()
  $reader = [System.IO.StreamReader]::new($stream, $Ascii, $false, 4096, $true)
  try {
    $requestLine = $reader.ReadLine()
    if ([string]::IsNullOrWhiteSpace($requestLine)) { return }
    $parts = @($requestLine.Split(' '))
    if ($parts.Count -ne 3) {
      Write-TextResponse $stream 400 'Bad Request' 'Malformed request line.'
      return
    }
    $method = $parts[0].ToUpperInvariant()
    $requestTarget = $parts[1]
    $headers = @{}
    while ($true) {
      $line = $reader.ReadLine()
      if ([string]::IsNullOrEmpty($line)) { break }
      $separator = $line.IndexOf(':')
      if ($separator -le 0) { continue }
      $headers[$line.Substring(0, $separator).Trim()] = $line.Substring($separator + 1).Trim()
    }
    if ($method -ne 'GET' -and $method -ne 'HEAD') {
      Write-TextResponse $stream 405 'Method Not Allowed' 'Only GET and HEAD are allowed.' $false `
        @{ 'Allow' = 'GET, HEAD' }
      return
    }
    $expectedHost = "127.0.0.1`:$Port"
    if ([string]$headers['Host'] -ne $expectedHost) {
      Write-TextResponse $stream 421 'Misdirected Request' 'Loopback Host header required.' ($method -eq 'HEAD')
      return
    }
    try {
      $requestUri = [System.Uri]::new("http://127.0.0.1$requestTarget")
    } catch {
      Write-TextResponse $stream 400 'Bad Request' 'Malformed request target.' ($method -eq 'HEAD')
      return
    }
    $publicFile = Resolve-PublicFile $requestUri.AbsolutePath
    if (-not $publicFile) {
      Write-TextResponse $stream 404 'Not Found' 'Production resource not found.' ($method -eq 'HEAD')
      return
    }
    Send-FileResponse $stream $publicFile $method ([string]$headers['Range'])
  } finally {
    $reader.Dispose()
    $stream.Dispose()
    $Client.Dispose()
  }
}

function Open-GameBrowser {
  param([string]$Url)
  try {
    Start-Process -FilePath $Url
    return
  } catch {
    Write-LauncherMessage "默认浏览器未能直接打开；正在尝试 Windows 资源管理器。" Yellow
    Write-LauncherDiagnostic $_
  }
  try {
    Start-Process -FilePath 'explorer.exe' -ArgumentList @($Url)
  } catch {
    # Browser launch is non-core: keep the verified loopback server alive and expose a copyable URL.
    Write-LauncherMessage "浏览器未能自动打开。请手工复制此地址：$Url" Yellow
    Write-LauncherDiagnostic $_
  }
}

$server = $null
$exitCode = 0
Initialize-LaunchLog
Write-LauncherMessage "项目目录：$ProjectRoot" Cyan
try {
  Assert-ProductionIntegrity
  $server = New-LoopbackListener
  $url = "http://127.0.0.1`:$($server.Port)/"
  Write-LauncherMessage "本地游戏已就绪：$url" Green
  Write-LauncherMessage '此窗口仅服务本机。关闭窗口或按 Ctrl+C 即停止。' Yellow
  Open-GameBrowser $url
  while ($true) {
    $client = $server.Listener.AcceptTcpClient()
    try {
      Handle-Client $client $server.Port
    } catch {
      Write-LauncherMessage "本地请求失败：$($_.Exception.Message)" Yellow
      Write-LauncherDiagnostic $_
      try { $client.Dispose() } catch {}
    }
  }
} catch [System.Management.Automation.PipelineStoppedException] {
  $exitCode = 0
  Write-LauncherMessage '本地服务已由用户停止。' Yellow
} catch {
  $exitCode = if ($_.Exception.Data.Contains('NeonExitCode')) {
    [int]$_.Exception.Data['NeonExitCode']
  } else {
    5
  }
  Write-LauncherMessage $_.Exception.Message Red
  Write-LauncherDiagnostic $_
} finally {
  if ($null -ne $server) { $server.Listener.Stop() }
}
exit $exitCode
