/* Bridge do preview do Arcanum Weaver.
   Injetado em todo HTML servido por /__preview__/.
   Faz duas coisas:
     1. Console relay  - repassa logs e erros para o painel do IDE.
     2. Driver de DOM  - permite ao agente inspecionar e manipular a pagina.

   O iframe roda em sandbox sem allow-same-origin, entao a origem e 'null'
   e todo postMessage usa '*'. Cada comando carrega um id para correlacionar
   comando -> resposta. */
(function () {
  var NS = '__arcanum';

  function post(msg) {
    try {
      parent.postMessage(Object.assign({ ns: NS }, msg), '*');
    } catch (e) {}
  }

  function fmt(args) {
    var out = [];
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      if (typeof a === 'string') {
        out.push(a);
        continue;
      }
      if (a instanceof Error) {
        out.push(a.name + ': ' + a.message);
        continue;
      }
      try {
        out.push(JSON.stringify(a));
      } catch (e) {
        out.push(String(a));
      }
    }
    return out.join(' ');
  }

  /* --------------------------------------------------------------- console */

  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    var orig = console[level];
    console[level] = function () {
      post({ type: 'console', level: level, text: fmt(arguments) });
      orig.apply(console, arguments);
    };
  });

  window.addEventListener('error', function (e) {
    var where = e.filename ? ' (' + String(e.filename).split('/__preview__/').pop() + ':' + e.lineno + ')' : '';
    post({ type: 'console', level: 'error', text: e.message + where });
  });

  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    post({
      type: 'console',
      level: 'error',
      text: 'Promise rejeitada sem tratamento: ' + (r && r.message ? r.message : String(r)),
    });
  });

  /* ------------------------------------------------------------------- DOM */

  function visible(el) {
    if (!el) return false;
    if (el.nodeType !== 1) return false;
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function describe(el, index) {
    var tag = el.tagName.toLowerCase();
    var id = el.id ? '#' + el.id : '';
    var cls = el.classList && el.classList.length
      ? '.' + Array.prototype.slice.call(el.classList).slice(0, 3).join('.')
      : '';
    var text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    var rect = el.getBoundingClientRect();
    return {
      index: index,
      selector: tag + id + cls,
      tag: tag,
      text: text,
      visible: visible(el),
      disabled: Boolean(el.disabled),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
    };
  }

  var INTERACTIVE = 'a,button,input,select,textarea,summary,[role="button"],[onclick],[tabindex]';

  function find(selector, all) {
    var list = selector ? Array.prototype.slice.call(document.querySelectorAll(selector)) : [];
    if (!selector) {
      list = Array.prototype.slice.call(document.querySelectorAll('body *'));
    }
    if (!all) {
      list = list.filter(visible);
    }
    return list.slice(0, all ? 60 : 30).map(describe);
  }

  function resolveTarget(selector) {
    if (typeof selector === 'number') {
      var all = Array.prototype.slice.call(document.querySelectorAll(INTERACTIVE));
      var shown = all.filter(visible);
      return shown[selector] || all[selector] || null;
    }
    return document.querySelector(selector);
  }

  function nativeSet(el, value) {
    var proto = Object.getPrototypeOf(el);
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  var ops = {
    snapshot: function () {
      var body = document.body;
      return {
        title: document.title,
        url: location.pathname,
        readyState: document.readyState,
        interactive: Array.prototype.slice.call(document.querySelectorAll(INTERACTIVE)).filter(visible).length,
        headings: Array.prototype.slice.call(document.querySelectorAll('h1,h2,h3')).map(function (h) {
          return { level: h.tagName, text: (h.textContent || '').trim().slice(0, 100) };
        }),
        buttons: Array.prototype.slice.call(document.querySelectorAll('button,a,[role="button"]')).map(describe),
        inputs: Array.prototype.slice.call(document.querySelectorAll('input,textarea,select')).map(function (el) {
          var d = describe(el, 0);
          d.type = el.type || el.tagName.toLowerCase();
          d.name = el.name || '';
          d.placeholder = el.placeholder || '';
          d.value = el.type === 'password' ? '***' : String(el.value || '').slice(0, 60);
          return d;
        }),
        text: (body ? body.innerText : '').replace(/\s+/g, ' ').trim().slice(0, 3000),
      };
    },

    query: function (args) {
      return { matches: find(args.selector, args.all) };
    },

    read: function (args) {
      var el = resolveTarget(args.selector);
      if (!el) return { found: false, message: 'Selector nao encontrou elemento: ' + args.selector };
      var d = describe(el, 0);
      d.found = true;
      d.html = el.outerHTML.slice(0, 1200);
      d.value = el.value !== undefined ? String(el.value).slice(0, 200) : undefined;
      return d;
    },

    click: function (args) {
      var el = resolveTarget(args.selector);
      if (!el) return { ok: false, message: 'Selector nao encontrou elemento: ' + args.selector };
      var before = document.body ? document.body.innerText.length : 0;
      el.scrollIntoView({ block: 'center' });
      el.click();
      return { ok: true, selector: describe(el, 0).selector, textDelta: (document.body ? document.body.innerText.length : 0) - before };
    },

    type: function (args) {
      var el = resolveTarget(args.selector);
      if (!el) return { ok: false, message: 'Selector nao encontrou elemento: ' + args.selector };
      el.focus();
      nativeSet(el, args.text == null ? '' : String(args.text));
      if (args.submit) {
        if (el.form && el.form.requestSubmit) el.form.requestSubmit();
        else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      }
      return { ok: true, selector: describe(el, 0).selector, value: String(el.value || '').slice(0, 120) };
    },

    wait: function (args) {
      return { ok: true, waitedMs: args.ms || 0, readyState: document.readyState };
    },

    scroll: function (args) {
      window.scrollTo(0, args.y || 0);
      return { ok: true, y: window.scrollY };
    },
  };

  window.addEventListener('message', function (e) {
    var data = e.data;
    if (!data || data.ns !== NS || data.kind !== 'cmd') return;

    var op = ops[data.op];
    if (!op) {
      post({ type: 'result', id: data.id, ok: false, error: 'Operacao desconhecida: ' + data.op });
      return;
    }

    Promise.resolve()
      .then(function () {
        return op(data.args || {});
      })
      .then(function (result) {
        post({ type: 'result', id: data.id, ok: true, result: result });
      })
      .catch(function (err) {
        post({ type: 'result', id: data.id, ok: false, error: err && err.message ? err.message : String(err) });
      });
  });

  post({ type: 'ready', title: document.title });
})();