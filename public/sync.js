/* mira-remoto · cliente: tela cheia (todos) + transmissão ao vivo (o apresentador conduz, o espectador acompanha).
   Configuração vem do servidor, por transmissão, em window.__MIRA_REMOTO__ = { marcaDagua: bool, protecao: bool, marca: string }. */
(function () {
  'use strict';
  var CFG = window.__MIRA_REMOTO__ || {};
  var secs = [].slice.call(document.querySelectorAll('body > section'));
  var d = document, de = d.documentElement;

  /* ---------- tela cheia ---------- */
  function cheia() {
    if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); }
    else { var f = de.requestFullscreen || de.webkitRequestFullscreen; if (f) f.call(de); }
  }
  var st = d.createElement('style');
  st.textContent = '#fs-btn{position:fixed;top:14px;right:14px;z-index:2147483000;width:38px;height:38px;border-radius:10px;border:1px solid rgba(255,255,255,.2);background:rgba(11,15,13,.6);color:#fff;cursor:pointer;display:grid;place-items:center;opacity:.35;transition:opacity .25s;padding:0}#fs-btn:hover,#fs-btn:focus-visible{opacity:1}'
    + '.cursor-off,.cursor-off *{cursor:none!important}'
    + '#tx{position:fixed;z-index:2147483000;left:14px;font:600 12px/1 system-ui,sans-serif;color:#fff;background:rgba(11,15,13,.72);border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:8px 12px;display:flex;align-items:center;gap:10px;backdrop-filter:blur(8px)}'
    + '#tx.v{top:14px}#tx.a{bottom:14px}#tx.wait i{background:#e0a526;box-shadow:0 0 8px #e0a526}#tx.ok{border-color:#34E89E}#tx.ok span{color:#34E89E}#tx i{width:8px;height:8px;border-radius:50%;background:#34E89E;box-shadow:0 0 8px #34E89E}#tx.off i{background:#e0a526;box-shadow:none}'
    + '#tx button{all:unset;cursor:pointer;color:#34E89E;font-weight:700}#tx button:hover{text-decoration:underline}'
    + '#carga{position:fixed;inset:0;z-index:2147483500;display:grid;place-items:center;background:#0B0F0D;color:#F2FFF8;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;text-align:center;padding:24px;transition:opacity .5s}'
    + '#carga .b{width:min(320px,70vw);height:6px;border-radius:99px;background:rgba(255,255,255,.12);overflow:hidden;margin:1.1rem auto .7rem}#carga .b i{display:block;height:100%;width:0;background:#34E89E;border-radius:99px;transition:width .3s}'
    + '#carga .sp{width:42px;height:42px;border-radius:50%;border:3px solid rgba(52,232,158,.2);border-top-color:#34E89E;margin:0 auto 1rem;animation:gira 1s linear infinite}@keyframes gira{to{transform:rotate(360deg)}}'
    + '#fim{position:fixed;inset:0;z-index:2147483600;display:grid;place-items:center;background:#0B0F0D;color:#F2FFF8;font:18px/1.5 system-ui,sans-serif;text-align:center;padding:24px}';
  d.head.appendChild(st);
  var fb = d.createElement('button');
  fb.id = 'fs-btn'; fb.type = 'button'; fb.title = 'Tela cheia (F)'; fb.setAttribute('aria-label', 'Tela cheia');
  fb.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
  fb.addEventListener('click', cheia);
  d.body.appendChild(fb);
  var idle;
  addEventListener('mousemove', function () { de.classList.remove('cursor-off'); clearTimeout(idle); idle = setTimeout(function () { if (d.fullscreenElement) de.classList.add('cursor-off'); }, 2500); });
  function tecla(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
    if (d.body.classList.contains('md-on') && e.key !== 'f' && e.key !== 'F') return;
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); cheia(); }
  }

  /* ---------- transmissão ---------- */
  var m = location.pathname.match(/^\/s\/([a-z0-9-]+)\/?$/);
  if (!m) { addEventListener('keydown', tecla); return; }
  var slug = m[1], K = new URLSearchParams(location.search).get('k') || '';
  try { if (K) { sessionStorage.setItem('k:' + slug, K); history.replaceState(null, '', location.pathname); } else K = sessionStorage.getItem('k:' + slug) || ''; } catch (_) { }
  var papel = 'cliente', alvo = 0, es, pronto = false, idc = Math.random().toString(36).slice(2, 10) + Date.now().toString(36), carregado = false, pctAtual = 0, tx = d.createElement('div'), txt = d.createElement('span');
  tx.id = 'tx'; tx.className = 'off v'; tx.innerHTML = '<i></i>'; tx.appendChild(txt); txt.textContent = 'Conectando…'; d.body.appendChild(tx);

  function atual() {
    var meio = innerHeight / 2, achado = 0;
    secs.forEach(function (s, i) { var r = s.getBoundingClientRect(); if (r.top <= meio && r.bottom > meio) achado = i; });
    return achado;
  }
  function quadro() {                    // o slide é um quadro 16:9 centrado na janela
    var W = innerWidth, H = innerHeight, w = Math.min(W, H * 16 / 9), h = w * 9 / 16;
    return { l: (W - w) / 2, t: (H - h) / 2, w: w };
  }
  function norm(sh, inv) {               // traços do desenho: pixels <-> fração do quadro (igual em qualquer tela)
    var q = quadro();
    var X = function (v) { return inv ? q.l + v * q.w : (v - q.l) / q.w; };
    var Y = function (v) { return inv ? q.t + v * q.w * 9 / 16 : (v - q.t) / (q.w * 9 / 16); };
    var Z = function (v) { return inv ? v * q.w / 1000 : v * 1000 / q.w; };      // espessura/tamanho do texto
    return (sh || []).map(function (s) {
      var o = JSON.parse(JSON.stringify(s));
      ['x', 'x0', 'x1'].forEach(function (c) { if (typeof o[c] === 'number') o[c] = X(o[c]); });
      ['y', 'y0', 'y1'].forEach(function (c) { if (typeof o[c] === 'number') o[c] = Y(o[c]); });
      if (o.points) o.points = o.points.map(function (p) { return { x: X(p.x), y: Y(p.y) }; });
      ['width', 'size'].forEach(function (c) { if (typeof o[c] === 'number') o[c] = Z(o[c]); });
      return o;
    });
  }
  function ir(i) { if (secs[i]) secs[i].scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  function conectar() {
    es = new EventSource('/api/s/' + slug + '/eventos?c=' + idc + (K ? '&k=' + encodeURIComponent(K) : ''));
    es.addEventListener('estado', function (ev) {
      var s = JSON.parse(ev.data);
      if (s.papel) { papel = s.papel; if (!pronto) montar(); }
      tx.classList.remove('off'); atualizaTxt(s);
      if (papel === 'cliente') {
        alvo = s.i; if (carregado) ir(alvo);
        if (s.papel) informar(pctAtual, carregado);
        if (window.miraDraw && window.miraDraw.setShapes) window.miraDraw.setShapes(norm(s.shapes, true));
      }
    });
    es.addEventListener('quem', function (ev) { atualizaTxt(JSON.parse(ev.data)); });
    es.addEventListener('fim', function () { fim(); });
    es.onerror = function () { tx.classList.add('off'); txt.textContent = 'Reconectando…'; if (es.readyState === 2) fim(true); };
  }
  function atualizaTxt(r) {
    if (papel !== 'apresentador') { txt.textContent = 'AO VIVO'; return; }
    var n = r.clientes || 0, p = r.prontos || 0;
    tx.classList.remove('wait', 'ok');
    if (!n) { txt.textContent = 'Transmitindo · aguardando o cliente entrar'; }
    else if (p < n) { tx.classList.add('wait'); txt.textContent = n + (n === 1 ? ' pessoa' : ' pessoas') + ' · ' + (n - p) + ' carregando (' + (r.pct || 0) + '%) — aguarde'; }
    else { tx.classList.add('ok'); txt.textContent = '✔ ' + (n === 1 ? 'Cliente pronto' : 'Todos prontos (' + n + ')') + ' — pode iniciar'; }
  }
  var ultInf = 0, ultPct = -1, ultOk = false;
  function informar(p, ok) {
    var agora = Date.now();
    if (!ok && (agora - ultInf < 450 || Math.abs(p - ultPct) < 2)) return;
    ultInf = agora; ultPct = p; ultOk = ok;
    fetch('/api/s/' + slug + '/pronto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true, body: JSON.stringify({ c: idc, p: p, ok: !!ok }) }).catch(function () { });
  }

  /* ---------- cliente: carrega TUDO antes de mostrar ---------- */
  function carregarTudo() {
    var ov = d.createElement('div'); ov.id = 'carga';
    ov.innerHTML = '<div><div class="sp"></div><div style="font-weight:700;font-size:1.15rem">Preparando a apresentação…</div><div class="b"><i></i></div><div class="t" style="opacity:.7;font-size:.9rem">Carregando <span class="p">0</span>% · mantenha esta página aberta</div></div>';
    d.body.appendChild(ov);
    var barra = ov.querySelector('i'), pp = ov.querySelector('.p');
    var vids = [].slice.call(d.querySelectorAll('video')).map(function (v) {
      var src = null, tipo = 'video/mp4', orig = v.innerHTML;
      [].forEach.call(v.querySelectorAll('source'), function (so) { if (!src && v.canPlayType(so.getAttribute('type') || '')) { src = so.getAttribute('src'); tipo = so.getAttribute('type'); } });
      v.querySelectorAll('source').forEach(function (so) { so.remove(); }); v.preload = 'none'; try { v.load(); } catch (_) { }
      return { v: v, src: src, tipo: tipo, orig: orig, total: 0, bytes: 0, ok: false };
    });
    var imgs = [].slice.call(d.images), imgOk = 0, melhor = 0;
    function prog() {
      var tot = 0, got = 0; vids.forEach(function (t) { tot += t.total; got += Math.min(t.bytes, t.total || t.bytes); });
      var fv = tot ? got / tot : 0, fi = imgs.length ? imgOk / imgs.length : 1;
      var pct = Math.min(99, Math.round((fv * 0.88 + fi * 0.12) * 100)); if (pct > melhor) melhor = pct;
      pctAtual = melhor; barra.style.width = melhor + '%'; pp.textContent = melhor; informar(melhor, false);
    }
    var pI = Promise.all(imgs.map(function (im) {
      return new Promise(function (ok) {
        function fimI() { imgOk++; prog(); ok(); }
        if (im.complete && im.naturalWidth) return fimI();
        im.addEventListener('load', fimI, { once: true }); im.addEventListener('error', fimI, { once: true });
        setTimeout(fimI, 30000);
      });
    }));
    function baixar(t, tentativa) {
      return fetch(t.src, { credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) throw new Error(r.status);
        t.total = +r.headers.get('content-length') || t.total; t.bytes = 0; var ch = [], rd = r.body.getReader();
        return (function bombear() { return rd.read().then(function (x) { if (x.done) return; ch.push(x.value); t.bytes += x.value.length; prog(); return bombear(); }); })()
          .then(function () {
            t.v.src = URL.createObjectURL(new Blob(ch, { type: t.tipo })); t.v.load();
            return new Promise(function (ok) { var f = function () { ok(); }; t.v.addEventListener('loadeddata', f, { once: true }); setTimeout(f, 8000); });
          });
      }).catch(function () {
        if (tentativa < 3) return new Promise(function (ok) { setTimeout(ok, 800 * (tentativa + 1)); }).then(function () { return baixar(t, tentativa + 1); });
        t.v.innerHTML = t.orig; t.v.preload = 'auto'; try { t.v.load(); } catch (_) { }   // última chance: deixa o navegador transmitir
      });
    }
    var fila = vids.filter(function (t) { return t.src; }), pV;
    pV = Promise.all(fila.map(function (t) {                      // tamanhos primeiro (barra honesta)
      return fetch(t.src, { method: 'HEAD', credentials: 'same-origin' }).then(function (r) { t.total = +r.headers.get('content-length') || 0; }).catch(function () { });
    })).then(function () {
      prog(); var i = 0;
      function trab() { if (i >= fila.length) return Promise.resolve(); var t = fila[i++]; return baixar(t, 0).then(function () { t.ok = true; prog(); return trab(); }); }
      return Promise.all([trab(), trab(), trab()]);
    });
    var pF = d.fonts && d.fonts.ready ? d.fonts.ready : Promise.resolve();
    var pL = d.readyState === 'complete' ? Promise.resolve() : new Promise(function (ok) { addEventListener('load', ok, { once: true }); });
    Promise.all([pI, pV, pF, pL]).then(function () {
      return new Promise(function (ok) { setTimeout(ok, 400); });          // deixa os scripts do deck assentarem
    }).then(function () {
      carregado = true; pctAtual = 100; barra.style.width = '100%'; pp.textContent = '100';
      d.documentElement.style.scrollBehavior = 'auto'; var q = secs[alvo]; if (q) q.scrollIntoView({ block: 'start' }); d.documentElement.style.scrollBehavior = '';
      informar(100, true);
      ov.style.opacity = 0; setTimeout(function () { ov.remove(); }, 600);
    });
    prog();
  }
  function fim(naoExiste) {
    if (es) es.close();
    var o = d.createElement('div'); o.id = 'fim';
    o.innerHTML = '<div><h1 style="font-size:1.5rem;margin:0 0 .5rem">' + (naoExiste ? 'Esta apresentação não está mais no ar' : 'A apresentação terminou') + '</h1><p style="opacity:.7;margin:0">Obrigado por assistir.</p></div>';
    d.body.appendChild(o);
  }


  /* ---------- proteção do espectador: sem copiar, imprimir, salvar; marca d'água; tela some ao perder o foco ---------- */
  /* marca d'água: nome do link, código do visitante e data, repetidos na diagonal por cima do deck */
  function marcaDagua() {
    var marca = String(CFG.marca || 'CONFIDENCIAL') + ' · ' + slug + ' · ' + String(idc).slice(-5).toUpperCase() + ' · ' + new Date().toLocaleDateString('pt-BR');
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="260"><text x="50%" y="50%" transform="rotate(-24 210 130)" text-anchor="middle" font-family="Arial" font-size="17" font-weight="700" fill="rgba(255,255,255,.13)" stroke="rgba(0,0,0,.10)" stroke-width=".6">' + marca.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</text></svg>';
    var st = d.createElement('style');
    st.textContent = '#wm{position:fixed;inset:0;z-index:2147483000;pointer-events:none;background:url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '") repeat}';
    d.head.appendChild(st);
    var wm = d.createElement('div'); wm.id = 'wm'; d.body.appendChild(wm);
  }

  function proteger() {
    var st = d.createElement('style');
    st.textContent = 'html,body,body *{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important;-webkit-user-drag:none}'
      + 'img,video{pointer-events:none}'
      + '#cobre{position:fixed;inset:0;z-index:2147483600;background:#07090c;color:#e8eef5;display:none;align-items:center;justify-content:center;text-align:center;font:600 1.05rem system-ui,sans-serif;padding:2rem}'
      + '#cobre.on{display:flex}'
      + '@media print{html{display:none!important}}';
    d.head.appendChild(st);
    var cb = d.createElement('div'); cb.id = 'cobre'; cb.textContent = 'Conteúdo protegido. Volte para esta janela para continuar assistindo.'; d.body.appendChild(cb);
    var trava = 0;
    function cobrir(ms) { cb.classList.add('on'); trava = Date.now() + (ms || 0); }
    function descobrir() { if (Date.now() < trava) { setTimeout(descobrir, trava - Date.now() + 20); return; } if (d.hasFocus() && !d.hidden) cb.classList.remove('on'); }
    function limpaClip() { try { navigator.clipboard.writeText(' ').catch(function () { }); } catch (_) { } }
    ['contextmenu', 'copy', 'cut', 'dragstart', 'selectstart', 'beforeprint'].forEach(function (n) { d.addEventListener(n, function (e) { e.preventDefault(); if (n === 'beforeprint') cobrir(1500); }, true); });
    addEventListener('beforeprint', function () { cobrir(2000); });
    addEventListener('afterprint', function () { setTimeout(descobrir, 2100); });
    addEventListener('blur', function () { cobrir(0); });
    addEventListener('focus', function () { setTimeout(descobrir, 150); });
    d.addEventListener('visibilitychange', function () { if (d.hidden) cobrir(0); else setTimeout(descobrir, 150); });
    addEventListener('keydown', function (e) {
      var k = (e.key || '').toLowerCase(), mod = e.ctrlKey || e.metaKey;
      if (k === 'printscreen' || k === 'snapshot') { cobrir(2500); limpaClip(); e.preventDefault(); setTimeout(descobrir, 2600); return; }
      if ((e.metaKey && e.shiftKey) || (e.metaKey && e.altKey) || (mod && e.shiftKey && 'sic'.indexOf(k) > -1)) { cobrir(3000); setTimeout(descobrir, 3100); }
      if (mod && 'pscuaio'.indexOf(k) > -1 || k === 'f12') { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    addEventListener('keyup', function (e) { var k = (e.key || '').toLowerCase(); if (k === 'printscreen' || k === 'snapshot') { limpaClip(); cobrir(2500); setTimeout(descobrir, 2600); } }, true);
    new MutationObserver(function () {                         // vídeos: sem baixar, sem PiP
      [].forEach.call(d.querySelectorAll('video'), function (v) { v.setAttribute('controlsList', 'nodownload noremoteplayback'); v.disablePictureInPicture = true; v.setAttribute('disablePictureInPicture', ''); });
    }).observe(d.body, { subtree: true, childList: true });
    [].forEach.call(d.querySelectorAll('video'), function (v) { v.setAttribute('controlsList', 'nodownload noremoteplayback'); v.disablePictureInPicture = true; });
    if (d.hasFocus && !d.hasFocus()) cobrir(0);
  }

  function montar() {
    pronto = true;
    if (papel === 'apresentador') {
      tx.className = 'a'; 
      var cp = d.createElement('button'); cp.type = 'button'; cp.textContent = 'Copiar link do cliente';
      cp.addEventListener('click', function () {
        var l = location.origin + '/s/' + slug;
        (navigator.clipboard ? navigator.clipboard.writeText(l) : Promise.reject()).then(function () { cp.textContent = 'Copiado!'; }, function () { prompt('Link do cliente:', l); });
        setTimeout(function () { cp.textContent = 'Copiar link do cliente'; }, 1800);
      });
      var en = d.createElement('button'); en.type = 'button'; en.textContent = 'Encerrar'; en.style.color = '#ffb4a4';
      en.addEventListener('click', function () {
        if (!confirm('Encerrar a transmissão? O cliente verá que terminou.')) return;
        fetch('/api/s/' + slug + '/encerrar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ k: K }) }).then(function () { try { sessionStorage.removeItem('k:' + slug); } catch (_) { } location.href = '/apresentar'; });
      });
      tx.appendChild(cp); tx.appendChild(en);
      var t, ult = -1, pend;
      function enviar() {
        var sh = window.miraDraw && window.miraDraw.getShapes ? norm(window.miraDraw.getShapes(), false) : [];
        fetch('/api/s/' + slug + '/estado', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true, body: JSON.stringify({ k: K, i: atual(), shapes: sh }) });
      }
      function agenda(ms) { clearTimeout(t); t = setTimeout(enviar, ms); }
      addEventListener('scroll', function () { var i = atual(); if (i !== ult) { ult = i; agenda(350); } }, { passive: true });
      var tentar = setInterval(function () { if (window.miraDraw) { clearInterval(tentar); window.miraDraw.onchange = function () { agenda(120); }; } }, 300);
      setTimeout(function () { enviar(); }, 800);
      addEventListener('keydown', tecla);
    } else {
      carregarTudo();
      if (CFG.marcaDagua !== false) marcaDagua();
      if (CFG.protecao !== false) proteger();
      /* cliente: só assiste (bloqueia teclado, roda e toque; F continua valendo) */
      tx.className = 'v';
      var st2 = d.createElement('style'); st2.textContent = 'html,body{overflow:hidden!important}'; d.head.appendChild(st2);
      addEventListener('keydown', function (e) { if (e.key === 'f' || e.key === 'F') { tecla(e); return; } e.preventDefault(); e.stopImmediatePropagation(); }, true);
      ['wheel', 'touchmove'].forEach(function (n) { addEventListener(n, function (e) { e.preventDefault(); }, { passive: false }); });
      addEventListener('resize', function () { ir(alvo); });
    }
  }
  conectar();
})();
