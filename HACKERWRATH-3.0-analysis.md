# HACKERWRATH 3.0 — Problem Statement Analysis

**Scope:** MVP definition, feasibility, USP/differentiation, risks, demo strategy, and a recommendation for each of the 5 statements.

**Assumed context:** 24–36 hour hackathon, team of 2–4, demo-based judging, mixed technical skill. Where an assumption changes the answer, it is called out.

---

## 0. The most important observation

All five statements are **themes, not specifications**. None of them names a user, a workflow, or a success metric. That is deliberate: judges are testing whether you can convert an open brief into a sharp, defensible product.

The winning move on every one of these is the same:

1. **Pick one user in one situation.** ("A second-year DHH student in a noisy Indian lecture hall", not "the hearing impaired".)
2. **Pick one moment of pain.** ("The 8 seconds after the professor says something important and the student is still reading the previous caption.")
3. **Build the smallest artifact that makes that moment visibly better.**
4. **Measure the delta.** Latency, rupees saved, minutes saved, % routes made safer, WER.

A broad solution that does 20% of everything scores worse than a narrow solution that does one thing at 10x.

### Scoring key used below (1–5, 5 = best)

| Criterion | What it means |
|---|---|
| **Build** | Can a small team ship a believable version in 24–36h? |
| **Demo** | Does it produce a "wow" in 90 seconds without hand-waving? |
| **Diff** | Headroom to be meaningfully different from existing products |
| **Data** | How easy is it to get real (or credible) data/inputs? |
| **Impact** | Size and urgency of the problem |
| **Overall** | Judgment call, not an average |

---

## 1. At-a-glance comparison

| # | Theme | Build | Demo | Diff | Data | Impact | Overall | One-line verdict |
|---|---|---|---|---|---|---|---|---|
| 01 | Security & trust | 4 | 4 | 3 | 3.5 | 5 | **3.9** | Crowded space; wins only with a sharp wedge (voice scams / vernacular) |
| 02 | Emergency navigation | 4 | 5 | 4.5 | 3.5 | 5 | **4.4** | Highest ceiling; simulation is acceptable if labelled honestly |
| 03 | Improve something existing | 5 | 3.5 | 2.5 | 4.5 | 3.5 | **3.8** | Easiest to build, hardest to make judges care; needs a measured delta |
| 04 | Accessibility assistant | 5 | 4.5 | 4 | 4.5 | 5 | **4.6** | Best risk-adjusted pick; classroom-specific wedge beats generic captions |
| 05 | Payments / subscriptions | 3.5 | 4.5 | 4 | 2.5 | 4.5 | **3.8** | Great demo, hard data access; solvable with SMS + email + seeded data |

**Recommendation summary**

- **Highest probability of a polished winning demo:** PS04 (Accessibility).
- **Highest ceiling if the team has geospatial/backend strength:** PS02 (Emergency navigation).
- **Best "product/business" story:** PS05 (Payments), if you solve the data-access question convincingly.
- **Best if the team is ML-heavy and wants a topical angle:** PS01 (Security), via voice/"digital arrest" scam detection.
- **PS03 only with a named incumbent and a number.** Otherwise it collapses into "we made a nicer UI".

---

# PS01 — Digital security and trust

> "Develop innovative solutions to improve digital security and trust, including privacy, fraud prevention, misinformation detection, and identity protection."

## What it is really asking

Four different product categories are hiding in one sentence: **privacy, fraud, misinformation, identity**. You cannot do all four. Pick one lane and go deep. The statement rewards *trust*, which is a human emotion — so the demo must show a person being protected, not a dashboard of risk scores.

## Lane selection

| Lane | Example concept | Build | Demo | Diff | Verdict |
|---|---|---|---|---|---|
| Fraud | Scam message/link checker; voice-scam detector | 4 | 5 | 3.5 | **Best demo, most relatable** |
| Misinformation | WhatsApp forward verifier with evidence | 3.5 | 3.5 | 3.5 | Sexy but accuracy is hard to prove live |
| Privacy | Consent-first data sharing / on-device redaction | 3 | 3 | 4 | Good tech, weak 90-second story |
| Identity | Verifiable credentials / KYC fraud shield | 2.5 | 3 | 3.5 | Too much compliance surface for 36h |

## Recommended concept: "ScamSense" — a vernacular scam firewall with tactic-level explanations

**User:** A 55-year-old parent in a Tier-2 city who receives a WhatsApp forward, a "digital arrest" call, or a fake electricity-bill link.

**Core insight:** Existing tools say *"this looks unsafe"*. Users don't change behaviour because they don't understand *why*. Show the **manipulation tactic** ("urgency + authority impersonation + payment demand + APK install") and the behaviour changes.

**Three input modes (pick 2 for MVP):**
1. Paste/forward a message → verdict + tactic tags + highlighted phrases.
2. Paste a link → domain age, typosquatting, redirect chain, blocklist hit, screenshot of the landing page.
3. Screenshot → OCR → same pipeline.
4. *(Stretch)* Speakerphone call → live transcript → warning within ~5 seconds. This is the "wow" mode.

**Why the voice angle is strong:** "Digital arrest" scams are a live, high-salience Indian problem. A demo where a scripted scam call is flagged in real time — *"This call matches known digital-arrest patterns. No police or CBI officer demands payment over a call."* — is memorable in a way a link scanner is not.

## MVP

**Must have**
- One input path that works flawlessly (start with pasted text; add screenshot OCR only if time).
- A **tactic taxonomy**: urgency, authority impersonation, fear/threat, payment request, OTP/PIN request, APK/screen-share request, too-good-to-be-true, secrecy request.
- Verdict: Safe / Suspicious / Likely scam, with a **confidence** and the exact phrases that triggered it.
- A single recommended action ("Do not install. Call the bank's official number. Report here.").
- A test set of ~100 scams and ~100 benign messages (family chats, bank alerts, delivery notices) to quote precision/recall.

**Should have**
- Hindi/Hinglish support (this is the differentiator; English-only is a toy).
- Link reputation checks (Google Safe Browsing / VirusTotal) with graceful failure.
- "Explain like I'm 60" mode: one sentence, large text, voice output.
- A family guardian: forward the verdict to a trusted contact.

**Won't have**
- Real-time call interception on iOS (impossible without special entitlements).
- A blocklist with network effects (cold-start problem).
- Account/identity verification integrations.

## Architecture and stack

```
Input (text / image / audio)
   → normalization + OCR/ASR
   → feature extraction
        ├─ rules & regex (OTP, UPI ID, APK, +91 patterns)
        ├─ URL intelligence (WHOIS age, redirects, typosquat score, blocklists)
        ├─ embedding similarity to known scam templates
        └─ LLM structured classifier (JSON: verdict, tactics, evidence spans)
   → risk fusion + calibration
   → explanation renderer + action guidance
```

- **Frontend:** Next.js/React, mobile-first, big-type mode.
- **Backend:** FastAPI or Next API routes; SQLite/Postgres for the template library.
- **ML:** Start with an LLM + rules. Fine-tune only if you already have a dataset. A small model is not automatically better and costs days.
- **OCR:** Tesseract or PaddleOCR.
- **ASR (stretch):** Whisper API or Deepgram; browser SpeechRecognition for the demo.
- **Data:** Public scam-advisory text (RBI, CERT-In, bank pages), your own curated examples, translated templates, SMS spam datasets (UCI SMS Spam), and synthetic variants. **Do not scrape private data.**

## Feasibility scorecard

| Dimension | Score | Notes |
|---|---|---|
| Technical | 4/5 | Text + rules + LLM is a day's work; voice adds risk |
| Data | 3.5/5 | Plenty of public scam text; benign messages need care to avoid false positives |
| Demo reliability | 4/5 | Pre-scripted examples guarantee a clean run; live input is a bonus |
| 36h fit | 4/5 | Comfortable if you cut voice; tight if you attempt call interception |

**Hard parts:** calibration (false positives destroy trust), Hinglish/Devanagari handling, and making the explanation specific rather than generic.

## USP — what actually differentiates

Weak (avoid): "AI-powered scam detection." Everyone says this.

Strong angles, pick one:
1. **Tactic-level explanation, not a score.** "Here is the manipulation technique being used on you."
2. **Vernacular + voice-first.** Works on the channel where scams actually happen (calls/WhatsApp), in the language the victim thinks in.
3. **A scam "kill chain" view** that shows the sequence: hook → authority → isolation → payment. Visually distinctive and teachable.
4. **On-device, zero-retention.** The message never leaves the phone. Strong privacy story that also answers the obvious judge question.
5. **Community immunity:** anonymized tactic signatures shared across users, not message content.

Best combination for a hackathon: **1 + 2 + 4**.

## 90-second demo script

1. **0:00** — "My mother got this message yesterday." Show a real-looking electricity-bill SMS with a shortened link. App: **Likely scam**, highlights "disconnection tonight", "pay within 2 hours", tags Urgency + Authority + Payment.
2. **0:20** — Tap "Why?" → tactic cards with plain-language explanations, in Hindi.
3. **0:35** — Switch to a benign message (school fee notice). App says **Safe**, shows why (known sender pattern, no payment link). This proves it is not a yes-machine.
4. **0:50** — Play a 15-second scripted "digital arrest" call. Live transcript appears; warning fires in <5s with the exact tactic chain.
5. **1:10** — Close on the metric: "94% recall on 100 scams, 4% false positives on 100 benign messages, 100% on-device."

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| False positives make it look dumb | Curate the benign test set aggressively; bias toward "Suspicious" when unsure; show evidence |
| LLM latency breaks the live feel | Stream the transcript; show partial verdicts; pre-warm |
| Voice capture is legally/technically messy | Demo via speakerphone + mic, or a simulated call screen. Say "prototype uses speakerphone" |
| "Truecaller/Google already do this" | They detect *numbers/links*, not *tactics in vernacular conversation*. Show a scam that passes both |
| Dataset too small | Rules + template similarity + LLM; report a held-out set, not training accuracy |

## Judge Q&A prep

- **"How do you get users?"** Built into family sharing; partner with banks/telecoms later.
- **"What about privacy?"** On-device inference, no message retention, only anonymized tactic signatures.
- **"Accuracy?"** Quote your held-out numbers and the cost asymmetry (missing a scam is worse than one extra warning).
- **"Why won't Google do this?"** Language long-tail, voice-channel access, and trust/explainability are not their core incentives.

---

# PS02 — Emergency navigation

> "Normal navigation finds the shortest route, but during an emergency that route might be blocked, congested, flooded, or inaccessible."

## What it is really asking

A routing engine that optimizes for **safety and reachability**, not distance or travel time. The hidden requirements are: dynamic hazards, uncertainty, offline operation, and coordination (everyone fleeing at once).

This is the most technically interesting statement and the most visually demoable. It also has the clearest "real product" shape.

## Recommended concept: "SafePass" — risk-aware evacuation routing with load balancing

**Two users, one system:**
1. **Citizen:** "Get me and my family out of this neighbourhood without crossing a flooded road."
2. **Authority:** "Move 5,000 people out without sending them all into the same bottleneck."

Most teams will build only the first. Building the second is the differentiator.

## MVP

**Must have**
- A real city map (Bengaluru or Chennai) with OSM road graph.
- Start/end selection; route rendered with distance, ETA, and a **risk score**.
- A hazard layer you can toggle: flood polygons, blocked roads, congestion, debris.
- **Re-routing when a hazard is injected live** — the core demo moment.
- 2–3 alternative routes ranked by risk, not just time.
- Clear legend: "safe", "caution", "avoid".

**Should have**
- **Evacuation mode:** pick a neighbourhood, simulate N people, assign them across shelters/exits to minimize max congestion (system-optimal assignment).
- **Offline mode:** cached tiles + pre-built graph; demo in airplane mode.
- Shelter list with capacity and distance.
- Vulnerable-user profile (wheelchair, elderly): avoid stairs, steep slopes, unpaved roads.
- Crowdsourced hazard reports with a trust score (photo + timestamp + corroboration).

**Won't have**
- Live government flood sensor integration (rarely available; don't fake it).
- Turn-by-turn voice navigation at production quality.
- Full India coverage (one city, done well).

## Routing design (the part judges will probe)

- **Graph:** OSM extract (Geofabrik) → OSMnx/NetworkX for prototyping, pgRouting/Valhalla for speed.
- **Edge cost:** not just length. Use a weighted cost:
  `cost = time + α·flood_risk + β·blocked + γ·congestion + δ·slope_penalty + ε·road_class_penalty`
- **Risk score:** probability of impassability × consequence. Flood depth, underpass/bridge flags, historical waterlogging points, road width, slope, distance from hazard edge.
- **Alternatives:** Yen's k-shortest paths, then re-rank by risk. Or multi-objective Dijkstra with a Pareto front (time vs risk) — a nice technical talking point.
- **Uncertainty:** hazards have confidence and expiry. A 20-minute-old report should decay. Show "risk is uncertain here" rather than a false precision.
- **Load balancing:** greedy assignment to nearest shelter causes bottlenecks. Use min-cost flow or iterative assignment (MSA) where edge congestion increases with assigned volume. Even a simple version produces a striking visual: "everyone to Exit A" vs "balanced across A/B/C, 40% less max queue".

## Architecture and stack

```
OSM extract → graph build (pre-processed, cached)
Hazard service (polygons + point reports, TTL + confidence)
Routing service (risk-weighted Dijkstra / k-shortest / min-cost flow)
   ↕
MapLibre GL frontend (PMTiles offline, hazard drawing, route comparison)
```

- **Frontend:** React + MapLibre GL JS (or Leaflet for speed). PMTiles for offline tiles.
- **Backend:** Python (FastAPI) with NetworkX for the hackathon; mention Valhalla/pgRouting as the scale path.
- **Data:** OSM, historical flood news/polygons, municipal ward maps, shelter locations (schools, community halls). Label simulated hazards clearly as simulated.
- **Simulation:** a "scenario injector" panel is not a cop-out — it is a feature. Emergency systems are evaluated on scenarios.

## Feasibility scorecard

| Dimension | Score | Notes |
|---|---|---|
| Technical | 4/5 | Graph routing is well-trodden; load balancing is the stretch |
| Data | 3.5/5 | OSM is excellent; live hazard data is not. Simulation is acceptable if honest |
| Demo reliability | 5/5 | Visual, deterministic, controllable |
| 36h fit | 4/5 | One city + 3 scenarios is achievable |

**Hard parts:** graph preprocessing time, snapping user clicks to roads, keeping the map responsive while re-routing, and resisting the urge to cover all of India.

## USP — what actually differentiates

1. **Risk-aware, not time-aware.** Every other map optimizes ETA. You optimize survival/reachability.
2. **System-optimal evacuation.** Coordinate thousands of people, not one. This is a genuine product for disaster authorities and almost nobody builds it at a hackathon.
3. **Offline-first.** Disasters take out networks. A PWA with cached tiles and a local graph that still routes in airplane mode is a killer 15-second demo.
4. **Uncertainty-aware hazards.** Confidence + decay + "we don't know" is more credible than a fake live feed.
5. **Accessibility-aware evacuation.** Wheelchair/elderly routing is an underserved, emotionally strong angle.

Best combination: **1 + 2 + 3**.

## 90-second demo script

1. **0:00** — "In a flood, Google Maps gives you the shortest route. It doesn't know the road is under 3 feet of water." Show a normal route crossing a red flood polygon.
2. **0:15** — Toggle the hazard layer. Route instantly changes, risk score drops, ETA rises by 4 minutes. "We trade 4 minutes for a route that is actually passable."
3. **0:35** — Inject a new blockage (fallen bridge). Live re-route.
4. **0:50** — Switch to Authority view. 1,000 evacuees. "Nearest-exit" assignment creates a 90-minute queue at Exit A. Run balancing → max queue drops to 35 minutes. Visual heat map.
5. **1:10** — Airplane mode. App still routes, still shows shelters. "Because in a disaster, the network is the first thing to fail."
6. **1:20** — Close: "Safe route for one, safe evacuation for everyone."

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| "Your hazard data is fake" | Say it first: "We simulate hazards because live municipal feeds don't exist. The routing engine is the contribution; the data layer is pluggable." Show the adapter interface |
| Map is slow / routing takes 10s | Pre-process the graph, cache routes, use a small bbox, show a spinner with a progress message |
| Demo depends on internet | Pre-cache tiles, local graph, offline mode as a feature |
| Scope creep to multiple cities | One city, three scenarios, polished |
| Load balancing is too complex | Start with greedy + congestion penalty; label it "v0, min-cost flow next" |

## Judge Q&A prep

- **"How is this different from Google Maps incident reporting?"** They report an incident; they don't optimize risk, coordinate evacuation, or work offline.
- **"Where does hazard data come from?"** Pluggable: municipal feeds, IMD rainfall, crowdsourced reports with trust scoring. For the demo, simulated scenarios.
- **"Can it scale?"** Pre-processed graph + Valhalla/pgRouting; routing is per-request, tiles are static.
- **"Who pays?"** Disaster management authorities, smart-city contracts, insurers; citizen app is free.

---

# PS03 — Improve an existing solution

> "Take an existing solution to a problem and make it better in some way... You don't need to invent an entirely new product."

## What it is really asking

This is a **judging trap**. Freedom feels good, but with no anchor, judges default to "why does this exist?" and "the incumbent will just add this." You need three things before writing code:

1. A **named incumbent** and a **specific broken workflow**.
2. A **measurable baseline** you beat on one axis.
3. A credible answer to **"why hasn't the incumbent fixed it?"** (incentive misalignment, long tail, regulation, cost).

## Selection framework

Score candidate ideas 1–5 on:

| Criterion | Question |
|---|---|
| Frequency | Does the target user hit this weekly? |
| Pain | Is it annoying, expensive, or dangerous? |
| Measurability | Can you show a before/after number in 30 seconds? |
| Access | Can you get the data/API in 36h? |
| Incumbent blindness | Is there a structural reason the incumbent ignores it? |
| Demoability | Can a judge feel the improvement without explanation? |

## Concrete candidates

| Idea | Incumbent | Improvement | Metric | Build | Verdict |
|---|---|---|---|---|---|
| **Transit reliability layer** | Google Maps | Live crowding, actual vs scheduled arrivals, last-mile auto fare | ETA error ↓, surprise delays ↓ | 4 | Strong if you have GTFS/vehicle data |
| **Accessible document converter** | Adobe / govt PDFs | One-click WCAG-tagged, screen-reader-friendly PDFs for Indian govt forms | Screen-reader pass rate ↑ | 5 | High feasibility, strong social angle, weak "wow" |
| **College ERP via WhatsApp** | Campus ERP apps | No app install, offline-friendly, proxy-proof attendance | Time-to-task ↓ | 5 | Relatable to judges, but feels small |
| **Waitlist/tatkal optimizer** | IRCTC | Predict confirmation probability, suggest alternate trains/breaks | Prediction accuracy, seats found | 3 | High pain, data access hard, legal grey area |
| **Whisper for Hinglish classrooms** | OpenAI Whisper | Lower latency + code-switch accuracy + glossary | WER ↓, p95 latency ↓ | 4 | Overlaps PS04; good technical story |
| **Open-source contribution** | Any OSS project | A real merged-quality PR + benchmark | Benchmark delta | 4 | Judges love verifiability, but demo is dry |
| **UPI spend clarity** | Walnut/Cred | Actionable subscription audit | ₹ saved/year | 3.5 | Overlaps PS05 |

## Recommended concept: pick the one where you can show a side-by-side in 30 seconds

My default recommendation is the **accessible document converter** or the **transit reliability layer**, depending on team skills:

- **Accessibility converter** ("FormSaathi"): upload a typical Indian government PDF form → get a tagged, fillable, screen-reader-navigable version + a plain-language guide. Demo: blindfolded screen-reader walkthrough of the original (chaos) vs yours (clean). Metric: % of fields with correct labels, tab order, WCAG checks passed. Emotional, feasible, and clearly "better", not "new".
- **Transit layer** ("BetterTransit"): overlay on BMTC/Metro data showing real reliability, crowding, and last-mile options. Metric: ETA error vs Google on 20 trips. Requires transit data; if unavailable, the demo dies.

If the team is strong in ML, improve an existing open-source model and show a benchmark table. If the team is strong in design, improve a government workflow. Avoid "a better UI for X" unless the UI *is* the bottleneck and you can prove it.

## MVP shape (generic, adapt to choice)

- One input, one transformation, one output.
- A **before/after toggle** (the single most important UI element).
- One hard metric computed live or precomputed on a fixed test set.
- A short "why the incumbent won't do this" slide.

## Feasibility scorecard (for the recommended picks)

| Dimension | Score | Notes |
|---|---|---|
| Technical | 5/5 | You are composing existing tools, not inventing |
| Data | 4–4.5/5 | PDFs, GTFS, public docs are accessible |
| Demo reliability | 3.5/5 | Without a crisp before/after, it falls flat |
| 36h fit | 5/5 | Very achievable |
| Differentiation | 2.5/5 | Entirely dependent on the specific target |

## USP

There is no generic USP for PS03. Your USP must be the **specific delta**:

> "The existing tool does X in 12 steps and fails for Y users. We do it in 1 step and here is the measured improvement."

A useful formula: **10x on one axis** (time, cost, accessibility, accuracy), not 10% on five axes.

## Demo script (accessibility converter example)

1. Open a real government PDF. Turn on VoiceOver/Narrator. It reads "image, image, text box, image" — unusable. (15s of pain.)
2. Upload to your tool. Processing bar.
3. Same screen reader now reads "Name, required, edit text. Date of birth, required, date field." Tab order is logical. (15s of relief.)
4. Show the metric: 0/28 fields correctly labelled before, 28/28 after; 6 minutes vs 45 seconds to complete.
5. Close: "100 million Indians use assistive tech. Government forms are the front door to every scheme."

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| "This is just a feature" | Frame as a product with a user, a metric, and a distribution channel |
| Incumbent copies it | Structural reason: low margins, long tail, compliance cost. Say it explicitly |
| Demo is boring | Invest in the before/after contrast; make the judge feel the pain for 15 seconds |
| Legal issues (scraping, IRCTC) | Avoid regulated APIs; use public data; don't automate bookings |

## Judge Q&A prep

- **"Why hasn't this been done?"** Have one sentence ready about incentives/long tail.
- **"What is your metric?"** A number, measured on a fixed set you can show.
- **"Is this a startup or a feature?"** Either is fine — but pick one and defend it.

---

# PS04 — Accessibility assistant for hearing-impaired students

> "Build an accessibility assistant that provides real-time captions or converts sign language to text for hearing-impaired students in classrooms."

## What it is really asking

Two very different technical tracks are offered:

| Track | Difficulty | Demo quality | Recommendation |
|---|---|---|---|
| **Real-time captions** | Moderate | High if latency is low | **Build this** |
| **Sign language → text** | Research-grade for continuous ISL | High if constrained | Stretch only, with honest scope |

Continuous Indian Sign Language recognition needs large labelled datasets, signer independence, and temporal modeling. A hackathon demo will usually be a fingerspelling or 20–50-word isolated classifier. That's fine as an add-on, but it cannot be the core. Do not promise "sign language translation".

## Recommended concept: "EchoClass" — a classroom captioning layer, not another transcription app

**User:** A DHH student in a 60-person lecture hall with a teacher who moves around, a fan, and classmates who ask questions without a mic.

**Why generic caption apps fail here:**
- No speaker attribution — the student can't tell the teacher from a classmate.
- Jargon is mangled ("eigenvalue" → "I can value").
- Latency means the student is always 5 seconds behind.
- Requires internet; campus Wi-Fi is unreliable.
- No post-lecture artifact, so the student can't revise.

That list *is* your product spec.

## MVP

**Must have**
- Teacher opens a web app → room code; students join on phones/laptops.
- **Live captions with <2s perceived latency**, auto-scroll, adjustable font size.
- **Speaker labels**: at minimum "Teacher" vs "Student" via a manual turn-taking button or simple VAD; diarization if time permits.
- **Custom glossary**: teacher pastes 20 course terms/names; ASR is biased toward them.
- **Transcript with timestamps + search** after class.
- **Auto-summary + key terms** (LLM) as a study pack.
- A visible **connection/latency indicator** so failures are graceful.

**Should have**
- Hinglish/code-switching support (huge for Indian classrooms, and a real differentiator).
- **Offline/LAN mode**: teacher's laptop runs a local ASR (whisper.cpp small model) and serves captions over a local hotspot. No internet.
- Student-side "I'm lost" button → teacher sees a subtle indicator (non-stigmatizing).
- High-contrast / dyslexia-friendly themes.
- Export to PDF/DOCX with timestamps.

**Stretch (only if the core is polished)**
- ISL fingerspelling + 50-word isolated classifier via MediaPipe, clearly labelled "limited vocabulary prototype".
- Multi-language translation of captions.

**Won't have**
- Continuous sign language translation.
- Real-time captioning of every student in a large hall with individual mics.
- A hardware product.

## Architecture and stack

```
Teacher device (mic)
  → VAD + chunker (1–2s)
  → ASR (streaming)
      ├─ Cloud: Deepgram / AssemblyAI / Whisper API (best accuracy)
      └─ Local: whisper.cpp (offline demo, lower accuracy)
  → glossary boosting + punctuation
  → speaker label
  → WebSocket fan-out
  → Student PWA (captions, transcript, search)
  → Post-class: LLM summary + key terms + export
```

- **Frontend:** React + Tailwind PWA; WebSocket; IndexedDB for transcript.
- **Backend:** FastAPI/Node; in-memory room state; SQLite for transcripts.
- **ASR choice:** Cloud for the main demo (accuracy wins), local as the "no internet" wow moment. Have both.
- **Diarization:** pyannote is heavy; a manual "next speaker" button is more reliable and honest. Or simple energy-based turn detection.
- **Latency budget:** audio chunk 1s + ASR 0.5–1s + network 0.2s = ~2s. Show a live latency counter — judges love measurable engineering.

## Feasibility scorecard

| Dimension | Score | Notes |
|---|---|---|
| Technical | 5/5 | All components exist and compose cleanly |
| Data | 4.5/5 | No training data needed for captions; glossary is user-provided |
| Demo reliability | 4.5/5 | Can pre-record a lecture; live demo is impressive but risky |
| 36h fit | 5/5 | Core can be built in 8–10 hours |
| Differentiation | 4/5 | Classroom-specific features + offline + Hinglish |

**Hard parts:** latency, ASR hallucination during silence, noisy-room accuracy, and speaker attribution. All are manageable with VAD, a glossary, and honest UI.

## USP — what actually differentiates

Generic captions are a solved commodity (Otter, Google Live Transcribe, Teams). Your wedge is the **classroom**:

1. **Speaker-attributed captions** — who said what, not a wall of text.
2. **Teacher-controlled glossary** — jargon and names are correct from minute one.
3. **Offline/LAN mode** — works when campus Wi-Fi doesn't. This is the single best demo moment.
4. **Hinglish code-switching** — most Indian lectures are not monolingual English.
5. **Post-lecture study pack** — summary, key terms, searchable transcript. Turns a compliance tool into a learning tool.
6. **Privacy by design** — ephemeral audio, no recording stored by default, student-owned transcript.

Best combination: **1 + 2 + 3 + 5**.

## 90-second demo script

1. **0:00** — Play a 10-second noisy lecture clip (teacher + a student question). Captions appear live on a phone. Speaker labels: **Teacher**, **Student**. Latency badge shows 1.4s.
2. **0:20** — Say a jargon-heavy sentence ("the Hamiltonian is non-degenerate"). Glossary makes it correct. Without the glossary, show the mangled version side-by-side.
3. **0:35** — Turn off Wi-Fi. Captions keep flowing via the local model on the laptop. "Campus Wi-Fi is down. The lecture isn't."
4. **0:55** — End the session. Study pack appears: summary, 8 key terms, searchable transcript. Search "non-degenerate" → jumps to the timestamp.
5. **1:10** — Impact: "A DHH student currently pays for a captioner or misses the lecture. This runs on the teacher's laptop and a phone."

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Latency >3s kills the illusion | 1s chunks, streaming ASR, show the latency badge, pre-warm the connection |
| ASR hallucinates in silence | VAD gate; drop low-confidence segments; "…" placeholder |
| Noisy room | Directional mic / phone near teacher; noise suppression; glossary |
| Live demo fails | Pre-recorded lecture clip as fallback; local mode as backup |
| "Otter already does this" | Speaker labels, glossary, offline LAN, Hinglish, study pack — demo each |
| Sign language overpromise | Label it explicitly as a limited-vocabulary prototype, or cut it |

## Judge Q&A prep

- **"How accurate?"** Quote WER on a fixed 5-minute lecture clip, plus latency p95.
- **"Why not just use Otter?"** Classroom-specific attribution, jargon, offline, price, privacy.
- **"How does a student afford this?"** Free for students; institution pays per classroom; runs on existing hardware.
- **"Sign language?"** Be honest: continuous ISL is a research problem; captions are the accessible, deployable core.

---

# PS05 — Payments, subscriptions, EMIs, and bills

> "People manage payments across UPI, cards, subscriptions, EMIs, bills, and other recurring expenses, making it difficult to track where their money is going and avoid missed or unnecessary payments."

## What it is really asking

Two jobs, often conflated:

1. **Sense-making:** "Where did my money go?" (dashboards, categories, insights)
2. **Action:** "Stop me from paying for something I don't need, and don't let me miss something I must pay."

Most existing apps do (1). The statement explicitly includes (2) — *avoid missed or unnecessary payments*. **The action layer is the product.** Build that, not another pie chart.

## The data-access reality (decide this before anything else)

| Source | Feasibility | Notes |
|---|---|---|
| **Bank SMS** | High on Android, zero on iOS | Needs READ_SMS; Play Store restricts it for production, fine for a sideloaded demo |
| **Email receipts** | High | Gmail API with OAuth; test users only, no verification needed for a demo |
| **Bank statement PDF/CSV** | Medium-high | Parsing is messy across banks but doable for 2–3 banks |
| **Account Aggregator (RBI AA)** | Low for a hackathon | Requires FIU registration, compliance, partnerships. Do not claim it |
| **UPI transaction API** | None public | NPCI access is partner-only. Don't build on it |
| **Manual entry** | Trivial | Good fallback, bad demo |

**Recommended data strategy:** Android SMS (live, on-device) + Gmail receipts + seeded historical dataset. Say clearly: "on-device parsing, no credentials, no AA licence needed — AA is the scale path."

## Recommended concept: "Paisa" — a subscription and cashflow copilot

**User:** A 24–35-year-old salaried Indian with 2 cards, 4 UPI apps, 6 subscriptions, 2 EMIs, and no idea why the 3rd of every month feels expensive.

**Core insight:** People don't need better charts. They need **three decisions made for them**:
1. *What should I cancel?*
2. *What's about to hit my account?*
3. *Can I afford this month?*

## MVP

**Must have**
- Ingest: Android SMS + Gmail receipts + CSV upload + manual add.
- **Merchant normalization:** "AMZN", "Amazon Pay", "AMZN Mktp" → Amazon. This is unglamorous and essential.
- **Auto-categorization** (food, transport, bills, subscriptions, EMI, shopping).
- **Recurring detection:** merchant + amount tolerance + cadence (weekly/monthly/quarterly/yearly), with confidence.
- **Upcoming payments calendar** for the next 30 days: bills, EMIs, renewals, card due dates.
- **Unnecessary-payment detection:** duplicate OTTs, unused subscriptions, free trial ending, price hike, silent renewal.
- **One action per insight:** "Cancel", "Remind me", "Not mine" (and learn).
- **Savings counter:** "₹4,800/year identified."

**Should have**
- Pre-debit alert (local notification 2 days before).
- Cashflow forecast to next salary: safe-to-spend number.
- Family/hostel shared expenses and split tracking.
- Credit-card due-date optimizer (avoid late fees, respect billing cycle).
- Explainable insights: "We think this is a duplicate because both charge ~₹149 on the 5th."

**Won't have**
- Actual cancellation via merchant APIs (not available).
- Bank account aggregation/AA integration.
- Investment advice.
- iOS SMS reading (impossible).

## Architecture and stack

```
SMS / Gmail / CSV
  → parser (per-bank templates + regex + LLM fallback)
  → transaction normalization (merchant, amount, date, type, instrument)
  → categorization (rules + embeddings + user corrections)
  → recurring detector (periodicity, amount tolerance, confidence)
  → insight engine (duplicates, hikes, trials, cashflow)
  → UI (timeline, calendar, insights, savings)
```

- **App:** Flutter or native Android (SMS access needed). A web app + Gmail + CSV is the fallback if the team has no Android skill.
- **Storage:** SQLite on-device; optional encrypted sync.
- **Parsing:** per-bank regex for the top 5 banks + LLM fallback for weird formats. Keep a "parse failed" bucket and show it — honesty beats silent errors.
- **Recurring detection:** group by normalized merchant; compute inter-arrival intervals; flag if std-dev is low relative to period; handle monthly date drift (28–31) and amount tolerance (±5%, except EMIs which are fixed).
- **Insights:** heuristic rules first, LLM only for phrasing. Never let an LLM invent a transaction.

## Feasibility scorecard

| Dimension | Score | Notes |
|---|---|---|
| Technical | 3.5/5 | Parsing across banks is the grind; the rest is straightforward |
| Data | 2.5/5 | The binding constraint. Solve with SMS + email + seeded data |
| Demo reliability | 4.5/5 | With seeded data, flawless; with live SMS, impressive but risky |
| 36h fit | 3.5/5 | Parsing + UI + insights is a lot; cut scope aggressively |
| Differentiation | 4/5 | Action layer + India-first parsing + privacy |

**Hard parts:** merchant normalization, recurring detection with noisy data, and the "so what" of insights. Also: don't build 12 screens.

## USP — what actually differentiates

Against Walnut/Cred/INDmoney/your bank app:

1. **Action, not analytics.** Every insight ends in a button that saves money or prevents a miss.
2. **Subscription audit with a rupee number.** "You're paying for 3 OTTs; you used one." Quantified waste is the demo.
3. **Pre-debit intelligence.** Warn before the money leaves, not after. Includes free-trial expiry and silent price hikes.
4. **On-device, no credentials, no AA licence.** Privacy is both a story and a regulatory shortcut.
5. **India-first messy-data parsing.** UPI handles, bank SMS variants, Hinglish merchant names — the long tail incumbents handle poorly.
6. **Cashflow, not budget.** "Safe to spend ₹8,200 until the 30th" is more useful than a category pie.

Best combination: **1 + 2 + 3 + 4**.

## 90-second demo script

1. **0:00** — "I have 6 subscriptions and I couldn't tell you what I pay." Import 6 months of SMS (live on an Android phone, or seeded).
2. **0:15** — Timeline builds itself. Categories, merchants normalized. "No manual entry."
3. **0:30** — Insights: **"You pay ₹149 + ₹179 + ₹99 for three OTTs. You watched one last month. Cancel two → save ₹3,336/year."** Big number.
4. **0:45** — Price hike detected: "Your cloud storage went from ₹99 to ₹129 in March. That's a 30% silent increase."
5. **0:55** — 30-day calendar: EMI on the 5th, card due on the 12th, free trial ends on the 18th. "We warn you 2 days before, not after the late fee."
6. **1:10** — Safe-to-spend: "₹8,200 until the 30th." One number, not a dashboard.
7. **1:20** — Privacy: "Everything is parsed on the phone. No account numbers leave the device."

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Can't access real data in the demo | Seed a realistic 6-month dataset; also show live SMS on an Android device |
| Parsing fails on a bank | Support 3–5 banks well; show a graceful "couldn't parse" state; LLM fallback |
| "This is just Walnut" | Demo the action layer and the pre-debit alert; Walnut is retrospective |
| Regulatory questions | On-device, no credentials, no AA; state the scale path clearly |
| Too many screens | Ship 3: Timeline, Insights, Calendar. Nothing else |
| iOS judges ask "what about iPhone?" | Email + CSV import path; be honest about SMS limits |

## Judge Q&A prep

- **"How do you get data at scale?"** Android SMS on-device + email + CSV now; AA partnership later.
- **"Is reading SMS legal?"** On-device, user-granted, no transmission; production would use the default-SMS-app role or AA.
- **"How accurate is recurring detection?"** Quote precision on your seeded set; show confidence per subscription.
- **"Business model?"** Freemium (savings insights free, family/credit tools paid); affiliate revenue on cancellations/switches, disclosed.

---

# 5. Cross-cutting strategy (applies to all five)

## 5.1 How to choose in 10 minutes

Answer these in order and stop at the first "no":

1. **Can we demo the core value in one sentence without explaining the tech?** If no, cut scope.
2. **Do we have (or can we fake convincingly) the data for that demo?** If no, pick another lane.
3. **Can we build the core in 12 hours?** If no, cut features until yes.
4. **Is there one thing we do that the obvious incumbent doesn't?** If no, change the wedge.
5. **Does someone on the team genuinely care about this user?** If no, the pitch will be flat.

## 5.2 The 36-hour plan (adapt per PS)

| Phase | Hours | Output |
|---|---|---|
| Scope lock | 0–2 | One user, one scenario, one metric, one demo script. Write it down |
| Skeleton | 2–6 | End-to-end "happy path" with fake data. It must run |
| Core build | 6–18 | The differentiator only. No auth, no settings, no admin |
| Integration | 18–24 | Real data/API, error states, latency |
| Demo polish | 24–28 | Seed data, backup video, latency badges, big numbers |
| Deck | 28–32 | 8 slides max: problem, user, demo, how, metric, differentiation, roadmap, team |
| Rehearse + buffer | 32–36 | 3 full run-throughs, Q&A prep, charge devices, offline fallback |

## 5.3 Demo checklist

- [ ] Works in airplane mode or with a recorded fallback.
- [ ] Seeded data that tells a story with a **number** (₹ saved, seconds saved, % safer).
- [ ] One "wow" moment in the first 20 seconds.
- [ ] A visible metric (latency badge, savings counter, risk score).
- [ ] No login screen, no empty states, no setup wizard in the demo path.
- [ ] A 90-second script, rehearsed, with a timer.
- [ ] Answers ready for: data source, accuracy, privacy, scale, why now, why you.

## 5.4 Common failure modes

| Failure | Fix |
|---|---|
| Building breadth instead of depth | One workflow, polished |
| Fake "live" data discovered in Q&A | Label simulations; show the adapter interface |
| Accuracy claims without a test set | Build a 100-example held-out set on day one |
| Blockchain/AI bolted on | Only if it is the mechanism, not the marketing |
| Dashboard as product | Every screen must end in an action or a decision |
| Overpromising sign language / call interception | Scope honestly; judges reward candor |
| No backup demo | Record a video at hour 28 |

## 5.5 What judges actually reward

Across most hackathons, the weighting looks roughly like: **problem clarity and impact (25%), execution/technical depth (25%), innovation/differentiation (20%), demo and feasibility (20%), presentation (10%)**. Optimize for the first and fourth — they are the cheapest to improve and the most commonly neglected.

A useful test: after your demo, can a judge explain your product to another judge in one sentence? If not, the pitch is too complex.

---

# 6. Final recommendation

| If your team is… | Pick | Concept |
|---|---|---|
| Balanced, wants the best win probability | **PS04** | EchoClass: classroom captions with speaker labels, glossary, offline LAN mode, study pack |
| Strong backend/geospatial | **PS02** | SafePass: risk-aware routing + system-optimal evacuation + offline mode |
| Strong fintech/data | **PS05** | Paisa: SMS/email ingestion, subscription audit, pre-debit alerts, safe-to-spend |
| Strong ML/security | **PS01** | ScamSense: vernacular tactic-level scam detection with a voice-scam mode |
| Strong design/accessibility, wants low risk | **PS03** | FormSaathi: government PDFs → screen-reader-ready forms, measured before/after |

**If I had to pick one:** **PS04**. It has the best ratio of demo impact to build risk, a clear underserved user, a defensible classroom-specific wedge (speaker labels + glossary + offline), and a metric you can put on screen (latency, WER, comprehension). It also avoids the two traps that sink the others: fake data (PS02/PS05) and crowded categories (PS01/PS03).

**If the team wants the highest ceiling and can accept more risk:** **PS02**. The evacuation load-balancing demo is the single most memorable 15 seconds available across all five statements.

---

*Prepared for HACKERWRATH 3.0. Assumptions: 24–36h build, small team, demo-based judging. Validate all external data/API availability before committing.*

---

# 7. Privacy, security and data security

> Added because every one of these five products handles data people would not want leaked: scam messages, live location during a disaster, lecture audio of minors, bank SMS, and identity attributes. Security is not a slide at the end — it is part of the product and part of the score.

## 7.1 Why this is a scoring criterion, not a footnote

Judges increasingly ask three questions that separate a demo from a product:

1. **"What data leaves the device?"** — If the answer is "everything, to an API", you have built a surveillance tool with a nice UI.
2. **"Who can see a student's transcript / my location / my bank SMS?"** — If you don't know, neither does the user.
3. **"What happens when you delete it?"** — If deletion is a UI illusion, the privacy story collapses.

A credible security posture also **de-risks the demo**: offline-first, on-device processing removes the live-API failure that kills most hackathon presentations. Privacy and reliability point in the same direction.

## 7.2 Regulatory and ethical frame (know the nouns, don't overclaim)

| Framework | What it means for these builds |
|---|---|
| **India DPDP Act, 2023** | Notice + consent, purpose limitation, data minimisation, retention limits, security safeguards, breach notification, and stronger obligations for children's data. Design to these principles; the implementing rules are still maturing, so say "designed to DPDP principles", not "DPDP certified" |
| **GDPR (if relevant)** | Health data and biometric data used for unique identification are special-category (Art. 9). Privacy by design (Art. 25), security of processing (Art. 32), transparency (Art. 13), access/erasure (Arts. 15–17), breach notification (Arts. 33–34) |
| **WCAG 2.1 AA** | Applies to the privacy UI too: consent dialogs, status indicators, and delete flows must be screen-reader and keyboard accessible |
| **Institutional policy / IRB** | A real classroom deployment needs the institution's approval and a student opt-out. A hackathon demo should use synthetic data |
| **Sector rules** | Payments data (PS05) attracts RBI/NPCI expectations; don't claim compliance you don't have |

**Golden rule:** collect the minimum, process it locally, keep it briefly, encrypt it, let the user delete it, and say all of that in plain language.

## 7.3 Universal threat model

**Assets:** raw audio, camera frames, transcripts, location traces, financial transactions, identity attributes, the device itself.

**Adversaries:** another local user, a network eavesdropper, a malicious website/dependency, a curious administrator, a thief, a scammer, and the product team itself (scope creep into analytics).

**Surfaces:** microphone, camera, clipboard, local storage, export files, network calls, OS permissions, third-party SDKs, update channel.

**Five controls that cover most of it:**

1. **Minimise** — don't collect what you don't need; don't persist raw media.
2. **Localise** — process on-device; make network access off by default and visible.
3. **Encrypt** — at rest with an OS-keychain-wrapped key; in transit with TLS if you ever sync.
4. **Expire** — default retention measured in days, automatic purge, real deletion.
5. **Expose** — visible mic/camera/network indicators, a privacy center, and an audit log the user can read.

## 7.4 Controls by layer

| Layer | Minimum for the hackathon | Production path |
|---|---|---|
| **Data** | No raw audio/video stored; text-only transcripts; field-level encryption; 7-day retention | Classification, DLP, per-record keys, key rotation |
| **Device** | OS account separation; app-level encryption; auto-lock; release mic/camera tracks on stop | MDM, remote wipe, attested boot |
| **Application** | Electron hardening (`contextIsolation`, `sandbox`, no `nodeIntegration`), strict CSP, validated IPC, no remote code | Code signing, reproducible builds, penetration test |
| **Network** | Zero outbound requests by default; bundle all models/assets; block and count requests | Optional E2E-encrypted sync with user-held keys |
| **Identity** | Anonymous sessions, no accounts, no names by default | Institutional SSO with role separation |
| **People** | First-run consent, per-session toggles, classroom notice, delete/export rights | DPO, DPIA, breach runbook, staff training |
| **Supply chain** | Lockfile, `npm audit`, vendored models with SHA-256 checksums, no CDN | SBOM, signed artefacts, dependency review |

## 7.5 Per-statement risk map

| PS | Most sensitive data | Top risks | Non-negotiable controls |
|---|---|---|---|
| **01 Security** | The messages/links/calls being checked — often containing OTPs, account numbers, family details | Becoming a new interception channel; sending URLs to reputation APIs leaks browsing; false accusations; storing scam evidence | On-device inference; hash URLs before any reputation lookup; zero message retention; explainable verdicts; explicit "not legal advice" |
| **02 Navigation** | Live location, home address, vulnerability status (wheelchair/elderly), shelter occupancy | Location tracking; authority dashboard over-access; poisoned crowdsourced hazard reports; device theft during evacuation | No account required; location used in memory, not stored; role-based dashboard; report trust scoring + rate limits; offline encrypted cache |
| **03 Improve existing** | Whatever the incumbent touches — documents, transit history, ERP records | Scraping personal data; uploading sensitive PDFs; malicious PDFs with JS; ToS violations | Local processing; strip PDF JavaScript/embedded files; explicit consent per document; respect robots/ToS; delete after conversion |
| **04 Accessibility** | Lecture audio, camera frames, transcripts, presence of a disability, minors | Recording minors without consent; transcript leaks; camera left on; biometric overreach; cloud ASR | Camera off by default; no raw media persisted; encrypted transcripts; 7-day retention; classroom notice; no landmark storage; offline ASR |
| **05 Payments** | Bank SMS (often containing **OTPs**), transactions, EMIs, card dues | Storing OTPs; credential theft; cloud parsing; export leaks; regulatory overreach | Parser **discards OTP messages before storage**; on-device only; no credentials; encrypted local DB; redacted exports; no AA claims |

### Two details that signal real maturity

- **PS05:** A naive SMS parser will happily store "Your OTP is 482913". Build an OTP filter as a first-class rule and mention it in the demo. It is a five-second line that proves you thought about harm, not just features.
- **PS02:** An evacuation app that stores home addresses becomes a target. Keep origin points ephemeral, aggregate the authority dashboard, and never expose individual trajectories.

## 7.6 PS04 deep dive — the build you are actually shipping

If the desktop app is the accessibility assistant (per `prompt.md` / `prompt-desktop.md`), this is the security spec that matters.

### Data inventory

| Data | Where it lives | Retention | Encrypted | Leaves device |
|---|---|---|---|---|
| Microphone audio | RAM only (PCM buffers) | Milliseconds | N/A | Never |
| Camera frames | RAM / GPU texture only | Milliseconds | N/A | Never |
| Hand landmarks | RAM only | Milliseconds | N/A | Never |
| Transcript text | Local store | 7 days default | Yes (AES-256-GCM) | Only on explicit export |
| Speaker labels | Local store | 7 days | Yes | Only on export (off by default) |
| Session metadata | Local store | 7 days | Partially | No |
| Consent record | Local store | Until withdrawn | Yes | No |
| Audit log (metadata only) | Local store | 30 days | Yes | No |
| Exported .md/.txt | User-chosen folder | User-controlled | No (warn) | Yes, by user action |

### Threats specific to a classroom

| Threat | Why it matters | Control |
|---|---|---|
| **Recording minors** | Consent and child-data obligations; reputational risk | First-run consent, per-session indicator, classroom notice, synthetic demo data |
| **Transcript leak** | A transcript reveals disability status and classroom participation | Encryption at rest, OS account isolation, retention purge, anonymised export |
| **Camera left on** | Students feel surveilled; frames could be captured by malware | Off by default, explicit enable, hardware indicator, auto-release on mode exit |
| **Biometric creep** | Hand landmarks could be repurposed to identify students | Never store landmarks or templates; classify and discard; state it in the Privacy Center |
| **Cloud ASR temptation** | Web Speech API / hosted Whisper sends audio off-device | Local ASR by default; cloud only as explicit opt-in with vendor disclosure |
| **Teacher/student power imbalance** | The lecturer controls the machine | Student-visible indicators, pause/delete, no hidden capture, opt-out notice |
| **Shared classroom PC** | Next class can read the previous transcript | Per-OS-user storage, auto-purge, "delete session" on exit, no plaintext cache |
| **Projector shoulder-surfing** | Private notes visible to the room | Privacy-mode hotkey, separate student layout, bookmark panel collapsible |

### Desktop-specific hardening (Electron)

```
BrowserWindow:
  contextIsolation: true
  sandbox: true
  nodeIntegration: false
  nodeIntegrationInWorker: false
  webSecurity: true
  allowRunningInsecureContent: false
  preload: only the narrow contextBridge API
```

- **CSP:** `default-src 'self'`; no remote origins; `object-src 'none'`; `frame-ancestors 'none'`.
- **Navigation:** deny `will-navigate` and `setWindowOpenHandler`; no `<webview>`; no `shell.openExternal` on untrusted input.
- **IPC:** one channel per operation, schema-validated, sender-frame checked, size-capped, no generic `invoke`.
- **Files:** dialogs only; fixed app-data directory; sanitise names; refuse symlinks; atomic writes with `0600`.
- **Keys:** `safeStorage` (Keychain / DPAPI / libsecret) wraps a per-install data key; AES-256-GCM with a fresh IV per record.
- **Network:** block everything except loopback; show a **"blocked requests" counter** in the UI. This is both a control and a demo moment.
- **Logs:** never log transcript content; disable crash uploads; local metadata-only audit.
- **Supply chain:** bundle models and WASM; verify SHA-256 at startup; lockfile; `npm audit`; no CDN.
- **Packaging:** macOS usage strings for mic/camera, hardened runtime, signed builds; no unsigned auto-update.

**If you choose Tauri instead:** you get a smaller attack surface and a capability allowlist, but you take on Rust and `whisper-rs`. Either is defensible; Electron is faster for a 36-hour build, Tauri is the stronger security story. Pick one and say why.

### Privacy UX (the part judges remember)

- A **Privacy Center** screen: what is processed, where, for how long, and a live status row (mic off, camera off, network blocked, encryption on).
- **First-run consent** in plain language, screen-reader accessible, with separate toggles for mic, camera, and storage. No pre-ticked boxes.
- **Persistent indicators** whenever mic or camera is active; no hidden capture.
- **Delete all data** in two clicks, with a clear explanation of what is and isn't deleted (exports, OS backups).
- **Export warning** naming exactly what will be included, with speaker names excluded by default.
- **Classroom notice** template the lecturer can display.

### What to say in the pitch (20 seconds)

> "Audio and video never leave this laptop. There is no cloud, no account, no telemetry — you can watch the network counter stay at zero. Transcripts are encrypted with a key in the OS keychain, expire in seven days by default, and you can delete everything in two clicks. The camera is off unless you turn it on, and we never store hand landmarks."

That paragraph does more for trust than any accuracy number.

## 7.7 Judge Q&A for the security layer

- **"Is this DPDP/GDPR compliant?"** — "Designed to its principles: notice, consent, minimisation, retention limits, encryption, deletion rights. We are not claiming certification; a real deployment needs institutional review."
- **"Where is the data stored?"** — Name the path, the cipher, and the key location. Vague answers lose trust.
- **"What if the laptop is stolen?"** — App-level encryption + OS full-disk encryption; state the limit (unlocked session, backups).
- **"Do you record students?"** — "No raw audio or video is written. Only text, encrypted, seven days, deletable."
- **"Can the teacher see my transcript?"** — In single-machine mode, the machine owner can; that is why the app shows indicators and supports export/delete. Multi-device mode would need role separation.
- **"What about the cloud model?"** — "There isn't one by default. If we add one, it is opt-in per session with vendor disclosure."
- **"How do you handle a breach?"** — `SECURITY.md` with a reporting channel, key rotation, and delete-all.

## 7.8 Red flags that lose points

- "We use the Web Speech API" with no mention that audio goes to a vendor.
- Camera on at startup, or no visible recording indicator.
- Transcripts in `localStorage` / plaintext SQLite / a `.txt` in the app folder.
- Analytics or crash SDKs in a product handling minors' audio.
- A delete button that only hides rows.
- Storing OTPs because the SMS parser was "generic".
- Claiming "end-to-end encrypted" when there is no sync and no key model.
- A privacy policy written for judges, not users.

## 7.9 One-line security posture per statement

- **PS01:** "The scam never leaves your phone, and we keep nothing."
- **PS02:** "We route you without remembering where you started."
- **PS03:** "Your document is converted on your machine and deleted when you close the tab."
- **PS04:** "No audio, no video, no account — just encrypted text you control."
- **PS05:** "Your bank SMS is parsed on-device, OTPs are discarded, and nothing is uploaded."

---

# 8. Desktop application implications (PS04)

If the deliverable is a **desktop** app rather than a web page, four things change:

1. **You can finally do on-device ASR properly.** Electron/Chromium's `SpeechRecognition` is unreliable and typically cloud-backed; a bundled Whisper model (Transformers.js or a `whisper.cpp` sidecar) is both more private and more demo-reliable. This is the single biggest architectural correction to `prompt.md`.
2. **You get real file I/O and a keychain.** Native save dialogs, OS-level encryption keys, and an app-data directory make the privacy story concrete. Use them; don't fall back to `localStorage`.
3. **You own the update and permission surface.** OS mic/camera prompts, code signing, and auto-update become part of the threat model. Disable auto-update for the hackathon; sign if you can.
4. **You can ship an offline demo.** Airplane mode is a feature, not a failure. It is also the most convincing 15 seconds of the presentation.

**Environment note:** this machine currently has Python 3.14 but no Node.js or Rust toolchain. To build the desktop app, install Node 20+ (`brew install node`) for Electron, or Rust + Node for Tauri. The spec in `prompt-desktop.md` is ready to hand to a coding agent once the toolchain is present.

---

*Security sections are engineering guidance, not legal advice. Validate data-protection obligations with your institution before deploying with real students.*
