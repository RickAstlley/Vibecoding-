/* Service Worker do Arcanum Weaver: serve arquivos do VFS para o iframe de preview.
   Escopo restrito a /__preview__/ para nao interferir no app. */

const cache = new Map();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'vfs:reset') {
    cache.clear();
    return;
  }

  if (data.type === 'vfs:put' && data.path && typeof data.content === 'string') {
    cache.set(data.path, {
      content: data.content,
      type: mimeFor(data.path),
    });
    return;
  }

  if (data.type === 'vfs:delete' && data.path) {
    cache.delete(data.path);
    return;
  }

  if (data.type === 'vfs:put-many' && Array.isArray(data.files)) {
    for (const file of data.files) {
      if (file && typeof file.path === 'string' && typeof file.content === 'string') {
        cache.set(file.path, { content: file.content, type: mimeFor(file.path) });
      }
    }
    return;
  }

  // Modulos ja transformados pelo bundler (TSX -> JS, imports reescritos).
  if (data.type === 'vfs:put-modules' && Array.isArray(data.modules)) {
    for (const mod of data.modules) {
      if (mod && typeof mod.path === 'string' && typeof mod.content === 'string') {
        cache.set(mod.path, { content: mod.content, type: 'text/javascript; charset=utf-8' });
      }
    }
    return;
  }

  // Import map do bundle.
  if (data.type === 'vfs:import-map' && typeof data.content === 'string') {
    cache.set('__arcanum_import_map.json', { content: data.content, type: 'application/json; charset=utf-8' });
  }
});

function mimeFor(path) {
  const scriptLike = ['.ts', '.tsx', '.jsx', '.mts', '.cts'];
  if (scriptLike.includes(extensionOf(path))) return 'text/javascript; charset=utf-8';
  return mimeForPlain(path);
}

function extensionOf(path) {
  const base = path.split('/').pop() || '';
  const i = base.lastIndexOf('.');
  return i <= 0 ? '' : base.slice(i).toLowerCase();
}

function mimeForPlain(path) {
  const ext = path.split('.').pop().toLowerCase();
  const map = {
    html: 'text/html; charset=utf-8',
    htm: 'text/html; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    mjs: 'text/javascript; charset=utf-8',
    cjs: 'text/javascript; charset=utf-8',
    jsx: 'text/javascript; charset=utf-8',
    ts: 'text/plain; charset=utf-8',
    tsx: 'text/plain; charset=utf-8',
    css: 'text/css; charset=utf-8',
    json: 'application/json; charset=utf-8',
    md: 'text/plain; charset=utf-8',
    txt: 'text/plain; charset=utf-8',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
  };
  return map[ext] || 'text/plain; charset=utf-8';
}

const TRANSFORMERS = ['text/html', 'text/javascript', 'application/json', 'text/css'];

const BRIDGE_PATH = '/__preview__/__arcanum_bridge.js';

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (!url.pathname.startsWith('/__preview__/')) return;

  if (url.pathname === BRIDGE_PATH) {
    event.respondWith(fetch('/preview-bridge.js').then((r) => new Response(r.text, {
      status: 200,
      headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' },
    })));
    return;
  }

  const requested = decodeURIComponent(url.pathname.slice('/__preview__/'.length)) || 'index.html';
  const candidates = [requested, requested.endsWith('/') ? `${requested}index.html` : requested];
  if (requested === '/' || requested === '') candidates.unshift('index.html');

  for (const candidate of candidates) {
    const entry = cache.get(candidate);
    if (entry) {
      event.respondWith(respond(entry));
      return;
    }
  }

  const fallback = cache.get('index.html');
  if (fallback && (requested === '' || !requested.includes('.'))) {
    event.respondWith(respond(fallback));
    return;
  }

  event.respondWith(
    new Response(`<!-- Arcanum Weaver: ${requested} nao encontrado no projeto -->`, {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
  );
});

function respond(entry) {
  const isHtml = entry.type.startsWith('text/html');
  const isText = isHtml || entry.type.startsWith('text/') || TRANSFORMERS.includes(entry.type);
  const body = isHtml ? injectBridge(rewrite(entry.content)) : isText ? rewrite(entry.content) : entry.content;
  return new Response(body, {
    status: 200,
    headers: { 'content-type': entry.type, 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
  });
}

/**
 * Injeta o bridge de console e driver de DOM no HTML servido.
 * O script vive em /preview-bridge.js para poder ser mantido e testado
 * fora deste arquivo.
 */
function injectBridge(html) {
  const tag = '<script data-arcanum-bridge src="/__preview__/__arcanum_bridge.js" defer></script>';
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${tag}`);
  if (/<body[^>]*>/i.test(html)) return html.replace(/<body([^>]*)>/i, `<body$1>${tag}`);
  return tag + html;
}

/**
 * Reescreve URLs absolutos (/styles.css, /src/main.tsx) para o namespace
 * do preview, para que o Service Worker consiga interceptar tudo.
 */
function rewrite(html) {
  let out = html;
  out = out.replace(/(\s(?:src|href)\s*=\s*["'])\/(?!\/)/g, `$1/__preview__/`);
  out = out.replace(/(from\s+['"])\/(?!\/)/g, '$1/__preview__/');
  out = out.replace(/import\(\s*['"]\/(?!\/)/g, 'import("/__preview__/');
  out = out.replace(/new\s+Worker\(\s*['"]\/(?!\/)/g, `new Worker("/__preview__/`);
  return out;
}