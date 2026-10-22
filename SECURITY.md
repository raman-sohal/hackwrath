# Security — EchoClass

## Threat model

| ID | Threat | Asset | Control |
|---|---|---|---|
| T1 | Another local user reads transcripts | Transcripts | OS account separation, AES-256-GCM at rest, key in OS keychain, retention purge |
| T2 | Network exfiltration or eavesdropping | Audio, text | Offline by default, strict CSP, request blocking with a visible counter |
| T3 | Malicious dependency or remote asset | Whole app | Bundled assets, lockfile, `npm audit`, no CDN, no remote code |
| T4 | Renderer compromise → host access | Device | `sandbox`, `contextIsolation`, no `nodeIntegration`, narrow preload, validated IPC |
| T5 | Shoulder surfing in class | Transcript | Privacy shield shortcut, projector layout |
| T6 | Mic left on | Audio | Visible state, hardware indicator, track release on stop/pause, auto-stop on quit |
| T7 | Unauthorised export | Transcript | Explicit action, speaker names excluded by default, `0600` files, warning |
| T8 | Device loss | All data | App-level encryption + OS full-disk encryption; unlocked-session and backup limits documented |
| T9 | Retention creep | All data | 7-day default, purge on start and hourly, visible countdown |
| T10 | Consent bypass / minors' data | All data | First-run consent, per-session toggles, no identifiers, classroom notice |
| T11 | Text injection into UI/export | UI, files | React text rendering, no `dangerouslySetInnerHTML`, Markdown escaping, filename sanitisation |
| T12 | Model/binary tampering | Integrity | Pinned SHA-256 for Whisper and the sign model; local-only model paths; bundled assets |
| T13 | IPC abuse from a compromised renderer | Files, keys | One channel per operation, type/range checks, trusted-sender assertion, no generic invoke, camera-grant check on frames |
| T14 | Audio flood / DoS | Availability | VAD gate, one in-flight transcription, 12-second chunk cap, session limits |
| T15 | Camera left on / silent capture | Camera frames | Off by default, explicit consent, visible indicator, stop on page exit / hide / shield / quit, one in-flight frame, no disk writes |
| T16 | Oversized or malformed frame input | Memory | Exact 224×224×3 length check, one in-flight inference, typed-array check, no image decoder on untrusted data |

## Controls in place

### Electron hardening

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`, `nodeIntegrationInWorker: false`
- `webSecurity: true`, `allowRunningInsecureContent: false`
- Strict CSP with no remote origins in production
- Navigation denied (`will-navigate`), popups denied, `<webview>` blocked
- DevTools disabled in packaged builds

### IPC

- One channel per operation.
- Sender URL must be `file:` or the dev server.
- Types, lengths and numeric ranges validated in the main process.
- No generic `invoke(channel, ...args)` and no filesystem paths from the renderer.

### Data

- AES-256-GCM, 12-byte random IV, 16-byte auth tag, version byte.
- Per-install random key wrapped by `safeStorage`.
- Atomic write: temp file then rename, `0600`.
- Corrupt or tampered data is moved aside, never rendered.
- Retention purge on startup and hourly.
- No raw audio/video persisted. The CLI fallback uses a private temp directory deleted in `finally`.

### Network and media

- All outbound HTTP(S)/WS blocked in production, including loopback. Development only allows the Vite origin. The blocked count is exposed in the UI.
- `whisper-server` binds to `127.0.0.1` only and is killed on quit.
- Permission handler denies everything except microphone/camera after an explicit in-app grant. A runtime grant is refused unless the corresponding stored consent is true.
- Microphone grant is revoked when captions stop.
- Camera is off by default and only starts from the Fingerspelling page after camera consent. The grant is revoked on stop.
- Camera frames are 224×224 RGB bytes over one IPC channel. The main process rejects any other dimensions/length and requires an active camera grant.
- Camera inference is single-flight and never writes frames to disk. The stream stops on page exit, window hide, privacy shield, app quit, or an inference error.
- The sign model is loaded lazily and its SHA-256 is pinned (`22efbe5e…a2045`); a mismatch refuses to load.

### Supply chain

- Lockfile committed.
- No install-time remote code in the app.
- Model is fetched by an explicit script, not at runtime.
- The Whisper model is pinned to SHA-256 `921e4cf8…b1f`; the app refuses to load a mismatched file, and `npm run fetch-model` verifies it after download.
- The sign model is pinned to SHA-256 `22efbe5e…a2045` and produced by the reproducible `scripts/convert-sign-model.py` from a pinned Hugging Face revision.
- `onnxruntime-node` is a production dependency with only the current platform's native binary packaged; its `.node` and dylibs are unpacked from the asar.
- `npm audit` recommended in CI.

## Known limitations

- **No code signing** in this build. Distribution should sign and notarise.
- **No auto-update.** If added later, it must verify signatures.
- **Local attacker with your unlocked OS account** can read the app data while it is running. Full-disk encryption and screen lock are required.
- **OS backups** may retain encrypted data after deletion.
- **SSD secure erase** is not guaranteed by deleting files.
- **Browser speech mode** is cloud-backed and must not be used for confidential content.
- **whisper.cpp and ONNX Runtime are native dependencies**; their attack surface is inherited. Keep them updated.
- **Fingerspelling accuracy is limited.** The model is a static A–Z image classifier, not a sign-language translator. Low-confidence or similar hand shapes can be misread; the user confirms the word before insertion.
- **Not penetration-tested.** Treat this as a hardened prototype, not a certified product.

## Reporting

Replace this with a real security contact before publishing. Please do not open a public issue for a vulnerability.

## Verification checklist

- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes (crypto tamper/wrong-key tests).
- [ ] Full session with network disabled.
- [ ] `strings` on `store.bin` reveals no transcript text.
- [ ] `window.require`, `window.process`, `window.module` are `undefined`.
- [ ] Delete session, then attempt to open/export it.
- [ ] Camera/mic indicator off when not capturing; camera stops on shield, page switch and window hide.
- [ ] `node tests/e2e/sign.mjs` passes: 26 labels, ONNX inference, consent gate, transcript insert, no raw media files.
- [ ] Packaged app loads ONNX Runtime from `app.asar.unpacked` and classifies a synthetic frame.
- [ ] CSP blocks an injected remote script.
- [ ] `npm audit --omit=dev` has no high/critical findings.
