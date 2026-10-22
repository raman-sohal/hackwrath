# Master Prompt — Desktop Classroom Accessibility Assistant (Privacy-First)

> Companion to `prompt.md`. This version targets a **native desktop application**, replaces the cloud-dependent Web Speech API with **on-device ASR**, and treats **privacy, security and data security as product requirements**, not disclaimers.
>
> **Implementation note (this build).** The shipped app uses a local `whisper.cpp` HTTP server on `127.0.0.1` for ASR, with a bundled-demo fallback. The camera feature is **ASL fingerspelling A–Z**, not a gesture vocabulary or MediaPipe landmarks: the renderer sends one centre-cropped 224×224 RGB frame over IPC; the Electron main process runs an int8 ONNX export of [`prithivMLmods/Alphabet-Sign-Language-Detection`](https://huggingface.co/prithivMLmods/Alphabet-Sign-Language-Detection) with `onnxruntime-node`; frames are never written to disk. See `README.md`, `models/sign/README.md`, and `src/main/sign.ts`. The sections below are the original build brief; where they mention MediaPipe, landmarks, or a gesture vocabulary, the implementation note wins.
>
> Paste the block below into Claude / Cursor / your coding agent. It asks for a complete project, not a single `index.html`.

---

````text
Act as a Principal Desktop Engineer, Accessibility Specialist, and Application Security Engineer.

Build a complete, runnable, privacy-first DESKTOP application: a real-time classroom accessibility assistant for hearing-impaired students. It must work fully offline, process audio and camera frames on-device, and never transmit student data by default.

Do not generate a single index.html. Generate a real project with a main process, a preload bridge, a renderer, a local encrypted store, and packaging config.

## 1. PRODUCT

Primary user: a hearing-impaired student in a classroom.
Secondary user: a lecturer who runs the app on the classroom machine / projector.
Job to be done: "Let me follow the lecture live, ask questions without speaking, and revise afterwards — without my voice, face, or transcript leaving my device."

Core outcomes:
- Live captions with < 1.5 s perceived latency, speaker labels, adjustable size/contrast.
- Isolated ASL fingerspelling recognition from the webcam, running fully on-device.
- Non-verbal classroom tools: quick responses, raise hand, text-to-speech.
- Bookmarks + encrypted session history + explicit export.
- A visible, verifiable privacy posture: offline badge, mic/camera indicators, retention controls, one-click delete.

Non-goals (do not build):
- Cloud accounts, login, sync, analytics, telemetry, crash reporting.
- Continuous sign-language translation. Only a small, honestly-labelled vocabulary.
- Recording raw audio or video to disk by default.
- Mobile apps, browser extension, multi-tenant server.

## 2. STACK (be decisive)

- Electron 31+ with electron-vite (or electron-forge). TypeScript everywhere.
- React 18 + Zustand for renderer state.
- Plain modern CSS with CSS variables. No UI framework that injects remote assets.
- ASR: define an `ASREngine` interface with two implementations:
  a) PRIMARY: `@huggingface/transformers` (Transformers.js) running a Whisper model locally with WebGPU, falling back to WASM. Bundle the model files in the app. No CDN.
  b) FAST PATH (optional): a bundled `whisper.cpp` sidecar binary invoked from the main process, streaming PCM chunks over stdio. If the binary is unavailable, fall back to (a) without crashing.
  Do NOT use `webkitSpeechRecognition` as the default: in Electron it is unreliable and typically sends audio to a cloud service. If you expose it at all, it must be behind an explicit "Use cloud speech (sends audio to vendor)" opt-in, off by default, with a warning.
- VAD: energy-based gate plus optional Silero VAD ONNX, to avoid transcribing silence and to cut latency.
- Fingerspelling: int8 ONNX export of `prithivMLmods/Alphabet-Sign-Language-Detection` (SigLIP2 base, 26 labels A–Z), executed in the main process with `onnxruntime-node`. The renderer centre-crops the webcam to 224×224 RGB, sends one frame at a time over IPC, and discards it. No MediaPipe, no landmark persistence, no frame persistence. Static fingerspelling only — never claim continuous sign-language translation.
- TTS: `window.speechSynthesis` with OS voices, offline. Provide a visible "speak aloud" confirmation because it is audible to the room.
- Storage: local encrypted store. Use Electron `safeStorage` to protect a per-install data key, and AES-256-GCM for records. SQLite (better-sqlite3) is fine; encrypted JSON is acceptable. No plaintext transcripts on disk.
- Packaging: electron-builder targets for macOS (dmg), Windows (nsis), Linux (AppImage). Include mic/camera usage descriptions and hardened runtime notes.
- Tests: Vitest for logic, Playwright for the Electron shell, plus the security acceptance checks in section 9.

## 3. ARCHITECTURE

Main process (Node, trusted):
- Window lifecycle, single-instance lock, menu, global shortcuts.
- Microphone capture via `systemPreferences`/`desktopCapturer` or renderer `getUserMedia` piped as PCM; prefer renderer capture for simplicity, but keep the permission decision in main.
- File dialogs, export, encrypted storage, retention purge, OS keychain via safeStorage.
- Network lockdown: block all outbound requests except loopback; expose a live counter of blocked requests.

Preload (the only bridge):
- `contextBridge.exposeInMainWorld('api', {...})` with a narrow, typed, validated surface:
  sessions.create/append/list/delete/export, settings.get/set, permissions.query, app.getVersion.
- No `ipcRenderer`, `fs`, `path`, `child_process`, or `require` exposure.

Renderer (untrusted, sandboxed):
- React UI, ASR worker, camera preview, transcript rendering, accessibility controls.
- No Node APIs. No remote scripts. No inline event handlers.

Data flow:
  Mic → AudioWorklet → 16 kHz mono PCM → VAD → ASR (local) → segments → encrypted store
  Webcam → centre-crop 224×224 RGB → IPC → int8 ONNX → A–Z prediction → word builder
  Transcript → user-initiated export → sanitized .md/.txt via save dialog

## 4. FUNCTIONAL REQUIREMENTS

F1. Live captions
- Start/stop/pause/resume; clear.
- Streaming partial text, then committed segments with timestamps and confidence.
- Auto-scroll with a "follow" toggle; if the user scrolls up, stop forcing scroll.
- Speaker labels: "Teacher" / "Student" via a manual turn button or VAD-based turn detection. Do not fake diarization you cannot deliver.
- Glossary: user can add up to 50 course terms; bias/repair ASR output with fuzzy matching; show corrected terms with a subtle marker.
- Latency badge showing measured end-to-end delay.
- Font sizes S/M/L/XL; themes: high-contrast yellow-on-black, white-on-dark-blue, and a light theme; line spacing and letter spacing controls.

F2. Fingerspelling / camera mode
- Camera off by default. Separate camera consent plus an explicit "Turn on camera" action with a clear indicator.
- Classify **static ASL fingerspelling A–Z** with the pinned int8 ONNX model. Do not claim full ASL translation, motion understanding, grammar, or continuous signing.
- Show the top prediction, confidence, and top alternatives. Require several stable frames (about 1.5 s) before committing a letter so a single noisy frame cannot insert text.
- Provide a word builder: space, backspace, clear, plus explicit "Add to transcript" and "Speak" actions. The user confirms the word; the model is allowed to be wrong.
- Camera frames are centre-cropped and downscaled to 224×224 RGB in the renderer, classified in the main process, and dropped immediately. No frames, screenshots, video, or embeddings are written to disk.
- Stop the camera and revoke the runtime grant on Stop, page exit, window hide, privacy shield, app quit, or inference failure. Show a graceful fallback when the camera or model is unavailable.
- The signed word is inserted as a `Student` segment only after explicit confirmation.

F3. Classroom tools
- Quick response buttons: "I have a question", "Please slow down", "Can you repeat that?", "Yes", "No", "Thank you".
- A compose box that speaks via TTS after an explicit "Speak" press.
- A large, non-stigmatizing "Raise hand" state visible on the classroom display.
- Optional keyboard shortcuts, documented in-app.

F4. Notes and export
- Bookmark the current moment; bookmarks appear in a side list with timestamps.
- Session list with title, date, duration, segment count, retention countdown.
- Export to .txt or .md through a native save dialog.
- Export options: include/exclude speaker names (default exclude), include timestamps (default on), include bookmarks (default on).
- Filename must not contain student names by default. Sanitize all user-controlled text in the exported Markdown.

F5. Retention and deletion
- Default retention: 7 days. Options: end of session, 24 hours, 7 days, 30 days, keep until deleted.
- Automatic purge on app start and every hour.
- "Delete this session" and "Delete all data" with confirmation. Explain that exported files outside the app are not deleted.
- Show a storage dashboard: number of sessions, bytes used, next purge.

F6. Privacy center (first-class screen)
- Plain-language explanation of what is processed, where, and for how long.
- Live status: microphone on/off, camera on/off, network requests blocked, storage encryption on.
- Consent record: version, timestamp, choices. Re-consent if the policy version changes.
- Data subject actions: view all data, export all data, delete all data.

F7. Accessibility
- WCAG 2.1 AA target: contrast, focus visible, keyboard paths for every action, no keyboard traps, semantic roles, live regions for new captions (polite), reduced-motion support.
- Screen-reader labels for every control, including text alternatives for the camera preview and recognised letter state.
- Captions must not rely on color alone; icons + text for status.
- Works at 200% zoom and on a 1280×720 projector.

F8. Classroom/display mode
- A projector-friendly layout: large captions, minimal chrome, high contrast.
- A compact student layout for a laptop.
- Privacy mode: one shortcut hides the transcript and shows a neutral screen.

## 5. PRIVACY REQUIREMENTS (P)

P1. Local-first: all audio, video, transcripts, and settings stay on the device. Zero network calls in a normal session. Bundle every model, font, icon, and WASM asset. No CDN, no Google Fonts, no remote analytics.
P2. Data minimisation: do not persist raw audio or video. Persist only text segments, timestamps, speaker labels, and bookmark metadata.
P3. Purpose limitation: data is used only for captioning, classroom communication, and the user's own study export.
P4. Consent: first-run, plain-language, screen-reader-accessible consent. Separate toggles for microphone, camera, and storage. Camera off by default. Cloud ASR (if present) is a separate, explicit, off-by-default opt-in.
P5. Transparency: a persistent indicator when the mic or camera is active, plus an event log the user can inspect ("mic started 10:02, stopped 10:41").
P6. Retention: default 7 days; automatic purge; visible countdown; deletion is real (rows and encrypted blobs removed), with a note about OS backups.
P7. Student control: pause, stop, delete, and export are always one click away. No dark patterns. No "are you sure" loops that punish deletion.
P8. Third parties: none by default. If the user opts into cloud ASR, name the vendor, the data sent, the retention policy, and require confirmation every session.
P9. Classroom notice: provide a printable/exportable one-page notice the lecturer can show, explaining what is captured and how to opt out.
P10. No biometric identification: camera frames are used only to classify a static letter, never to identify a person. Do not store frames, embeddings, or templates. State this in the privacy center.
P11. No training on user data. No telemetry, no crash uploads, no "improve the product" checkbox.
P12. Children: assume some students are minors. Do not collect names, emails, or identifiers. Default to anonymous session labels. If an institution requires names, make it an explicit admin choice with a warning.
P13. Export warnings: before export, show what will be included and warn that exported files leave the app's protection.
P14. Data subject rights: view/export/delete all data from the Privacy Center.
P15. Privacy policy and security notes ship as `PRIVACY.md` and `SECURITY.md` in the repo, in plain language.

## 6. SECURITY REQUIREMENTS (S)

S1. Electron hardening: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `nodeIntegrationInWorker: false`, `webSecurity: true`, `allowRunningInsecureContent: false`, `experimentalFeatures: false`.
S2. CSP: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' (or nonce-based); img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' http://127.0.0.1:*; object-src 'none'; frame-ancestors 'none'; base-uri 'none'. No remote origins.
S3. Navigation lockdown: deny `will-navigate`, deny `setWindowOpenHandler`, block `webview`, block `shell.openExternal` for untrusted input, and validate any URL against an allowlist.
S4. IPC: one channel per operation; validate sender frame, argument types, and payload size (zod or hand-written guards). Never pass raw file paths from the renderer. Never expose generic `invoke(channel, ...args)`.
S5. File access: all reads/writes through main-process dialogs and a fixed app-data directory. Prevent path traversal. Sanitize export filenames. Refuse symlinks and non-regular files.
S6. Encryption at rest: AES-256-GCM (or XChaCha20-Poly1305) with a random per-install key wrapped by Electron `safeStorage` (macOS Keychain / Windows DPAPI / Linux libsecret). Never hardcode keys. Never store the key next to the ciphertext in plaintext. Use a fresh IV per record; store the auth tag.
S7. Secrets: no API keys in the renderer. No secrets in the repo. `.env.example` only.
S8. Input handling: render transcripts as text, never `dangerouslySetInnerHTML`. Escape Markdown export. Treat ASR output and filenames as untrusted.
S9. Logging: never log transcript content, audio, or camera data. Redact errors. Keep a metadata-only audit log (session start/stop/export/delete) locally.
S10. Permissions: deny all permission requests by default; allow microphone only while a caption session is active, and camera only on the Fingerspelling page after camera consent. macOS `NSMicrophoneUsageDescription` / `NSCameraUsageDescription`; Windows manifest; Linux portal where applicable.
S11. Resource limits: cap session length and transcript size; cap upload/import sizes; rate-limit IPC; handle a flood of ASR segments without freezing the UI.
S12. Supply chain: pin dependencies with a lockfile; no `postinstall` scripts from unknown packages; run `npm audit`; vendor model files with checksums; document hashes in `SECURITY.md`. No remote code loading.
S13. Updates: disable auto-update for the hackathon build. If enabled later, require code signing and signature verification.
S14. Crash handling: disable Electron crashReporter uploads. Write local crash metadata without content.
S15. Secure defaults: the app must be safe with zero configuration. Every risky capability is opt-in and visibly indicated.

## 7. DATA SECURITY / DATA MODEL (D)

D1. Schema (no raw media):
- sessions(id TEXT PK, title TEXT, started_at INTEGER, ended_at INTEGER, consent_version TEXT, retention_days INTEGER, anonymized INTEGER)
- segments(id TEXT PK, session_id TEXT FK, speaker TEXT, start_ms INTEGER, end_ms INTEGER, text_encrypted BLOB, confidence REAL, is_bookmark INTEGER)
- settings(key TEXT PK, value_encrypted BLOB)
- audit(id TEXT PK, ts INTEGER, event TEXT, metadata_json TEXT)  // no content

D2. Encrypt `text`, transcript exports at rest, and any names. Keep only non-sensitive indexes in plaintext.
D3. Deleting a session cascades to segments and overwrites the ciphertext rows. Document the SSD/backup caveat honestly.
D4. Backups: no automatic cloud backup. If the OS backs up app data, warn the user in the Privacy Center.
D5. Data integrity: verify the GCM tag on read; on failure, do not display partial garbage — mark the record corrupted and offer deletion.
D6. Concurrency: single writer; transactional writes; never leave a half-written segment.
D7. Migration: versioned schema with a safe migration path; never lose data silently.
D8. Export: write via a temp file + atomic rename; set restrictive permissions (0600) where supported.
D9. Memory hygiene: clear PCM buffers after transcription; stop tracks on session end; drop camera frames immediately after classification.
D10. Telemetry: none. A local counter of blocked network requests is allowed and encouraged.
D11. Data inventory: `PRIVACY.md` lists every field, purpose, retention, and storage location.
D12. Incident response: `SECURITY.md` includes how to report a vulnerability, rotate the data key, and delete all data.

## 8. THREAT MODEL (include this table in SECURITY.md)

| ID | Threat | Asset | Control |
|----|--------|-------|---------|
| T1 | Another local user reads transcripts | Transcripts | OS account separation, encryption at rest, auto-lock, retention purge |
| T2 | Network eavesdropping / exfiltration | Audio, text | Offline by default, CSP, request blocking, no telemetry |
| T3 | Malicious dependency or CDN asset | Whole app | Bundled assets, lockfile, audit, checksums, no remote code |
| T4 | Renderer compromise → host access | Device | sandbox, contextIsolation, no nodeIntegration, narrow preload, IPC validation |
| T5 | Shoulder surfing in class | Transcript | Privacy-mode shortcut, projector layout, screen-position controls |
| T6 | Mic/camera left on | Audio/video | Hardware indicators, visible state, auto-stop on session end, max duration |
| T7 | Unauthorized export/sharing | Transcript | Explicit action, anonymize by default, warning, restrictive file permissions |
| T8 | Device loss/theft | All data | Full-disk encryption assumption + app-level encryption; document limits |
| T9 | Retention creep | All data | Default 7 days, automatic purge, visible countdown |
| T10 | Consent bypass / minors' data | All data | First-run consent, per-session toggles, no identifiers, classroom notice |
| T11 | ASR text injection into UI/export | UI, files | Render as text, escape Markdown, sanitize filenames |
| T12 | Model/WASM tampering | Integrity | Vendored files with SHA-256 checksums verified at startup |
| T13 | IPC abuse from a compromised renderer | Files, keys | Per-channel validation, no generic invoke, path allowlist |
| T14 | Denial of service via audio flood | Availability | VAD gating, queue limits, backpressure, UI degradation |

## 9. SECURITY ACCEPTANCE TESTS (must pass)

1. With the app running a full session, a network monitor shows zero external connections. The in-app counter reports blocked requests > 0 when a test fetch is attempted.
2. `window.require`, `window.process`, and `window.module` are `undefined` in the renderer.
3. A test `fetch('https://example.com')` from the renderer is blocked by CSP/network policy and logged as blocked.
4. `strings` over the data file does not reveal any transcript word.
5. Killing the app mid-session leaves no `.wav`, `.webm`, or image files in app data.
6. Deleting a session removes its segments and the ciphertext; a follow-up export of that session fails cleanly.
7. Camera LED/indicator is off unless the Fingerspelling page is actively classifying; stopping the mode releases the track and revokes the runtime grant.
8. The app denies geolocation, notifications, clipboard-read, and MIDI permission requests.
9. A 10,000-character transcript segment renders without executing script; a `<script>` payload appears as literal text.
10. Export filename sanitization strips `../`, NUL, and reserved Windows names.
11. The consent screen is fully operable by keyboard and passes a screen-reader smoke test.
12. The app starts and captions with the network interface disabled (offline test).
13. `npm audit --omit=dev` has no high/critical findings, or each exception is documented.
14. Model/WASM checksums are verified at startup; a corrupted file produces a clear error, not a crash.

## 10. PERFORMANCE BUDGETS

- Caption latency: p95 < 1.5 s from speech to visible text on an M1/16 GB machine.
- ASR real-time factor: < 0.5 with the small model; degrade gracefully to a smaller model.
- UI: 60 fps while scrolling captions; camera sampling runs every 450 ms off the render path; no main-thread jank during transcription.
- Startup: < 3 s to interactive; model load shown with progress.
- Memory: < 700 MB steady state; release model buffers when idle.
- Storage: < 1 MB per hour of captions (text only).

## 11. ERROR / FALLBACK STATES (no dead ends)

- No microphone permission → explain, link to OS settings, offer "type instead" mode.
- No camera → fingerspelling disabled with reason, captions unaffected.
- Model missing/corrupt → checksum error, reinstall guidance, captions disabled but notes usable.
- ASR engine crashes → auto-restart once, then switch to a lower-cost engine, keep the session.
- Disk full → stop persisting, warn, keep in-memory captions, offer export.
- OS sleep/resume → stop capture, require explicit resume to avoid silent recording.
- Low battery → suggest plugging in; do not silently degrade accuracy.

## 12. FILE STRUCTURE (generate all of it)

```
classroom-caption/
  package.json
  electron.vite.config.ts
  tsconfig.json
  electron-builder.yml
  README.md
  PRIVACY.md
  SECURITY.md
  THIRD_PARTY_NOTICES.md
  src/
    main/
      index.ts            # window, permissions, navigation lockdown, CSP
      ipc.ts              # validated handlers
      store.ts            # encrypted storage, retention purge
      sign.ts             # int8 ONNX fingerspelling classifier
      export.ts           # save dialog, sanitization
      network.ts          # request blocking + counter
      checksums.ts
    preload/
      index.ts            # contextBridge, typed API
      api.d.ts
    renderer/
      index.html
      main.tsx
      App.tsx
      styles/theme.css
      state/store.ts
      asr/ASREngine.ts
      asr/transformersEngine.ts
      asr/whisperCppEngine.ts
      asr/vad.ts
      components/
        CaptionStream.tsx
        ControlBar.tsx
        SignView.tsx         # camera consent, 224×224 sampling, word builder
        QuickResponses.tsx
        SessionList.tsx
        PrivacyCenter.tsx
        ConsentDialog.tsx
        StatusIndicators.tsx
        ExportDialog.tsx
      a11y/liveRegion.ts
    shared/
      types.ts
      validation.ts
      constants.ts
  assets/
    models/               # Whisper .bin + sign int8 ONNX, with SHA-256 provenance
    icons/
  tests/
    unit/
    e2e/
    security/
```

## 13. DELIVERABLES

1. All files above, complete and runnable with `npm install && npm run dev`.
2. `README.md`: setup, model download (with checksums), permissions per OS, build commands, demo script.
3. `PRIVACY.md`: data inventory, purposes, retention, third parties (none), rights, contact.
4. `SECURITY.md`: threat model table, controls, key management, vulnerability reporting, known limits (SSD deletion, OS backups, physical access).
5. `THIRD_PARTY_NOTICES.md`: model licences (Whisper, SigLIP2 / Alphabet-Sign-Language-Detection, Apache-2.0) and asset provenance.
6. A seeded demo: 3 synthetic lecture sessions (no real student data), 1 session with bookmarks, 1 exported sample.
7. A `DEMO.md` 90-second script that highlights: live captions, glossary correction, offline mode, fingerspelling, delete-all, network-blocked counter.

## 14. WHAT NOT TO DO

- Do not ship a single HTML file that loads CDNs.
- Do not use cloud speech recognition by default.
- Do not store raw audio or video "for debugging".
- Do not add analytics, Sentry, Google Fonts, or remote icons.
- Do not expose `ipcRenderer` or `fs` to the renderer.
- Do not disable `webSecurity` to "make it work".
- Do not claim continuous sign-language translation.
- Do not put API keys in the renderer or the repo.
- Do not add a login screen, cloud sync, or an admin panel.
- Do not hide the mic/camera state or make deletion hard.

## 15. BUILD ORDER (follow this)

1. Scaffold Electron + React + TS; harden the window and CSP first.
2. Build the permission + consent flow and the privacy center shell.
3. Implement encrypted storage and retention purge.
4. Implement mic capture → VAD → ASR → caption stream with latency badge.
5. Add glossary, bookmarks, session list, export.
6. Add fingerspelling with the pinned int8 ONNX model and no media persistence.
7. Add quick responses + TTS.
8. Run the security acceptance tests, then package and record the demo.

Ask no clarifying questions. Make reasonable choices, state them in README, and produce the complete project.
````

---

## Why this prompt differs from `prompt.md`

| Original (web) | Desktop version |
|---|---|
| Web Speech API (cloud, Chrome-only) | On-device Whisper via Transformers.js / whisper.cpp |
| CDN scripts and models | Everything bundled, checksummed, offline |
| Single `index.html` | Main / preload / renderer separation with a real build |
| Browser storage (implicit, plaintext) | Encrypted local store + OS keychain + retention policy |
| Camera frames handled in-page | Camera off by default, 224×224 frames classified in memory only, never persisted |
| No threat model | STRIDE-style table + 14 security acceptance tests |
| Privacy as a sentence in the pitch | Privacy Center, consent record, export/delete rights, classroom notice |
| No packaging | Signed-ready macOS/Windows/Linux builds |

## Notes before you build

1. **Web Speech API is the trap.** In Electron it is unreliable and, where it works, it ships audio to a vendor. Local Whisper is the correct architectural choice for both privacy and demo reliability.
2. **Model size vs latency.** Start with `whisper-small.en` (or `base.en`) quantized. Measure p95 latency on the demo machine before adding features.
3. **Fingerspelling, not translation.** The shipped model classifies static ASL hand shapes A–Z. It does not understand motion or grammar; require the user to confirm every word, and say so in the UI.
4. **Demo the privacy controls.** The network-blocked counter, delete-all, and offline mode are 20 seconds of the demo that most teams cannot match.
5. **Legal review is not optional for a real deployment.** `PRIVACY.md` is a product artifact, not legal advice.
