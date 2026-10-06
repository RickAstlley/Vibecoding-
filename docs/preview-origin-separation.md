# Preview Iframe: Origin Separation Plan

> Status: **Implemented.** This document explains how the COOP/COEP headers in
> `public/.htaccess` interact with the preview iframe, the current same-origin
> approach, and the plan for migrating to a separate-origin preview if needed.

---

## 1. Current state

### Architecture
- The app serves a **same-origin iframe** at `/__preview__/index.html`
- A Service Worker (`public/sw.js`) intercepts requests under `/__preview__/`
  and serves files from the in-memory VFS cache
- The bridge (`public/preview-bridge.js`) is injected into each served HTML
  page, enabling `postMessage` communication between parent and iframe
- The `BrowserBridge` client (`src/core/browser/bridge-client.ts`) sends
  commands via `postMessage` with target origin `'*'` (line 131)

### `.htaccess` headers (already configured)
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: cross-origin
```

### Implications
1. **COOP `same-origin`**: Isolates browsing context to same-origin. Not needed
   for the current same-origin iframe preview. Would matter if WebContainers
   were used (rejected per plan).

2. **COEP `require-corp`**: Blocks cross-origin resources without CORP headers.
   External CDNs (esm.sh, webcontainers.io) serve with proper CORS.

3. **CORP `cross-origin`**: Allows embeds to load resources that permit it.

### Security consideration: `allow-same-origin`
The iframe uses `sandbox` with `allow-same-origin` (Preview.tsx:419) for the SW
to control documents. Trade-off: iframe can access parent's localStorage.
The "Lembrar chaves" toggle (OFF by default) addresses this.

---

## 2. Plan: separate-origin preview

If preview needs a different origin:

1. Serve on `localhost:3001` or subdomain
2. Change `Preview.tsx:418` src to `http://localhost:3001/...`
3. Update `bridge-client.ts:131` target origin from `'*'` to explicit origin
4. Deploy SW on the separate origin OR use HTTP `/vfs/:path` endpoint
5. Set same COOP/COEP headers on the secondary server
