import { readFile } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const packageLock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'))
const tauriConfig = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
const cargoToml = await readFile(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8')
const cargoLock = await readFile(new URL('../src-tauri/Cargo.lock', import.meta.url), 'utf8')

const cargoVersion = cargoToml.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1]
const cargoPackageName = cargoToml.match(/^\[package\][\s\S]*?^name\s*=\s*"([^"]+)"/m)?.[1]
const escapedCargoPackageName = cargoPackageName?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const cargoLockVersion = escapedCargoPackageName
  ? cargoLock.match(new RegExp(`\\[\\[package\\]\\]\\s*name\\s*=\\s*"${escapedCargoPackageName}"\\s*version\\s*=\\s*"([^"]+)"`))?.[1]
  : undefined
const versions = {
  'package.json': packageJson.version,
  'package-lock.json': packageLock.packages?.['']?.version,
  'tauri.conf.json': tauriConfig.version,
  'Cargo.toml': cargoVersion,
  'Cargo.lock': cargoLockVersion,
}

const uniqueVersions = new Set(Object.values(versions))
if (uniqueVersions.size !== 1 || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version ?? '')) {
  console.error('Version metadata is missing or inconsistent:')
  for (const [file, version] of Object.entries(versions)) console.error(`  ${file}: ${version ?? '(missing)'}`)
  process.exitCode = 1
} else {
  console.log(`Version metadata synchronized: ${packageJson.version}`)
}
