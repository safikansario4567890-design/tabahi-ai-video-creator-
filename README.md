# TABHI AI

**Create. Edit. Publish.** TABHI AI is a browser-based video editor with optional provider-powered AI video generation. Local editing runs in your browser. AI generation is disabled until the site operator configures a server-side provider; no paid provider is selected automatically.

## Features

- Preview a local MP4, WebM, or MOV and choose 5–50 second presets or a custom MM:SS range (25 seconds by default). Selections are clamped to the source duration.
- Export portrait 9:16, square, or landscape video using center-crop or fit-with-blurred-background framing.
- Choose Standard, High, or Maximum H.264 quality. Output resolution is source-aware, capped at 1280, 1920, or 2560 pixels on the long edge respectively, and never upscales a lower-resolution source.
- Add a styled text overlay, choose its position and timing, and preview simple entrance animations.
- Import a direct, browser-readable MP4, WebM, MOV, or M4V URL. It enters the same local editor pipeline as a chosen, dropped, or AI-generated video.
- Generate text-to-video or image-to-video clips through an explicitly configured provider. Image and prompt inputs are sent only after Generate is pressed.
- Review, preview, download, edit, or delete generated clips in a browser-local IndexedDB history.
- Add a local audio track, set its volume, and optionally fade its beginning or end.
- Draft and edit titles, descriptions, and hashtags with an offline, template-based generator.
- Install the editor shell as a PWA. Local editing UI and the editor remain available offline after the first visit; AI generation and first-time FFmpeg loading need internet access.

## Local setup

Install Node.js 20 or newer and Vercel CLI, then run `npm install` and `npm run dev` from this project folder. Create an Upstash Redis database. Copy `.env.example` to `.env.local`; set the Upstash REST URL/token and a random `TABHI_SESSION_SECRET` of at least 32 characters. For AI generation, also select a configured server-side provider. Generate a local session secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Never place provider secrets in HTML or browser JavaScript. Opening `index.html` directly or serving it with a static-only server does not run `/api/video-generation` and cannot generate AI video. FFmpeg is fetched from the pinned public npm CDN only when you export; local source videos and music stay in the browser.

Run `npm run build -- --prod` to create the production build in `.vercel/output`. This creates the deployable artifact; it is not a standalone local web server. Run `npm run dev` to test the full app and serverless API locally. For source-based production deployment, use `npm run deploy` or connect the Git repository to Vercel. To deploy the exact artifact you built locally, link/pull the project once and run `npm run deploy:prebuilt`. The static editor, API route, and headers deploy together. Other static hosts need equivalent serverless-function support, the isolation headers below, and secure environment-variable configuration.

## Browser requirements and FFmpeg.wasm

Use a current desktop version of Chrome, Edge, or Firefox for the most reliable export. The app uses `@ffmpeg/ffmpeg` 0.11.6 and `@ffmpeg/core` 0.11.0 browser builds from unpkg, loaded on demand. FFmpeg.wasm requires `SharedArrayBuffer`; the included `vercel.json` configures cross-origin isolation with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`. The credentialless policy also permits the opt-in YouTube preview without sending third-party cookies. When hosting elsewhere, configure the same headers. Export uses FFmpeg.wasm in your tab; render speed and memory use depend on your device. Keep the tab open while an export runs. Maximum quality can use substantially more memory; if it fails, choose High or Standard. Files over 512 MB are rejected to reduce the risk of exhausting browser memory; smaller files can still exceed a device's available memory.

The browser handles preview and metadata locally. The FFmpeg core is downloaded from unpkg at export time, so offline exports are not available on a first visit. A failed CDN or WASM load is reported in the editor; it does not upload your source file.

## Privacy

TABHI AI does not upload video or audio to a server and does not include analytics or tracking. Local preview uses browser object URLs, which are released when files are replaced or removed. The export renderer reads the selected files into its in-memory virtual filesystem and removes them after the render. Generated metadata uses local JavaScript templates, not a cloud AI service.

## Video Upload and Link Import

Choose **Choose Video File**, drop a video into the import area, or paste a direct video-file URL and press **Load Video**. The browser fetches a CORS-readable copy (up to 512 MB) into local memory and passes it to the existing preview, timeline, trim, text, music, and export tools. Supported formats are MP4, WebM, MOV, and M4V when the browser can read and decode them. The remote host must allow browser cross-origin access; a video-looking URL does not guarantee access.

YouTube, Instagram, Facebook, TikTok, Vimeo, and other webpage links are not direct video files. TABHI AI does not scrape, download, proxy, or bypass platform restrictions. Webpage URLs report: “This link is not a directly playable video URL.” Import platform videos only through a legitimate official API or licensed backend configured by the site operator; none is included by default. A permitted local copy can be imported with Choose Video File.

The separate **Create Shorts from YouTube** field validates YouTube watch, Shorts, embed, live, and `youtu.be` links and loads YouTube's privacy-enhanced embedded player for preview. Playback depends on the video's availability and embedding permissions; **Open on YouTube** is provided as a fallback. Preview is playback only: YouTube's official Data API and embed player do not provide a downloadable source stream for the local editor. If you own the upload, download it using YouTube Studio and import that source file; the existing timeline, trim, 9:16 framing, text, music, and export tools then create the Short. The current AI generator does not analyze source videos, so “Find Best Shorts” suggestions are not available.

## Music licensing

Music is selected from your device and processed locally. The “Find free music” link opens the official YouTube Audio Library. Check the licence, attribution, and publishing requirements for each individual track before using it.

## Vercel deployment

For a first CLI deployment, from this project folder run:

```powershell
npm install
npx vercel login
npx vercel link
npx vercel pull --yes --environment=production
npm run build -- --prod
npm run deploy:prebuilt
```

For local end-to-end testing, configure required provider variables in `.env.local`, then run `npm run dev` and use the URL printed by Vercel CLI. In Vercel Project Settings, add any AI-provider and Upstash/session secrets to the Production environment; never add them to frontend files. Local editing/export does not require an AI provider. The included `vercel.json` configures FFmpeg isolation/security headers and the generation function. FFmpeg libraries are loaded only when export begins, and the YouTube iframe is loaded only after a valid preview request.

## AI Generation Provider

The default `VIDEO_PROVIDER=wan` selects a Wan-compatible asynchronous endpoint, but generation remains disabled until the operator supplies `WAN_VIDEO_API_URL`. This project does not bundle model weights, a GPU worker, or an inference account. Run an authorized Wan 2.1 service or configure a provider/gateway you are permitted to use. Set `VIDEO_PROVIDER_MAX_DURATION` to that service's real limit (default 5 seconds for Wan). The route sends prompt, duration, aspect ratio, and for image mode a JPG/PNG data URL smaller than 1 MB.

The Wan endpoint protocol is `POST /predictions` with `{ "input": { "prompt": "...", "duration": 5, "aspect_ratio": "9:16", "model": "Wan2.1" } }`; image mode also includes `start_image`. Return JSON with `id` and `status`. `GET /predictions/{id}` must return `id`, `status` (`starting`, `processing`, `succeeded`, `failed`, or `canceled`), and on success an `output` URL (or an object with `url`/`video`). The output URL must be HTTPS and on the configured API origin. Optional cancellation uses `POST /predictions/{id}/cancel`. Configure `WAN_VIDEO_API_TOKEN` for bearer authentication. Keep provider secrets server-side.

There is no automatic paid fallback. Replicate is supported only when the operator explicitly sets `VIDEO_PROVIDER=replicate` and configures the server-only `VIDEO_API_KEY`; its default model is Kling v2.1 Master. The app does not charge users, but a paid provider may bill the operator. Review provider pricing and privacy terms before enabling one. Unavailable or misconfigured providers fail closed with “AI generation is temporarily unavailable. Please try again later.”

### Test Generate Video

1. Install Node.js 20+, run `npm install`, and start `npm run dev`. Do not use Python's static `http.server`; it serves the editor but not the API route.
2. Create an Upstash Redis database. Copy `.env.example` to `.env.local`, set `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and a random `TABHI_SESSION_SECRET` of at least 32 characters.
3. For the open-source-first path, set `VIDEO_PROVIDER=wan`, run a Wan 2.1 model behind an HTTP adapter that implements the async `/predictions` contract above, and set `WAN_VIDEO_API_URL` to that adapter's base URL. Set `WAN_VIDEO_MODEL` and `VIDEO_PROVIDER_MAX_DURATION` to values the installed model actually supports. Set `WAN_VIDEO_API_TOKEN` only if that adapter requires bearer authentication. This repo does not include the model, GPU runner, or adapter service.
4. Restart `npm run dev`, open the URL it prints, and check `/api/video-generation?action=config` in the same origin. The JSON must report both `configured: true` and `quotaConfigured: true`. The UI then reports the selected provider; enter a prompt and click Generate video to test the configured service.

The UI disables Generate video until both the provider and Redis-backed quota are configured. If the API is missing, it reports that the Vercel development server is not running; if provider or quota settings are missing, it names the required server-side variables. A paid Replicate test requires explicitly changing `VIDEO_PROVIDER=replicate` and setting `VIDEO_API_KEY`; that can incur operator costs and never happens automatically.

Set `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and a random `TABHI_SESSION_SECRET` (at least 32 characters) for durable quotas. Missing Redis or session configuration disables generation. Same-origin checks are included; public deployments should also configure hosting-level abuse/rate controls. Prompts and optional images are sent to the selected provider only after Generate. Generated videos are returned to the browser and stored in local IndexedDB history.

Upstash's [Redis Free tier](https://upstash.com/pricing/redis) currently lists 256 MB and 500,000 commands/month at $0; limits and terms can change. A Redis database and its REST credentials must be configured by the operator. Vercel function usage and plan limits are separate and may also incur cost.

Upstash and Vercel usage limits or costs are separate from the five-generation allowance. Provider-side data retention is governed by the configured provider's policies; review its terms before sending sensitive content.

## PWA Installation

Deploy over HTTPS, then open TABHI AI in Chrome on Android. Use the browser's **Install app** prompt or menu > **Add to Home screen**. The app opens in standalone mode where supported. The service worker caches only the app shell and static assets; it bypasses API calls and generated media. The yellow T is provided as scalable SVG favicon and PWA icons, including a maskable icon.

## Environment Variables

- `VIDEO_PROVIDER`: `wan` (default) or explicitly opted-in `replicate`; the app never switches providers automatically.
- `WAN_VIDEO_API_URL`, `WAN_VIDEO_API_TOKEN`, `WAN_VIDEO_MODEL`: Wan-compatible server endpoint, optional bearer token, and model label.
- `VIDEO_PROVIDER_MAX_DURATION`: provider-supported maximum, capped at 50 seconds; defaults to 5 for Wan and 10 for Replicate.
- `VIDEO_API_KEY`: Replicate token, server-side only; used only with `VIDEO_PROVIDER=replicate`.
- `VIDEO_MODEL`: optional Replicate model identifier; defaults to Kling v2.1 Master only when Replicate is explicitly selected.
- `FREE_VIDEO_LIMIT`: server-side successful-generation allowance per signed browser profile; defaults to `5`.
- `FREE_VIDEO_MAX_DURATION`: app hard ceiling in seconds per request; defaults to `50`, and the provider ceiling may be lower.
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: durable Redis REST credentials; generation fails closed without them.
- `TABHI_SESSION_SECRET`: random server-only signing secret, at least 32 characters.

## Free Generation Quota

The server defaults to five successful generations per signed browser profile (`FREE_VIDEO_LIMIT=5`). The quota is stored in Upstash Redis, not localStorage. An atomic Lua script reserves a slot before contacting the provider, commits once only after `succeeded`, and releases failed/canceled jobs. Tabs and serverless instances share the ledger. Refreshing or clearing localStorage does not reset it. The signed HttpOnly cookie is anonymous, not an authenticated account; clearing all site cookies or using another browser profile creates a new identity. Verified per-person limits require authentication.

`FREE_VIDEO_MAX_DURATION=50` is the hard app limit for each request; the configured provider's own limit may be lower and is shown in the UI. No clips are concatenated or substituted. Five completed generations use five credits regardless of duration. After the fifth success, the server rejects further requests and the UI reports that all five free generations have been used. Failed/canceled jobs do not consume credits. The app does not automatically charge users or switch providers. Provider, GPU host, and hosting costs/limits are separate.

To verify locally, run `npm run dev` with Upstash, session, and a provider endpoint configured. A fresh browser profile should show `5 / 5 remaining`; a provider `succeeded` status should change it to `4 / 5`. Provider failure/cancellation should leave the successful count unchanged. Open a second tab to confirm the Redis-backed snapshot is shared. Do not use localStorage to validate or reset quota. No live generation is run automatically by the project.

## Known limitations

- The text overlay is rasterized locally and composited by FFmpeg. Preview animations are not rendered as motion in the exported video; the selected style and text timing are preserved as a static overlay. Exporting animated text would require rendering an overlay animation frame-by-frame and substantially increases processing time and memory use.
- Center crop is fixed to the center; there is no face tracking or automatic subject detection.
- Quality presets balance speed, output size, resolution, and detail; they cannot restore detail missing from the source. Maximum is capped at 2560 pixels on the long edge to limit browser memory use.
- Metadata suggestions are simple local templates, not AI-generated research. Edit all suggestions before publishing.
- Direct video links require browser CORS access and are downloaded locally before editing; webpage and platform links are not imported.
- Browser codecs, memory, and the available FFmpeg WebAssembly build can limit the formats and sizes that export successfully. If a video is too large to process reliably, try a shorter or smaller source file.
