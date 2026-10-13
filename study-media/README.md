# Study Media

An independent first build of the academic social platform. This folder runs separately from Bikting Engine and does not replace KBM or B-STAE.

## Run

Use **Node 24**. No npm dependencies or build step are needed.

```sh
cd study-media
cp .env.example .env
npm start
```

Open http://localhost:3000. On Windows, copy `.env.example` to `.env` using your file manager. Localhost supports microphone permission. Real multi-user deployment must use HTTPS.

## Included

- Vertical lesson feed with scroll snapping and responsive desktop/mobile navigation.
- Three editorial sample posts covering statistics, economics and management. Counts start at zero; no fake activity.
- Browser text-to-speech with synchronized explanation steps, replay, previous/next steps and readable transcripts. Voice availability and quality depend on the device; no pre-recorded audio or word-level alignment claim.
- Accounts, password hashing, expiring HTTP-only cookie sessions, love/save/follow actions, threaded comments and source-correction requests saved in SQLite.
- Server-scored quiz checks and saved basic study schedules that prioritize lessons with recorded mistakes. Basic planning is explicitly labeled; it is not a validated mastery algorithm.
- Gemini-backed lesson generation from supplied notes, lesson questions and planning advice. AI replies are labeled. Generated lessons require reviewer publication.
- Live circles with persistent chat, raise-hand messages, chat-based poll questions, downloadable discussion notes, a shared ephemeral whiteboard, participant presence and WebRTC voice/video signaling.
- Rooms capped at eight simultaneous members; host/reviewer removal prevents rejoining the room. Existing groups are public to registered members, not private invited groups.
- Optional manually verified study-pack enquiry references. This is **not** automated payment processing, paid access enforcement or proof of money received.

## Setup before public use

### Reviewer access

Set `ADMIN_EMAIL` to your chosen reviewer email and `ADMIN_SETUP_TOKEN` to a long random secret. In registration, expand **Reviewer account setup** and enter the token. Merely using the email does not grant reviewer permissions. No email ownership verification or password recovery is implemented yet; never disclose the setup token. Human review requires someone qualified in the subject.

### AI

Set `GEMINI_API_KEY` and `GEMINI_MODEL` on the server. Pick a currently available model in your provider account. Keys stay server-side and are never sent to the browser or committed. AI requests are bounded to five per account per minute, one in flight at a time, with a timeout and output budget. AI stays disabled when configuration is absent. Provider usage may cost money; no live paid API was called during development tests. Provider transport and response validation are tested with a mock.

Source notes are untrusted data in the generation prompt. Review generated facts, answer keys and source rights before publishing. AI agreement is not verification. Do not publish private uploaded notes without permission.

### Live calls

Use HTTPS and configure `ICE_SERVERS_JSON` with your TURN/STUN provider settings. Without a relay, some users on different networks cannot connect. The built-in signaling is a single-server pilot, and media uses a browser peer mesh. There is no recording, SFU, private invitation system, guaranteed mobile background connection or large-room scalability. A single media mode is chosen per join; leave/rejoin to change it. TURN credentials returned to signed-in room visitors must be short-lived scoped credentials in production, not privileged provider account secrets.

### Hosting

Use the included Dockerfile or Node 24 on a server with a **persistent writable disk**. `DATA_DIR` stores the SQLite database. Back it up and operate one instance; this build does not coordinate presence or sessions across multiple instances. Set `APP_ORIGIN` to the exact HTTPS URL and `COOKIE_SECURE=true`. Reverse proxies must pass cookies and allow Server-Sent Events without buffering. `render.yaml` is a deployment blueprint, not evidence of an existing deployment. Persistent-disk hosting may require a paid plan.

### Commercial launch gap

The source is a first pilot build, not a completed revenue platform. Add verified payments and entitlements, account verification/recovery, fuller content moderation, privacy terms, backups and cross-device call testing before depending on it for sales. `PAYMENT_INSTRUCTIONS` only enables enquiry collection. No actual prices, payment account details or revenue figures are invented.

## Checks

```sh
npm run check
npm test
```

Tests cover accounts/logout, quiz scoring, idempotent reactions, threaded-comment validation, reviewer privileges, private drafts, CSRF origin rejection, static-file boundaries, missing-AI handling, mocked Gemini generation, room membership/presence and host bans, and explicit pending-payment references. No browser-control skill was available in the development environment, so UI rendering, real audio playback and cross-network media were not browser-verified. Those checks remain required on target phones before a public pilot.

## Architecture

`server.mjs`: HTTP API, SQLite, session/permission validation, AI adapter and room event/signaling endpoints.

`public/index.html`, `styles.css`, `app.js`: client navigation, feed, authoring and interactive room UI.

`test/app.test.mjs`: temporary database and HTTP integration tests.

Schema is initialized on first run. Content stays out of the repository; `.env`, `data/`, logs and dependency directories are ignored.
