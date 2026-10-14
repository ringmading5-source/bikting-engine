# Study Media — hosted Sites version

This folder contains the source of the private published app:
https://study-media-mading.ringmading60.chatgpt.site

The separate ../study-media folder is the Node/Render pilot with additional AI and live-call capabilities. This version uses Vinext, Cloudflare Workers, platform sign-in and a D1 database. It is not a direct Render deployment.

## Run locally
Requires Node.js 22.13+ and pnpm. From this folder:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Apply local D1 migrations before using persistent interactions (see the generated Wrangler configuration for its DB binding):

```sh
pnpm exec wrangler d1 migrations apply site-creator-d1 --local --config dist/server/wrangler.json
```

Run `pnpm build` first to generate that production configuration. Local databases are separate from hosted data. Hosted deployment through Sites applies the committed migrations. The `.openai/hosting.json` project ID identifies the existing private Site; do not create another Site when editing it.

## Features
Five starter lessons, device text-to-speech, quizzes, saved likes/bookmarks/completion, comments, shared text rooms refreshing every five seconds, and a saved rule-based study planner. Platform identity protects writes; plans and reactions are scoped to each visitor.

## Current limits
AI lesson generation is not connected. The creator prepares a draft outline. Live audio/video and payments are not implemented in this version. The deployment remains owner-private. Browser UI and real voice playback were not browser-tested.

## Checks
`pnpm exec tsc --noEmit` and the production build passed. SQLite checks verified migrations, duplicate reaction prevention, messages and plan saving.

No secrets, user data, dependencies or generated build output are included.
