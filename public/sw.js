/* Service Worker do Arcanum Weaver: serve arquivos do VFS para o iframe de preview.
   Escopo restrito a /__preview__/ para nao interferir no app. */

const CHANNEL = '__arcanum_vfs__';
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
  }
});

function mimeFor(path) {
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

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (!url.pathname.startsWith('/__preview__/')) return;

  const requested = decodeURIComponent(url.pathname.slice('/__preview__/'.length)) || 'index.html';
  const candidates = [requested, requested.endsWith('/') ? `${requested}index.html` : requested];
  if (requested === '/' || requested === '') candidates.unshift('index.html');

  for (const candidate of candidates) {
    const entry = cache.get(candidate);
    if (entry) {
      event.respondWith(respond(entry, url));
      return;
    }
  }

  const fallback = cache.get('index.html');
  if (fallback && (requested === '' || !requested.includes('.'))) {
    event.respondWith(respond(fallback, url));
    return;
  }

  event.respondWith(
    new Response(`<!-- Arcanum Weaver: ${requested} nao encontrado no projeto -->`, {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
  );
});

function respond(entry, url) {
  const isHtml = entry.type.startsWith('text/html');
  const isText = isHtml || entry.type.startsWith('text/') || TRANSFORMERS.includes(entry.type);
  const body = isHtml ? injectBridge(rewrite(entry.content, url)) : isText ? rewrite(entry.content, url) : entry.content;
  return new Response(body, {
    status: 200,
    headers: { 'content-type': entry.type, 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
  });
}

/**
 * Injeta um relay de console e erros no HTML servido, para que o painel do
 * preview mostre o que a pagina loga. Como o iframe roda em sandbox sem
 * allow-same-origin, o targetOrigin precisa ser '*'.
 */
function injectBridge(html) {
  const script = `<script data-arcanum-bridge>(function(){
  var post = function(level, text){ try { parent.postMessage({ type: 'console', level: level, text: String(text) }, '*'); } catch (e) {} };
  var fmt = function(args){
    var out = [];
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      if (typeof a === 'string') { out.push(a); continue; }
      if (a instanceof Error) { out.push(a.name + ': ' + a.message); continue; }
      try { out.push(JSON.stringify(a)); } catch (e) { out.push(String(a)); }
    }
    return out.join(' ');
  };
  ['log','info','warn','error','debug'].forEach(function(level){
    var orig = console[level];
    console[level] = function(){ post(level, fmt(arguments)); orig.apply(console, arguments); };
  });
  window.addEventListener('error', function(e){
    post('error', e.message + (e.filename ? ' (' + String(e.filename).split('/__preview__/').pop() + ':' + e.lineno + ')' : ''));
  });
  window.addEventListener('unhandledrejection', function(e){
    var r = e.reason;
    post('error', 'Promise rejeitada sem tratamento: ' + (r && r.message ? r.message : String(r)));
  });
  parent.postMessage({ type: 'ready' }, '*');
})();</script>`;

  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${script}`);
  if (/<body[^>]*>/i.test(html)) return html.replace(/<body([^>]*)>/i, `<body$1>${script}`);
  return script + html;
}

/**
 * Reescreve URLs absolutos (/styles.css, /src/main.tsx) para o namespace
 * do preview, para que o Service Worker consiga interceptar tudo.
 */
function rewrite(html, baseUrl) {
  let out = html;
  out = out.replace(/(\s(?:src|href)\s*=\s*["'])\/(?!\/)/g, `$1/__preview__/`);
  out = out.replace(/(from\s+['"])\/(?!\/)/g, '$1/__preview__/');
  out = out.replace(/import\(\s*['"]\/(?!\/)/g, 'import("/__preview__/');
  out = out.replace(/new\s+Worker\(\s*['"]\/(?!\/)/g, `new Worker("/__preview__/`);
  return out;
}