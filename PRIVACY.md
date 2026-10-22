# Privacy Notice — EchoClass

EchoClass is a local desktop application. It has no account system, no cloud service, no analytics and no telemetry.

## What is processed

| Data | Where | Why | Retention | Leaves the device |
|---|---|---|---|---|
| Microphone audio | RAM only | Live captions | Milliseconds; discarded after transcription | Never |
| Camera frames | RAM only | ASL fingerspelling A–Z | Milliseconds; one 224×224 frame at a time | Never |
| Recognised signed letters | RAM, then encrypted store only when you confirm | Word building, transcript | Same as the session | Only when you export |
| Transcript text | Encrypted local store | Captions, study notes, export | 7 days by default (configurable: 1/7/30 days or until deleted) | Only when you export |
| Speaker labels | Encrypted local store | Who said what | Same as the session | Excluded from export by default |
| Session metadata | Encrypted local store | Session list, retention | Same as the session | No |
| Consent record | Encrypted local store | Proof of your choices | Until withdrawn / data deleted | No |
| Audit log (metadata only) | Encrypted local store | Start/end/export/delete events | 30 days | No |

Audio is streamed as raw PCM to a `whisper.cpp` server bound to `127.0.0.1` on the same machine. It is not written to disk by the server path. If the one-shot CLI fallback is used, a temporary WAV is written with `0600` permissions and deleted immediately in a `finally` block.

Camera frames exist only while the Fingerspelling page is open and the camera is on. Each frame is centre-cropped and downscaled to 224×224 in the renderer, sent once over IPC, classified by an int8 ONNX model in the main process, and dropped. The app does not write frames, screenshots, or video to disk. The camera stops when you press Stop, open the privacy shield, switch pages, hide the window, or quit. The bundled model is the pinned conversion of `prithivMLmods/Alphabet-Sign-Language-Detection`; it is static ASL fingerspelling, not continuous sign translation.

## What is never collected

- Names, email addresses, student IDs or accounts
- Audio or video recordings
- Location, contacts, clipboard contents
- Analytics, crash reports, advertising identifiers
- Any data from other applications

## Network

The renderer is blocked from all outbound HTTP(S) and WebSocket requests in production. The header shows a live count of blocked requests. The app bundles its UI, fonts, icons and models; there is no CDN and no runtime model download.

Optional **Browser speech (cloud)** mode uses Chromium's speech service and may send audio to a vendor. It is off by default and labelled clearly. Do not enable it for confidential lectures.

## Encryption

Transcripts, settings and consent are encrypted with AES-256-GCM. A random 32-byte key is generated per installation and wrapped by the operating system keychain via Electron `safeStorage` (macOS Keychain, Windows DPAPI, Linux libsecret). If the keychain is unavailable, the key is stored in a `0600` file and the Privacy Center reports "Local key file".

## Your controls

- Pause or stop captions at any time.
- Turn camera access on or off independently in the Privacy Center; stopping the camera also revokes its runtime permission.
- Export one session as Markdown or everything as JSON.
- Delete one session or all data from the Privacy Center.
- Change retention at any time.
- Inspect the exact storage path in the Privacy Center.

Deletion removes records from the encrypted store. It cannot remove copies in OS backups, exported files, or blocks already reclaimed by the SSD controller. This limitation is stated in the app.

## Children and classrooms

EchoClass is intended for classroom use and may process the speech and hand images of minors. The design minimises this risk: no identifiers, no raw audio or video, local processing, short retention. A real deployment should:

- display the classroom notice,
- obtain institutional approval,
- allow students to opt out,
- run a data protection impact assessment where required.

The consent screen records microphone, camera and storage choices with a version and timestamp.

## Legal note

This notice describes engineering behaviour. It is not legal advice. The design follows DPDP Act principles (notice, consent, minimisation, retention limits, security safeguards, deletion rights). Compliance for a specific institution requires its own review.

## Contact

Replace this with your team's security contact before publishing.
