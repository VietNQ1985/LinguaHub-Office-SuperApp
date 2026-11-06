param(
  [string]$TargetDir = $env:CARGO_TARGET_DIR,
  [ValidateSet('Debug', 'Release')]
  [string]$Configuration = 'Release',
  [ValidateRange(1, 64)]
  [int]$Parallelism = 2
)

$ErrorActionPreference = 'Stop'
$targetRoot = if ($TargetDir) {
  [System.IO.Path]::GetFullPath($TargetDir)
} else {
  Join-Path $PSScriptRoot 'src-tauri\target'
}

$buildRoot = Join-Path $targetRoot ($Configuration.ToLowerInvariant() + '\build')
$projects = Get-ChildItem -LiteralPath $buildRoot -Directory -Filter 'whisper-rs-sys-*' -ErrorAction SilentlyContinue |
  ForEach-Object { Join-Path $_.FullName 'out\build\src\whisper.vcxproj' } |
  Where-Object { Test-Path -LiteralPath $_ } |
  Sort-Object { (Get-Item -LiteralPath $_).LastWriteTime } -Descending

if (-not $projects) {
  throw "Whisper MSBuild project was not found under $buildRoot. Run a Cargo build once to configure whisper-rs-sys."
}

$programFilesX86 = [System.Environment]::GetFolderPath('ProgramFilesX86')
$vswhere = Join-Path $programFilesX86 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) { throw "Visual Studio locator was not found: $vswhere" }

$vsRoot = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsRoot) { throw 'Visual Studio C++ Build Tools with x64 support were not found.' }

$msbuild = Join-Path $vsRoot 'MSBuild\Current\Bin\amd64\MSBuild.exe'
if (-not (Test-Path -LiteralPath $msbuild)) { throw "MSBuild was not found: $msbuild" }

$stdout = Join-Path $PSScriptRoot 'msbuild-whisper.stdout.log'
$stderr = Join-Path $PSScriptRoot 'msbuild-whisper.stderr.log'
$exitFile = Join-Path $PSScriptRoot 'msbuild-whisper.exit'
$errorFile = Join-Path $PSScriptRoot 'msbuild-whisper.worker-error.log'
Set-Content -LiteralPath (Join-Path $PSScriptRoot 'msbuild-whisper.started') -Value (Get-Date -Format o) -Encoding Ascii

try {
  $project = $projects | Select-Object -First 1
  $buildArguments = @('"' + $project + '"', '/t:Build', "/p:Configuration=$Configuration", '/p:Platform=x64', '/p:BuildProjectReferences=false', "/m:$Parallelism", '/v:minimal')
  $buildProcess = Start-Process -FilePath $msbuild -ArgumentList $buildArguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  Set-Content -LiteralPath $exitFile -Value $buildProcess.ExitCode -Encoding Ascii
  exit $buildProcess.ExitCode
} catch {
  Set-Content -LiteralPath $errorFile -Value ($_ | Out-String) -Encoding UTF8
  throw
}
