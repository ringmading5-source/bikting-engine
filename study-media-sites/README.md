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
