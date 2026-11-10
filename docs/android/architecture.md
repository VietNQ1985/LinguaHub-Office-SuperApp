# Android Interpreter: architecture and feasibility (Issue #8)

**Status:** architecture decision recorded; Android compilation and device behavior are blocked by missing local tooling/device.
**Updated:** 2026-11-10
**Scope:** Issue #8 only. This PR does not implement interpreter functionality or start Issues #9–#17.

## Decision: two independently released applications

Keep **LinguaHub Office SuperApp for Windows** and **LinguaHub AI Interpreter for Android** as separate applications. Do not convert the Windows product into a cross-platform app. Windows remains at the repository root during this incremental transition; Android will be added as a separate app when the Issue #9 shell is implemented. The two apps must have separate bundle/application IDs, build configuration, install/update/signing flows, app data directories, databases, and release pipelines. They run independently and never require a Windows host or automatically synchronize data.

Shared code is opt-in and limited to platform-neutral contracts and logic after independent Android build/test validation. A shared package must not depend on Windows APIs, Tauri desktop commands, filesystem layout, or app lifecycle. Changes in a shared package require both app suites to pass; Android code is validated on its own before any shared code is adopted. No Android task may change Windows UI or behavior without a separate request.

### Incremental target layout

This is the destination for future work; **Issue #8 does not move existing files**. Preserve root paths and Windows configuration until a separately reviewed migration is proposed.

```text
LinguaHub-Office-SuperApp/
├── src/                         # Current Windows React app; stays here for now
├── src-tauri/                   # Current Windows Tauri/Rust app; stays here for now
├── apps/
│   ├── windows/                 # Optional later move, only after migration plan/review
│   └── android/
│       ├── package.json         # Independent scripts/dependencies
│       ├── src/                 # Focused interpreter UI
│       └── src-tauri/           # Separate Tauri config, Rust crate, Kotlin plugin
├── packages/
│   ├── shared-types/            # DTOs, provider/STT/TTS/store contracts
│   ├── translation-core/        # Locale-aware policy, glossary, pure translation logic
│   ├── conversation-core/       # Turn state, ephemeral session rules, no OS APIs
│   ├── ai-core/                 # Provider interfaces/request validation; no client secrets
│   └── ui-shared/               # Optional accessible primitives, not desktop layouts
└── docs/
    ├── windows/
    └── android/
```

Dependency direction: each app depends on shared packages; shared packages never depend on either app. Keep package boundaries meaningful and small. Do not symlink Windows `src-tauri` modules into Android. Initially, copy/port only reviewed pure algorithms with tests; extract a package only when both apps have a demonstrated need.

```text
apps/windows ──┐
               ├──> packages/{shared-types,translation-core,conversation-core,ai-core}
apps/android ──┘

Windows adapters: WASAPI/WebView2/DPAPI/tray     Android adapters: AudioRecord/TTS/Keystore/lifecycle
```

## Android target architecture

```text
React interpreter screen (push-to-talk, transcript review, translation)
  → narrow typed Tauri commands/events
  → Kotlin Android audio adapter: RECORD_AUDIO prompt, AudioRecord, audio focus
  → bounded in-memory PCM and explicit turn controller
  → STT adapter (choice/benchmark deferred to #11)
  → user-visible cloud disclosure/consent when applicable
  → translation adapter: Gemini first; optional supported OpenAI authorization
  → Android TextToSpeech (availability, stop, replay, route)
```

Use explicit push-to-talk and turn-taking for the MVP. Stop capture while translated speech plays to prevent self-recognition. Keep the voice path independent of optional Codex/Gemini Copilot. Keep transcripts ephemeral unless the user explicitly selects content to save in the later memory scope. Do not write audio/transcripts to logs or analytics. Do not use Ollama.

### Credentials and privacy boundary

- Do not ship shared Gemini/OpenAI API keys in an APK, JS bundle, Rust resources, or Android assets. A distributed client cannot keep a shared secret. Production Gemini use needs a narrowly scoped authenticated token broker or a supported per-user authorization flow; that service/flow is not implemented or approved by this spike.
- Existing provider keys are protected with Windows DPAPI. That storage is Windows-only. Android requires a separately reviewed Android Keystore-backed design or a broker; there is no secret migration or data sync between apps.
- Existing ChatGPT authorization uses desktop PKCE with a loopback callback, registered desktop client, DPAPI token storage, and the Responses API. Do not reuse these assumptions on Android. Verify a supported mobile authorization mechanism and applicable terms before exposing ChatGPT/Codex functionality.
- Ask for microphone permission only when the user starts voice input. Explain on-device/cloud processing before sending any speech-derived text or audio to a provider. Permission denial, revocation, app interruption, cancellation, and errors stop capture and release audio focus/resources.
- The Android UI receives only typed results; do not expose arbitrary shell, filesystem, or network access through IPC.

## Source review and compatibility matrix

Source inspection covered `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs`, `audio.rs`, `stt.rs`, `providers.rs`, `chatgpt.rs`, `secrets.rs`, `workspace.rs`, the active command handler, React voice/playback/meeting components, and `src/shared/translation-policy.ts`.

| Existing component/dependency | Evidence in current app | Android treatment |
|---|---|---|
| Tauri 2.12 core | Root config has Windows bundle ID `com.linguahub.office.superapp`; desktop shell creates a main window and child service webviews. | Tauri supports Android, but use an independent Android config and minimal shell. This repository/crate has not been cross-compiled. Separate package/app ID required. |
| `tauri` features `unstable`, `tray-icon`, `image-ico` | Declared together in root `Cargo.toml`; `lib.rs` uses child webviews and tray APIs. | Child-webview workspace/tray-centric app behavior is not part of Android interpreter. Remove from Android dependency/features only after minimal-shell build proves the selected core configuration; keep Windows manifest unchanged. |
| `tauri-plugin-single-instance` | Initialized in `lib.rs` as desktop behavior. | Official Tauri plugin support table does not list Android support. Exclude from Android. |
| `tauri-plugin-window-state` | Initialized for desktop window geometry. | Desktop window geometry is irrelevant to a phone; official table does not list Android. Exclude. |
| `tauri-plugin-global-shortcut` | Root dependency; F11 global shortcut code. | Official table does not list Android support. Exclude. |
| `tauri-plugin-opener` | Used for external URLs/files. | Official plugin table lists Android support; still validate the exact calls/permissions needed by interpreter. |
| `tauri-plugin-clipboard-manager` | Used by desktop command handler. | Official table lists Android support; optional. Verify clipboard behavior with Android build before use. |
| `tauri-plugin-notification` | Used by desktop notifications; custom Windows toast implementation also exists. | Official table lists notification support for Windows, not Android. Exclude from minimum interpreter shell unless plugin support is separately verified. Native Android notification handling is out of #8. |
| `webview2-com`, `windows`, `windows-core` | Windows-only Cargo target dependencies. | Windows crates/APIs must not be Android dependencies. Keep target-specific and out of the Android crate. |
| `audio.rs` / `cpal` | Code asks CPAL for default output and opens an input stream for system-output caption loopback; current comments/platform behavior identify WASAPI loopback. This is not a phone microphone interpreter. | Do not port the loopback feature. Use Android `AudioRecord` through a Kotlin/mobile plugin. `cpal` may have other platform backends, but this implementation and audio source are not evidence of Android mic support. |
| `whisper-rs` 0.16 / whisper.cpp | Existing Rust STT with downloadable PhoWhisper/Whisper GGML models; Windows build currently documents CMake/LLVM. | Exact Android crate/native build, NDK, model ABI, memory, battery, latency and distribution are unverified. Treat as a high-risk candidate; keep behind `Stt` contract and benchmark in #11. Do not include in minimal shell until verified. |
| `gpu-vulkan`, `gpu-cuda` features | Whisper GPU features in root Cargo manifest. | CUDA feature is not an Android target strategy; Vulkan Android support/build is unverified. Exclude both from first Android spike. |
| `rusqlite` bundled, Tokio, reqwest, serde and pure Rust crates | Present in root Cargo manifest. | Not inherently Windows-only, but Android compile/link, TLS, SQLite and feature compatibility have not been tested for the current dependency graph. Add selectively to the Android crate after target build. |
| `providers.rs` Gemini HTTP | API key stored through Windows secret module; explicit cloud consent exists. | Provider request logic can inform a shared adapter, but never ship the Windows key workflow or embedded API key. Broker/per-user auth decision required. |
| `chatgpt.rs` OAuth and Responses API | Loopback callback, desktop client registration, DPAPI token store. | Do not copy unchanged; mobile auth/support is an open gate. Optional conversation assistance must not block speech translation. |
| `secrets.rs` | DPAPI on Windows; non-Windows fallback is not an Android secure store. | Exclude this module from Android; design Keystore/broker path separately. |
| `SpeechPlayback.tsx` | Browser speech synthesis presently selects English voices and shows Windows-specific installation guidance. | Replace for Android with native `TextToSpeech`, language availability checks, stop/replay, and capture mutual exclusion (#13). |
| `VoiceInput.tsx` | Browser `getUserMedia`, Web Audio and Whisper used for Vietnamese dictation in Windows UI. | Useful reference only; does not verify Android runtime permission/lifecycle/focus. Native microphone plugin is required for the intended robust flow. |
| `translation-policy.ts` | Pure TypeScript language detection, batching and cache scope. | Candidate for shared package only after isolated Android unit tests and no desktop imports. |
| Windows workspace, PDF, ERP credential, updater, task/tray code | `workspace.rs`, `pdf_export.rs`, Windows Credential Manager, desktop commands and shell initialization. | Exclude from Android app. Shared ERP glossary/domain terms may be extracted independently; never copy platform-specific credential or shell functions. |

Tauri’s official plugin support matrix is per-plugin and can change; the table above distinguishes documented Android support from unknown dependencies that still need a build. See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), [Tauri plugin support table](https://v2.tauri.app/plugin/), [mobile plugin development](https://v2.tauri.app/develop/plugins/develop-mobile/), and [Android APK distribution](https://v2.tauri.app/distribute/google-play/).

## Android build setup and APK instructions

Tauri’s current guide calls for Android Studio, JDK (`JAVA_HOME`), Android SDK Platform, Platform-Tools, NDK (side-by-side), Build-Tools, Command-line Tools, `ANDROID_HOME`/`NDK_HOME`, and Rust Android targets. It lists Android 7.0/API 24 as the Tauri minimum. Install versions compatible with the pinned Tauri release rather than blindly selecting an old NDK. See the official [prerequisites](https://v2.tauri.app/start/prerequisites/) and [distribution guide](https://v2.tauri.app/distribute/google-play/).

After the separate Android app shell is added (future #9), the expected workflow is:

```powershell
# From apps/android (once created): install JS dependencies using the committed lockfile
npm ci

# Initialize the Android Studio project once, in the Android app only
npm run tauri android init

# Build a debug APK
npm run tauri android build -- --debug --apk

# Install on an attached, authorized device
adb devices -l
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

Exact APK output path/variant must be confirmed from Gradle output for the chosen Tauri CLI version. The command example is a procedure, **not a build result**. Use a unique Android application ID; keep `com.linguahub.office.superapp` and all Windows paths/configuration untouched. Before release, sign Android builds with a separate Android signing key and document independent update/release handling.

## Microphone permission design and device test plan

Android requires `android.permission.RECORD_AUDIO` in the app manifest and runtime user approval (dangerous permission). Request it only after the user presses the interpreter’s microphone control. Before capture, check current permission; on denial explain the disabled feature and offer a route to app settings if permanently denied. Never assume an earlier grant remains valid. Android can provide one-time permission and revoke access; the app must handle permission loss/process restart. See [Android permission overview](https://developer.android.com/guide/topics/permissions/overview) and [request runtime permissions](https://developer.android.com/training/permissions/requesting).

When a device and minimal shell are available, record device make/model, Android/API version, app/commit ID, manifest permission, and result for each case:

1. Fresh install: launch without microphone request; tap PTT and observe Android prompt.
2. Grant permission: capture a short test utterance, stop, confirm UI state and microphone indicator clear, then repeat.
3. Deny once: confirm no capture starts, clear explanation, retry prompt behavior.
4. Deny permanently or revoke in Settings: confirm app stops/does not silently resume and provides settings guidance.
5. One-time grant/backgrounding, activity recreation, screen lock, incoming call/audio-focus loss, and app return: confirm capture stops/restarts only by explicit action and native resources release.
6. Verify transcript/audio are not written to app storage or logs with history disabled. Redact logs/screenshots before attaching to PR.

Android documentation notes emulator microphone recording may be unavailable; use a physical device for actual capture and runtime permission evidence. A generated manifest or successful build alone does not satisfy this test.

## Checks actually performed for this PR

- Source review: completed against the current Windows implementation and configuration.
- Android tool discovery: `adb`, `java`, `cargo`, `rustup`, `gradle`, `npx` and Android SDK environment variables were not discoverable in the current shell; no Android device is attached.
- Build probe: attempted `npx tauri android init` in an isolated worktree. It stopped immediately because `npx` is unavailable. No generated Android project, APK, or permission test resulted.
- `git diff --check`: must be run on the final commit before update (see PR checks).
- Windows build/tests: not run for this documentation-only change. No Windows source/config is changed by this Issue #8 commit. Existing unrelated local Windows edits in the primary checkout were left untouched.

**Feasibility conclusion:** Tauri 2 provides an Android build path in principle, but this repository’s current Windows application has not been shown to build for Android and is not a suitable Android target unchanged. A minimal separate app is plausible; successful Android compilation, plugin selection, microphone permission behavior, Whisper packaging/performance, and end-to-end round trips remain unverified. Do not mark the Android build/device acceptance criteria complete on this evidence.

## Windows protection and integration gates

- Keep the current root `src/`, `src-tauri/`, Windows bundle ID, user data/profile paths, and Windows release process unchanged in this issue.
- Future Android work lives under `apps/android` with its own Tauri identifier, app data, configuration, signing and CI.
- No Windows/Android data synchronization or implicit transcript import.
- Validate Android shell and mic permission behavior independently before proposing shared-package extraction.
- Require Windows typecheck/tests/Rust tests/build on any later PR that changes shared modules or Windows source.
- Keep changes to Issues #9–#17 out of PR #18. Review and merge Issue #8 before starting the next issue.
