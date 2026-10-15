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

## Parent/teacher comments and Assembly
Lesson comments include general, parent-feedback and teacher-feedback sections. Users can identify as students, parents or teachers; self-identified roles are labelled explicitly and do not establish guardian-child relationships or grant access to private notes/progress. Reviewed tutors and teachers with approved Assembly posting access receive a corresponding role label. Replies remain in their parent comment's section. Authors and reviewers can remove comments.

Assembly is a shared teacher noticeboard. Teachers request posting access; a reviewer approves or revokes it. Self-identifying as a teacher in comments does not grant announcement privileges. Teachers can publish immediately or schedule future publication, specify a subject and an event/deadline, and withdraw their notices. Scheduled notices are visible only to their author/reviewer before publication. Revoking access also withdraws that teacher's future scheduled notices. Students and parents can filter upcoming or unread notices and mark notices read. The visible board refreshes once per minute; no email or push notification service is connected.

Notices are shared with all users who have site access. The site remains owner-private until access is explicitly expanded. Do not include private student information in notices.

## Teacher prep assignments
Approved Assembly teachers can select Prep / homework when posting. Prep requires a subject, instructions and a due date, and may be scheduled for later publication. Students can filter Assembly to prep, see deadlines and mark their own work done or undo that status. Completion is private, self-reported activity: it is not a submission, teacher marking or a grade. Scheduled and withdrawn notice access rules also apply to prep.

## Company-funded student rewards
The app company can draft campaigns with actual prize descriptions, prize quantities, dates and eligibility/selection/delivery terms. Drafts remain private until the company confirms funding and opens them. No prizes, stock, budgets, campaigns or recipients are fabricated by the app.

Students opt in to a campaign. Public board display is optional and uses a chosen alias; private participants and other students' award/delivery records are not exposed. Self-identified parents, teachers, approved teaching staff and company operators cannot join as student participants.

The fixed participation score is five points for each distinct lesson answered correctly during the campaign after joining, plus one point per active practice day (UTC). Repeating correct answers to a lesson does not generate more lesson points. Offline practice counts when the server receives the sync, not a user-supplied timestamp, and must be synced before campaign close. Scores are participation evidence, not proof of mastery or automatic entitlement to a prize.

Only the company can select recipients after close, following manual eligibility/activity review. Prize allocation is bounded by the announced quantity and prevents duplicate awards to the same student. Selection and actual delivery are separate statuses; delivery requires a real fulfilment reference and company confirmation. The app records fulfilment; it does not purchase, ship or fund prizes automatically.

## School-grounded communities
School managers request spaces; the platform owner reviews the school and manager before opening them. The review is a human approval workflow, not automatic accreditation or identity verification. Approved managers create subject/class spaces and approve or revoke student, teacher and parent membership requests. Membership is unique per user/class; changing a self-declared profile role does not grant class access.

School-wide Assembly is visible to approved members of that school and writable only by its manager. Class Assembly, prep, discussion and shared lesson links require membership of that exact class. Class teachers and managers can set prep; only students mark their own prep done. Parent access is to shared class content only. No private notes, reflections, individual practice records or guardian-child linkage is exposed.

The platform-wide discovery feed, community Assembly, tutoring marketplace and reward campaigns remain separate from private school/class feeds. Site-level access remains owner-private; a real pilot needs both site access and school/class membership approval.

### Interactive learning animations
The feed and guided workspace link the four supported editorial lessons (fractions, forces, mean, cells) to reusable SVG models. All students can also open Learning animations from the sidebar or mobile Study tools and choose a model. Sliders update equal fraction parts, arithmetic mean, constant net force/mass, or highlighted animal-cell structures. Motion is opt-in, with pause, single-step and reset; it stops on close, backgrounding, replacement, or the model track limit. Explanations and prediction prompts remain readable without motion. No AI/video service or per-explanation generation is used. This is a small curated model library; arbitrary uploaded notes do not automatically become animations. Existing pricing/entitlement behavior is unchanged.

### Realistic AI-generated video
Company reviewers can choose **Realistic AI video** beside a saved lesson draft. Describe a scene, authorise a single paid request, check generation progress, preview the private MP4, and review accuracy before attaching it. The lesson then follows the existing publication review. Generated clips are reused by learners, labelled AI-generated in the feed, and respect data-saver tap-to-load. Interactive SVG models remain labelled separately as interactive models.

The server adapter uses Google Veo's asynchronous Gemini API (`predictLongRunning`, documented at https://ai.google.dev/gemini-api/docs/veo). Configure runtime secrets/settings `VIDEO_API_KEY` (funded account with video access), `VIDEO_MODEL` (for example `veo-3.1-generate-preview`; verify availability for your account), and `VIDEO_DAILY_LIMIT` (1–20). There is no default spending allowance and these are not configured in the deployed app. Requests generate one 8-second, 720p, 9:16 clip; provider billing is separate from any student subscription. Set a monetary budget in the provider account too: request count is not a currency cap.

Jobs persist in D1. Global daily request reservations are atomic, duplicate request IDs do not resubmit, and failed/uncertain submissions count toward the limit. Unknown submissions are never retried automatically. Status checks/downloads do not generate another clip. Keep the provider model/key consistent while jobs are pending. Refresh is manual; there is no background worker. Downloads are limited to 20 MB, copied to private R2 storage, with redirect allowlisting and no API key sent to storage hosts. Changed lesson drafts cannot receive a stale generated clip. Students cannot trigger paid generation or access private generation jobs. Generated files remain private until attached to a published lesson. Source text is sent to the provider only when the reviewer authorises a request.

No paid provider or live generation has been exercised; tests use mock transport. This feature prepares and plays generated clips, not instantaneous live video synthesis or a photorealistic conversational avatar.

## Connected learning upgrade (15 October 2026)

The scrolling narrated feed remains the home screen. **Connected learning** (sidebar, mobile ✧, and each lesson) opens four linked workspaces:

- **Live Graph** uses the existing published concepts and reviewed relationships, and adds individual practice counts, reviewed evidence counts, and direct links to study, matching and assessment. Existing graph editing, cycle checks and interactive lesson animations remain available.
- **Socratic Co-op** offers explicitly opted-in concept matching. Availability expires in 30 minutes; invitations expire in 10 minutes. Only the invited learner can accept. Acceptance creates a private two-person circle; other learners cannot list, read or join it. Ordinary public circles remain available. Each circle can run question → explain → challenge → synthesis → complete, with persistent shared reasoning and host stage controls. The configured AI provider can ask a guiding question using the actual session and reasoning notes. The deterministic discussion prompts work without AI. Chat and existing whiteboard/call controls remain available; calls still need usable ICE/TURN configuration.
- **Proof Engine** lets reviewers publish source-revision-bound project and numeric transfer assessments. Numeric answers are checked on the server without returning the answer key in learner listings. A written explanation is required. Submissions remain pending until an independent site reviewer scores reasoning, application and clarity (0–4); approval requires at least 3 in each, plus passing any numeric check. Reviewer self-assessment is blocked. Lesson edits invalidate new submissions and approvals against the previous revision. Portfolios are private; learners can create and revoke sharing links for approved work, withdraw work, and export their own JSON record. Links remain subject to sign-in and the existing Site audience; they do not make the site public.
- **Opportunities** lets the platform reviewer publish real project calls and inspect consented applications containing reviewed work for the required concept. Closing an opportunity stops applications. Withdrawing evidence removes it from application review. This is a platform-mediated project application workflow, not an external employer integration or guaranteed recruitment.

**Learning credits:** derived as 10 per distinct assessment with an approved, non-withdrawn submission. Repeat approvals of the same assessment do not increase credits. Credits have no monetary value, cannot be transferred or redeemed, and do not claim broad mastery, identity verification, accreditation or employment eligibility.

### Start a pilot

1. Open Connected learning → Proof Engine, choose a concept, and use the reviewer action to publish a checked task and rubric. For a numeric mean task, use a genuinely different data set and enter its independently checked expected answer.
2. Add permitted pilot participants through the Site access controls. Each learner signs in, opens a concept, and opts into matching; another opted-in learner must accept an invitation.
3. Have learners submit individual work. Review it from the Proof Engine queue; the owner cannot approve the owner's own submissions.
4. Publish only confirmed project opportunities with accurate organiser details and deadlines. Applications are reviewed inside the platform. No emails or applications are sent to outside organisations automatically.

Migration `0014_complex_cloak.sql` adds the matching, co-op, assessment, evidence and application tables. Keep its Drizzle schema and journal with the source. Run `node --test test/*.test.mjs` to check existing behavior plus identity isolation, hidden answer keys, numeric grading, independent rubric review, revision checks, consent/expiry, private matched circles, revocable sharing, deduplicated credits and concept-matched applications.

Production build and TypeScript checks are run for this upgrade. Browser interaction and visual QA could not run in this execution environment because its supported browser-control capability was unavailable. Real student onboarding, live multi-device calls, funded AI/video use, payment transfers and any institutional licensing remain operational validation steps.
