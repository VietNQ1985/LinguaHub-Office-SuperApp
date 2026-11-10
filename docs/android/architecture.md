# Android interpreter architecture and feasibility (Issue #8)

**Status:** design and desktop-side feasibility review; Android build and physical-device checks remain unverified.
**Date:** 2026-11-10
**Scope:** Issue #8 only. This document does not implement the Android shell, capture pipeline, STT, translation, TTS, Copilot, or memory work tracked by Issues #9–#17.

## Decision

Keep the existing Windows application as its own Tauri target and add a separately identified Android interpreter target in a later issue. Reuse the React UI primitives and platform-neutral TypeScript policies only after isolating a focused mobile experience. Reuse Rust provider/translation logic only behind explicit portable interfaces and after Android cross-compilation; do not carry over Windows desktop modules or their assumptions.

For the interpreter MVP, use explicit push-to-talk and turn-taking. Proposed flow:

```text
React interpreter screen
  → typed Tauri commands / events (UI is the only privileged webview)
  → Android Kotlin audio adapter (AudioRecord, runtime permission, audio focus)
  → bounded in-memory PCM frames + turn state controller
  → STT adapter (Android recognizer/cloud or separately validated native model)
  → transcript review / explicit cloud disclosure
  → translation provider adapter (Gemini first; optional authorized OpenAI path)
  → Android TextToSpeech
```

The Rust side owns provider selection, request validation, cancellation, translation policy, and any shared pure logic. Native Android owns permission prompts, audio capture/focus/routing, lifecycle integration, and TTS. Copilot is a separate, user-invoked lane and must never gate translation. Conversation history stays ephemeral unless a later opt-in memory issue explicitly saves selected content. No audio or transcript is logged by default. No Ollama is part of this target.

### Trust and credential boundary

- Never ship a shared Gemini/OpenAI API key in the APK, frontend bundle, or native resources. A client-side secret is extractable.
- Gemini calls require explicit provider/data disclosure and a mobile-safe credential design. Prefer a narrowly scoped authenticated token broker with rate limits and abuse controls; alternatively evaluate a supported per-user authorization path. A broker is a separate service and operational/security decision, not implemented here.
- Existing Windows DPAPI storage is not portable. Android should use Android Keystore-backed encryption for user-held tokens, subject to backup and key invalidation behavior.
- Existing ChatGPT sign-in is a native desktop OAuth flow using a loopback callback and a registered desktop client. Do not copy its client registration, loopback assumptions, or token storage to Android. Verify provider-supported mobile authorization and terms before enabling it. “Codex” is not a reason to bypass a supported auth path.
- UI calls are narrow typed IPC operations. Do not expose arbitrary HTTP, filesystem, or shell capabilities to the webview. Keep transcript/audio out of telemetry and redact errors.
- Ask for microphone permission just in time, explain whether speech goes on-device or to a named cloud provider, stop capture on denial/revocation/interruption, and release focus and native resources on every end path.

## Existing code assessment

| Area | Current implementation | Android assessment / proposed boundary |
|---|---|---|
| Tauri shell | Tauri 2.12; one Windows UI plus child service webviews, tray, window-state, global shortcut, single-instance plugins in `src-tauri/src/lib.rs` | Tauri 2 has an Android target, but the current desktop shell is not mobile-ready. The multi-window/webview workspace and tray-centric lifecycle should not be ported to the interpreter. Add a dedicated mobile entry/command set and audit plugin support/version compatibility. |
| React | React 19/Vite; dense Office dashboard and desktop workspace. `MeetingTranslation.tsx` depends on Windows-hosted workspace subtitle extraction, not microphone interpretation. | Reuse language formatting, message primitives, translation policy/cache where they remain platform-neutral. Create a focused responsive interpreter surface; do not route through the desktop meeting-capture feature. |
| Audio capture | `audio.rs` captures system output via CPAL/WASAPI loopback and resamples to 16 kHz. It is not microphone input. Browser `VoiceInput.tsx` uses `getUserMedia` and Web Audio for short Vietnamese dictation. | WASAPI loopback is Windows-specific and captures the wrong source for a two-person phone interpreter. Prefer a native Android adapter using `AudioRecord`, runtime `RECORD_AUDIO`, audio focus, and bounded buffers. Browser microphone capture may prove a prototype but does not alone cover Android routing/focus/lifecycle requirements. |
| STT | `stt.rs` uses `whisper-rs`/whisper.cpp, downloadable PhoWhisper/Whisper GGML models, synchronous transcription. | Model files/algorithm may be reusable, but the present build, native dependencies, ABI, memory, CPU/battery, and model licensing/performance on Android are unverified. Do not assume Windows binaries or `whisper-rs` Android cross-build work. Keep STT pluggable; benchmark alternatives under #11. |
| Gemini | `providers.rs` calls Gemini `generateContent`, supports local DPAPI-protected API key and user consent. | HTTP/provider logic is conceptually portable; key custody and consent model are not. No embedded key. A broker or supported per-user auth needs a decision before runtime use. Translation requests should include explicit direction/locale and bounded context. |
| OpenAI / ChatGPT | `chatgpt.rs` uses PKCE with `127.0.0.1` callback, desktop client registration, DPAPI token storage, Responses API streaming. | Request layer may be reusable only after auth changes. Loopback redirect/client registration/token persistence require mobile review; do not reuse unchanged. Optional provider must not add latency to core voice path. |
| Secrets | `secrets.rs` uses Windows DPAPI; non-Windows implementation does not provide equivalent persisted secret encryption. | Android requires Keystore-backed design (or no persistent client credential); current fallback must not be mistaken for secure mobile storage. |
| Playback | `SpeechPlayback.tsx` uses browser `speechSynthesis`, currently selects English voices and reports Windows voice installation instructions. | Prototype only. Native Android `TextToSpeech` is the target for locale availability, lifecycle, output stop/replay, routing, and microphone mutual exclusion (#13). |
| Shared policy | `src/shared/translation-policy.ts` is pure TypeScript and includes language detection, batching and cache scope. | Candidate for direct reuse with unit tests. Avoid reusing desktop polling/workspace capture as interpreter control. |

## Compatibility matrix

| Component | Windows today | Android disposition | Feasibility |
|---|---|---|---|
| React/Vite UI | Supported | Rebuild as focused mobile view inside Tauri Android WebView | High; device layout/accessibility still to validate |
| Tauri core IPC | Desktop build | Retain command/event boundary; validate Android plugin and permission APIs | Medium-high, pending toolchain build |
| Tauri unstable child webviews / workspace | Central desktop feature | Exclude from interpreter target | Low / unnecessary |
| Tray, global shortcuts, window-state, single-instance | Desktop shell | Exclude or replace with Android lifecycle/navigation | Low / not applicable |
| Rust pure policy/provider code | Host compiled | Reuse selectively after Android target compile and dependency audit | Medium |
| `cpal` WASAPI loopback | Windows system-output capture | Replace with native microphone capture | Not compatible as currently used |
| `whisper-rs` model inference | Windows Whisper/PhoWhisper | Candidate only; cross-compile, model license, ABI, RAM, latency, and battery spike required | Unknown; high risk |
| Browser `getUserMedia` | UI dictation on Windows | Possible prototype fallback; native permission/lifecycle still must be proven | Medium / insufficient as final evidence |
| Gemini HTTP API | Works with user key and Windows storage | API is reachable; credential approach must change | Medium, gated by secure auth/broker decision |
| ChatGPT/Codex OAuth | Desktop loopback + DPAPI | Do not reuse flow unchanged; confirm supported mobile authorization | Unknown / gated |
| Windows DPAPI and Credential Manager | Used for keys/passwords | Replace with Android Keystore-backed strategy; no data migration | Incompatible |
| Browser `speechSynthesis` | OS voice playback | Prototype only; use native Android TTS and explicit locale checks | Medium-high |
| SQLite selective memory | Existing Windows data stores | Separate Android database and opt-in policy; never share Windows profile | Feasible later, out of #8 implementation |

## Build and validation plan

1. Install a supported JDK, Android SDK command-line tools/platform-tools, Android platform/build-tools, and NDK/CMake versions supported by the pinned Tauri 2 release; set `JAVA_HOME` and Android SDK environment variables.
2. Install Rust stable plus `aarch64-linux-android` and (for emulator/CI as needed) `x86_64-linux-android`; verify NDK linker configuration.
3. From a clean feature checkout, run `npx tauri android init` in a disposable worktree/branch, preserving the existing desktop config and bundle identifier. Set a distinct Android application ID. Inspect generated Gradle/plugin versions and manifest.
4. Build the smallest Tauri Android debug APK first. Then compile the existing Rust crate for Android to expose unsupported target dependencies and linker/build-script assumptions. Do not treat a generated project as proof the full app compiles.
5. Gate the full app on target-specific module/plugin split: Windows-only workspace/tray/DPAPI/credential/PDF modules must not enter the mobile build; add the native audio/TTS bridge only in its assigned issues.
6. Install on a physical device and verify launch, first-use microphone prompt, deny, grant, stop/release, revoke in system settings, app background/foreground, incoming audio interruption, and permission state after relaunch. Record Android version/API level, model, build SHA, logs (redacted), and screen recording or screenshots. No device is attached/available in this environment, so these checks are pending.
7. Maintain Windows baseline: `npm run typecheck`, `npm test`, Rust tests, and Windows release build from the current branch before/after any later cross-platform source changes. The current #8 change is documentation only; no baseline test commands were run in this environment.

### Environment observed for this spike

On 2026-11-10, this Windows checkout had no discoverable `adb`, `java`, `cargo`, `rustup`, or `gradle` command, no Android SDK environment variables, and no attached device output. Therefore Android build feasibility is **not validated** and microphone permission behavior is **not device-validated**. Tauri Android viability is an architectural hypothesis supported by the framework's Android target, not a claim that this repository currently builds for Android. Re-run the plan above in a provisioned Android environment before accepting the implementation gate.

## Known limitations / decision gates

- Existing app is a Windows office super-app, not a mobile interpreter; issue #8 does not claim a running Android artifact.
- Android `whisper-rs`/PhoWhisper performance and packaging are unknown. Keep a provider seam and benchmark native Android/cloud STT in #11; disclose cloud transfer and obtain consent.
- Gemini direct API keys cannot be protected inside a distributed APK. A broker or verified per-user auth is required before production use; do not silently reuse the Windows key workflow.
- ChatGPT/Codex mobile authorization is not established by the current Windows integration. Verify supported auth and terms before implementation.
- Android TTS voices vary by installed engine/language packs. The app must report unavailable Vietnamese/English voices and offer install/settings guidance.
- No real device, Android SDK, Android build, microphone prompt, runtime permission, revocation, latency, or audio-focus evidence was available for this spike.

## Windows preservation

No existing app behavior, source, package ID, data directory, WebView profile, or Windows build configuration is modified by this issue. Android must use a separate application ID and app data location. Keep all Windows desktop code under Windows target/configuration and require Windows regression checks in later implementation PRs.
