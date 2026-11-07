param(
    [switch]$SkipTests,
    [string]$LibclangPath = $env:LIBCLANG_PATH,
    [string]$TargetDir = $env:CARGO_TARGET_DIR
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$packageMetadata = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
$appVersion = [string]$packageMetadata.version
if (-not $appVersion) { throw 'The application version was not found in package.json.' }
Push-Location $repoRoot

try {
    $programFilesX86 = [System.Environment]::GetFolderPath('ProgramFilesX86')
    $vswhere = Join-Path $programFilesX86 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path $vswhere)) { throw "Visual Studio locator was not found: $vswhere" }

    $vsRoot = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (-not $vsRoot) { throw 'Visual Studio C++ Build Tools with x64 support were not found.' }
    $vsDevCmd = Join-Path $vsRoot 'Common7\Tools\VsDevCmd.bat'
    if (-not (Test-Path $vsDevCmd)) { throw "Visual Studio developer command script was not found: $vsDevCmd" }

    $vsEnvironment = cmd.exe /d /s /c "`"$vsDevCmd`" -no_logo -arch=x64 -host_arch=x64 && set"
    if ($LASTEXITCODE -ne 0) { throw 'Failed to initialize the Visual Studio x64 build environment.' }
    foreach ($line in $vsEnvironment) {
        $equalsIndex = $line.IndexOf('=')
        if ($equalsIndex -gt 0) {
            [System.Environment]::SetEnvironmentVariable($line.Substring(0, $equalsIndex), $line.Substring($equalsIndex + 1), 'Process')
        }
    }

    $profileRoot = $env:USERPROFILE.Trim()
    $cargoBin = Join-Path $profileRoot '.cargo\bin'
    if (Test-Path $cargoBin) { $env:PATH = "$cargoBin;$env:PATH" }

    if ($TargetDir) {
        $env:CARGO_TARGET_DIR = [System.IO.Path]::GetFullPath($TargetDir)
    }

    $llvmBin = $LibclangPath
    if (-not $llvmBin) {
        $standardLlvmBin = Join-Path $env:ProgramFiles 'LLVM\bin'
        if (Test-Path (Join-Path $standardLlvmBin 'libclang.dll')) { $llvmBin = $standardLlvmBin }
    }

    $toolPaths = @((Join-Path $env:ProgramFiles 'CMake\bin'))
    if ($llvmBin) {
        if (-not (Test-Path (Join-Path $llvmBin 'libclang.dll'))) {
            throw "libclang.dll was not found in the configured LLVM directory: $llvmBin"
        }
        $env:LIBCLANG_PATH = $llvmBin
        $toolPaths += $llvmBin

        # llvm-ar can append COFF objects to its archive in place; MSVC lib.exe
        # fails with LNK1114 when ring's build script appends its batched objects.
        $llvmAr = Join-Path $llvmBin 'llvm-ar.exe'
        if (Test-Path $llvmAr) { $env:AR = $llvmAr }
    }
    foreach ($toolPath in $toolPaths) {
        if (Test-Path $toolPath) { $env:PATH = "$toolPath;$env:PATH" }
    }

    if (-not $SkipTests) {
        & cargo test --release --manifest-path 'src-tauri/Cargo.toml'
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

        & npm run typecheck
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

        & npm test
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }

    & npm run dist
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    $targetDirectory = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $repoRoot 'src-tauri\target' }
    $bundleDirectory = Join-Path $targetDirectory 'release\bundle\nsis'
    $installer = Get-ChildItem -LiteralPath $bundleDirectory -Filter "*$appVersion*x64-setup.exe" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $installer) { throw "NSIS installer for version $appVersion was not found in $bundleDirectory" }
    if ($installer.Length -lt 2MB) { throw 'Installer is smaller than expected.' }

    $artifactDirectory = Join-Path $repoRoot 'output\windows'
    New-Item -ItemType Directory -Path $artifactDirectory -Force | Out-Null
    $artifactPath = Join-Path $artifactDirectory $installer.Name
    if (Test-Path -LiteralPath $artifactPath) { throw "Installer artifact already exists: $artifactPath" }
    Copy-Item -LiteralPath $installer.FullName -Destination $artifactPath

    Get-Item -LiteralPath $artifactPath | Select-Object FullName, Length
    Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256
}
finally {
    Pop-Location
}
