# Study Media — academic social platform

Private deployment: https://study-media-mading.ringmading60.chatgpt.site

The home is a full-screen, swipe-up lesson feed. This is the Sites / Cloudflare Workers version. The separate `../study-media` folder remains a Node/Render pilot.

## Implemented
- Eight introductory lessons; read, listen and practise with server-scored quizzes.
- One active post per viewport, synchronized narrated steps, optional automatic narration after a user enables voice, search and subject filters.
- Platform sign-in, follows, bookmarks, likes, threaded comments, notifications and feed ordering that prioritizes recorded mistakes.
- Manual lesson authoring and editable AI drafts; Gemini restructures supplied source notes or transcripts into learning objectives, explanations, examples and questions. Drafts require reviewer approval.
- Authenticated image, MP4 and audio uploads to R2; files remain private until their lesson is reviewed and published. Text-note import. Media transcription is not implemented: supply a transcript for AI restructuring.
- Persistent study plans and optional AI planning advice.
- Up to eight members in a study circle: persistent chat, raise-hand messages, chat-based polls, a bounded shared whiteboard, downloadable notes, WebRTC voice/video and targeted signaling. Presence/signaling refresh every three seconds; inactive membership expires after 30 seconds.
- Reviewer queue, content reports, removal, room bans and notifications.
- Optional operator-supplied payment instructions, pending references, reviewer-confirmed access periods and a server-protected study pack. No automatic processing or invented payment details.
- Earlier saved likes/bookmarks, lesson comments and plans are imported once from the previous published prototype. Its original database tables remain intact.

## Runtime configuration
Sites provisions D1 `DB`, R2 `BUCKET` and ChatGPT authentication. Reviewer access matches server-only `REVIEWER_EMAIL` against platform identity; it is configured for the site owner. Keep credentials outside Git.

Set `GEMINI_API_KEY` and `GEMINI_MODEL` to activate AI. Set `ICE_SERVERS_JSON` to short-lived TURN/STUN credentials for cross-network calls. Set `PAYMENT_INSTRUCTIONS` to your real receiving/payment instructions before accepting references. Provider connections and payment receipt must be verified by the operator; test-only provider mocks are not evidence of live AI or payments.

The site remains owner-private. Shared group activity needs additional visitors to be granted access or an explicitly requested public release. Do not change access merely to deploy.

## Local workflow
Node 24 and pnpm:

```sh
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
node --test test/social.test.mjs
pnpm build
pnpm dev
```

Use the generated local Wrangler config to apply committed D1 migrations before testing database features locally. Hosted Sites publication applies pending migrations. Local and hosted data are separate.

## Verification and limits
Backend tests cover identity, source draft privacy/review, reaction idempotence, follow discovery, notifications, quiz scoring/plans, reports, room signaling/bans, media ownership, payment entitlements, missing AI configuration and a mocked AI adapter. Type checks, JS syntax checks and the production build are required before publishing. Browser automation was unavailable; phone layout, actual speech playback, camera/microphone permissions and cross-network calls still need device testing.

This is a pilot. It does not transcribe arbitrary media, scrape social networks, guarantee learning mastery, operate an automatic payment gateway or provide a large-room media server. Added content requires appropriate source rights and academic review. The quiz and feed personalization use observed attempts rather than a claimed validated learner model.

## Phone-first study additions
Private course notes support text-file import or pasted transcripts (up to 120,000 characters), reading and text download. Lessons link back to the uploader's full notes; other learners see the published source excerpt. Note-based AI uses at most five relevant text sections rather than the whole document. Selection is lexical, not a claim of semantic understanding.

Data saver defaults on: attached media loads only after a tap. Larger reading text and per-device resume preferences are available in Study tools. A recall pause appears after five different lessons remain visible for at least four seconds. This is an attention checkpoint, not a certified learning measurement.

Published lessons download as self-contained HTML with explanation, source excerpt, device voice and a local practice question. Downloaded copies need no network; media and account-progress syncing are excluded. Raw notes can download as text. These are explicit user downloads, not an automatic cache of private content.

PDF extraction, OCR for scans, media transcription and offline voice installation are not implemented.

## Course-led social learning
Students can save subjects, a learning goal and daily study minutes. Feed ranking prioritizes their latest incorrect practice answers, selected subjects and useful/not-useful feedback, with a displayed reason. It does not optimize watch time or claim verified mastery.

“Teach me from this” accepts a user-supplied description or transcript and an optional source link. It feeds the existing reviewed AI draft workflow or manual authoring; it does not fetch social-network clips or interpret images automatically. The AI provider key is still required.

Every lesson can open a worked example, server-scored practice and related published lessons. Student explanations are drafts linked to a published parent lesson and require review. Related links identify a shared subject or explicit explanation relationship; they do not imply verified prerequisites.

Finish & recap lists session lessons, observed quiz results and a next study action. Students can download the recap or stop on a clear break screen. Viewing thresholds measure activity, not understanding.

## Paid live tutoring
Tutors submit priced listings with explicit currency, scope and cancellation/refund terms. A reviewer approves the listing and selects the platform fee. No tutors or prices are fabricated. Tutors schedule individual or small-group sessions; human classrooms allow up to seven students plus a teacher. Listings remain empty until real offers are submitted.

Reservations last up to 15 minutes. Students submit a payment reference; only reviewer verification of actual receipt unlocks access. The server checks the booking and time window on classroom and room APIs. Classrooms open ten minutes before start and close at the scheduled end. Tutor cancellation revokes access and creates refund-review requests. Refunded transfers retain both original payment evidence and the separate refund reference.

The AI tutor is clearly labelled software. Its CSS avatar animates while device text-to-speech reads an answer. Typed questions, optional private course notes, a private transcript, session time limits and per-student turn budgets are supported. No photorealistic avatar service, continuous speech recognition or lip-synchronized video is implemented. Gemini credentials are required; absent credentials disable paid AI booking.

After a reviewer verifies a delivered session and its scheduled end has passed, teacher earnings are recorded as gross minus the configured platform fee. These are accounting records. Payout and refund records require confirmation of a transfer actually sent outside the app; the app does not transfer money. Payment instructions must be configured before accepting bookings. AI usage, teacher attendance, mobile permissions and real cross-network calls need production/device validation before a public paid launch. TURN is still required for reliable peer calls.

## Guided knowledge workspace
Each published lesson opens a workspace with source-based text, worked examples, revealable flashcards, a concept SVG, private reflection and selectable text/voice/visual interaction. The tutor follows explicit question → hint → explanation → practice → review transitions. Answers are server-scored; viewing alone does not count as learning. Practice estimates and recall after a 24-hour gap are observations, not validated mastery claims.

Published lesson topics create initial concept nodes. Reviewers can add micro-concepts and source-supported prerequisite, related, application and example links. Recursive SQL rejects prerequisite cycles at insertion time. Other relationships can cycle; no automatic semantic graph extraction is claimed.

Offline workspaces use AES-GCM encryption with a user passphrase derived through PBKDF2. Encrypted copies can be stored in IndexedDB and downloaded as standalone HTML. Reflections remain local in offline copies. No full private notes are included by default. The passphrase is kept only in page memory and cannot be recovered. Supported browsers and downloaded-file voice/crypto behaviour require phone testing.

Unlocked device copies queue practice events and sync on reconnection; downloaded HTML exports a practice file for import in the online app. The server checks account ownership, current lesson revision and answer keys, and deduplicates event IDs. Conflicts stop the import without discarding the source file; already accepted events are safe to retry. The offline website shell is not cached: use a loaded page or the downloaded HTML when starting without connectivity.

Full-duplex audio transport, local speech phoneme models, vector embeddings, arbitrary-code sandboxes, a symbolic algebra engine and a licensed OER ingestion service remain separate unimplemented integrations. Existing voice is device text-to-speech; the current retrieval step selects text sections. The system is a working bounded study prototype, not an evaluated universal knowledge engine.
