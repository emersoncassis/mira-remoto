'use strict';
/* mira-remoto: servidor de apresentação ao vivo para decks do Mira (mira-animator).
   Zero dependências. Serve qualquer deck de decks/<nome>/ e sincroniza o apresentador com
   os espectadores por SSE (Server-Sent Events).

   Variáveis de ambiente:
     PORT           porta (3000)
     PRESENTER_KEY  chave de quem apresenta (se faltar, é gerada e mostrada no log)
     DECKS_DIR      pasta dos decks (./decks)
     PROTEGER       1 = espectador sem copiar/imprimir, com marca d'água (padrão). 0 = desliga
     MARCA          texto da marca d'água (CONFIDENCIAL)                                       */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PORT = +process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const DECKS = path.resolve(process.env.DECKS_DIR || path.join(__dirname, 'decks'));
const PROTEGER = process.env.PROTEGER !== '0';
const MARCA = String(process.env.MARCA || 'CONFIDENCIAL').slice(0, 40);
let KEY = process.env.PRESENTER_KEY || '';
if (!KEY) { KEY = crypto.randomBytes(6).toString('hex'); console.log('[mira-remoto] PRESENTER_KEY não definida; chave temporária: ' + KEY); }

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.ico': 'image/x-icon' };

/* Nunca entregues ao espectador: fontes do deck (references/), roteiros, scripts e arquivos ocultos. */
const BLOQUEADO = /(^|\/)(references|node_modules)(\/|$)|(^|\/)\.|\.(md|cjs|bat|command|sh|ps1|map)$/i;

/* ---------- decks ---------- */
function listarDecks() {
  try {
    return fs.readdirSync(DECKS, { withFileTypes: true })
      .filter(e => e.isDirectory() && /^[a-z0-9][a-z0-9._-]*$/i.test(e.name) && fs.existsSync(path.join(DECKS, e.name, 'index.html')))
      .map(e => e.name).sort();
  } catch (_) { return []; }
}

/* ---------- sessões em memória ---------- */
const sessoes = new Map();               // slug -> {deck, token, i, shapes, clientes:Set, ultimo}
const MAX_SESSOES = 100, TTL_MS = 12 * 3600e3;

function igualSeg(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest(), hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
const SEGREDO = crypto.randomBytes(32);          // muda a cada reinício: cookies antigos deixam de valer
function assina(slug) { return crypto.createHmac('sha256', SEGREDO).update(slug).digest('hex').slice(0, 32); }
function cookieSlug(req) {                       // slug da sessão ativa a que este navegador tem direito, ou null
  const m = /(?:^|;\s*)ap=([a-z0-9-]+)\.([0-9a-f]{32})(?:;|$)/.exec(req.headers.cookie || '');
  return m && sessoes.has(m[1]) && igualSeg(m[2], assina(m[1])) ? m[1] : null;
}
const falhas = new Map();                // ip -> [timestamps]
function ip(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(); }
function bloqueado(i) { const t = Date.now() - 600e3, l = (falhas.get(i) || []).filter(x => x > t); falhas.set(i, l); return l.length >= 6; }
function falhou(i) { (falhas.get(i) || falhas.set(i, []).get(i)).push(Date.now()); }

function slugDe(nome) {
  const s = String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s || crypto.randomBytes(3).toString('hex');
}
function enviar(res, evento, dados) { res.write('event: ' + evento + '\ndata: ' + JSON.stringify(dados) + '\n\n'); }
function difundir(s, evento, dados, soClientes) {
  s.clientes.forEach(c => { if (!soClientes || !c.apresentador) enviar(c.res, evento, dados); });
}
function resumo(s) {
  let n = 0, prontos = 0, min = 100;
  s.clientes.forEach(c => { if (c.apresentador) return; n++; if (c.pronto) prontos++; else min = Math.min(min, c.pct || 0); });
  return { clientes: n, prontos, pct: prontos === n ? 100 : Math.round(min) };
}
function avisarContagem(s) { const r = resumo(s); s.clientes.forEach(c => { if (c.apresentador) enviar(c.res, 'quem', r); }); }

function batimento() { sessoes.forEach(s => s.clientes.forEach(c => c.res.write(': ♥\n\n'))); }
setInterval(() => {
  const agora = Date.now();
  sessoes.forEach((s, slug) => { if (s.clientes.size === 0 && agora - s.ultimo > TTL_MS) sessoes.delete(slug); });
}, 60e3).unref();
setInterval(batimento, 20e3).unref();

/* ---------- utilidades HTTP ---------- */
function json(res, code, obj) { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(b); }
function corpo(req, max = 300e3) {
  return new Promise((ok, no) => {
    let n = 0; const p = [];
    req.on('data', d => { n += d.length; if (n > max) { no(new Error('grande')); req.destroy(); } else p.push(d); });
    req.on('end', () => { try { ok(JSON.parse(Buffer.concat(p).toString() || '{}')); } catch (e) { no(e); } });
    req.on('error', no);
  });
}
function estatico(req, res, arquivo, cache, extra) {
  fs.stat(arquivo, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Não encontrado'); }
    const ext = path.extname(arquivo).toLowerCase();
    const h = Object.assign({ 'Content-Type': TIPOS[ext] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': cache ? 'private, max-age=2592000' : 'no-store' }, extra || {});
    const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (r && (r[1] || r[2])) {
      const a = r[1] ? +r[1] : Math.max(0, st.size - +r[2]); let b = r[1] && r[2] ? +r[2] : st.size - 1;
      b = Math.min(b, st.size - 1);
      if (a > b || a >= st.size) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); return res.end(); }
      res.writeHead(206, Object.assign(h, { 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Content-Length': b - a + 1 }));
      return fs.createReadStream(arquivo, { start: a, end: b }).pipe(res);
    }
    res.writeHead(200, Object.assign(h, { 'Content-Length': st.size }));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(arquivo).pipe(res);
  });
}

/* O deck do Mira NÃO precisa ser editado: o servidor injeta, na hora de entregar, o <base> (para os caminhos
   relativos assets/... e mira/... funcionarem), a configuração e os scripts de telestrator e de sincronia. */
function prepararDeck(slug, deck) {
  let html = fs.readFileSync(path.join(DECKS, deck, 'index.html'), 'utf8');
  const base = '<base href="/_d/' + deck + '/">';
  html = /<base\b[^>]*>/i.test(html) ? html.replace(/<base\b[^>]*>/i, base) : html.replace(/<head\b[^>]*>/i, m => m + base);
  html = html.replace(/<script\b[^>]*mira-draw[^>]*>\s*<\/script>/gi, '');        // usa a versão do servidor, que tem a API de sincronia
  html = html.replace(/<script\b[^>]*\bsync\.js[^>]*>\s*<\/script>/gi, '');
  const cfg = JSON.stringify({ protecao: PROTEGER, marca: MARCA }).replace(/</g, '\\u003c');
  const tags = '<script>window.__MIRA_REMOTO__=' + cfg + ';</script>'
    + '<script defer src="/_mira/mira-draw.js"></script><script defer src="/_mira/sync.js"></script>';
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, tags + '</body>') : html + tags;
}

const ESTILO_PAG = 'margin:0;min-height:100vh;display:grid;place-items:center;background:#0B0F0D;color:#F2FFF8;font:18px/1.5 system-ui,sans-serif;text-align:center;padding:24px';
const PAG_404 = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Apresentação</title><body style="' + ESTILO_PAG + '"><div><h1 style="font-size:1.4rem">Esta apresentação não está no ar</h1><p style="opacity:.7">O link pode estar errado ou a transmissão já foi encerrada. Peça um novo link a quem apresenta.</p></div>';
const PAG_RESTRITO = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Acesso restrito</title><body style="' + ESTILO_PAG + '"><div><h1 style="font-size:1.4rem">Acesso restrito</h1><p style="opacity:.7">Esta apresentação é exibida apenas para convidados, por link enviado por quem apresenta.</p></div>';

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), p = url.pathname;
  try {
    if (p === '/saude') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }

    /* --- API --- */
    if (p === '/api/decks' && req.method === 'GET') {              // só com a chave: não vaza o nome dos seus decks
      const a = ip(req);
      if (bloqueado(a)) return json(res, 429, { erro: 'Muitas tentativas. Aguarde alguns minutos.' });
      if (!igualSeg(req.headers['x-chave'] || '', KEY)) { falhou(a); return json(res, 403, { erro: 'Chave incorreta.' }); }
      return json(res, 200, { decks: listarDecks() });
    }
    if (p === '/api/sessoes' && req.method === 'POST') {
      const a = ip(req);
      if (bloqueado(a)) return json(res, 429, { erro: 'Muitas tentativas. Aguarde alguns minutos.' });
      const b = await corpo(req);
      if (!igualSeg(b.chave || '', KEY)) { falhou(a); return json(res, 403, { erro: 'Chave incorreta.' }); }
      const decks = listarDecks();
      if (!decks.length) return json(res, 500, { erro: 'Nenhum deck encontrado em decks/.' });
      const deck = b.deck ? String(b.deck) : (decks.length === 1 ? decks[0] : '');
      if (!decks.includes(deck)) return json(res, 400, { erro: 'Escolha o deck que será apresentado.' });
      if (sessoes.size >= MAX_SESSOES) return json(res, 503, { erro: 'Muitas sessões abertas.' });
      const slug = slugDe(b.nome);
      if (sessoes.has(slug)) return json(res, 409, { erro: 'Esse nome de link já está em uso. Escolha outro.' });
      const token = crypto.randomBytes(18).toString('hex');
      sessoes.set(slug, { deck, token, i: 0, shapes: [], clientes: new Set(), ultimo: Date.now() });
      return json(res, 201, { slug, token, deck });
    }
    let m = /^\/api\/s\/([a-z0-9-]+)\/pronto$/.exec(p);
    if (m && req.method === 'POST') {
      const s = sessoes.get(m[1]); if (!s) return json(res, 404, { erro: 'Sessão não encontrada.' });
      const b = await corpo(req, 2e3), id = String(b.c || '').replace(/[^a-z0-9]/gi, '').slice(0, 32);
      s.clientes.forEach(c => { if (!c.apresentador && id && c.id === id) { c.pct = Math.max(0, Math.min(100, +b.p || 0)); c.pronto = b.ok === true; } });
      avisarContagem(s); res.writeHead(204); return res.end();
    }
    m = /^\/api\/s\/([a-z0-9-]+)\/(eventos|estado|encerrar)$/.exec(p);
    if (m) {
      const s = sessoes.get(m[1]);
      if (!s) return json(res, 404, { erro: 'Sessão não encontrada.' });
      if (m[2] === 'eventos' && req.method === 'GET') {
        const apresentador = igualSeg(url.searchParams.get('k') || '', s.token);
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
        const idc = String(url.searchParams.get('c') || '').replace(/[^a-z0-9]/gi, '').slice(0, 32);
        const c = { res, apresentador, id: idc, pct: 0, pronto: false };
        s.clientes.add(c); s.ultimo = Date.now();
        res.write('retry: 2000\n\n');
        enviar(res, 'estado', Object.assign({ i: s.i, shapes: s.shapes, papel: apresentador ? 'apresentador' : 'cliente' }, resumo(s)));
        avisarContagem(s);
        req.on('close', () => { s.clientes.delete(c); s.ultimo = Date.now(); avisarContagem(s); });
        return;
      }
      const b = await corpo(req);
      if (!igualSeg(b.k || '', s.token)) return json(res, 403, { erro: 'Sem permissão.' });
      if (m[2] === 'estado' && req.method === 'POST') {
        const i = Number.isInteger(b.i) && b.i >= 0 && b.i < 500 ? b.i : s.i;
        s.i = i; if (Array.isArray(b.shapes)) s.shapes = b.shapes.slice(0, 500); s.ultimo = Date.now();
        difundir(s, 'estado', { i: s.i, shapes: s.shapes }, true);
        res.writeHead(204); return res.end();
      }
      if (m[2] === 'encerrar' && req.method === 'POST') {
        difundir(s, 'fim', {}, false); s.clientes.forEach(c => c.res.end()); sessoes.delete(m[1]);
        res.writeHead(204); return res.end();
      }
      return json(res, 405, { erro: 'Método não permitido.' });
    }

    /* --- páginas --- */
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    m = /^\/s\/([a-z0-9-]+)\/?$/.exec(p);
    if (m) {
      const s = sessoes.get(m[1]);
      if (!s) { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(PAG_404); }
      let html; try { html = prepararDeck(m[1], s.deck); } catch (_) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Deck indisponível.'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow',
        'Set-Cookie': 'ap=' + m[1] + '.' + assina(m[1]) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200'
          + (req.socket.encrypted || /^https/i.test(req.headers['x-forwarded-proto'] || '') ? '; Secure' : '') });   // Secure só em HTTPS (funciona também em http://localhost)
      return res.end(req.method === 'HEAD' ? undefined : html);
    }
    if (p === '/apresentar') return estatico(req, res, path.join(PUB, 'apresentar.html'), false);

    /* --- arquivos: só para quem abriu um link de sessão ativa --- */
    const slug = cookieSlug(req);
    if (p === '/' || !slug) {
      res.writeHead(p === '/' ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
      return res.end(p === '/' ? PAG_RESTRITO : PAG_404);
    }
    const rel = decodeURIComponent(p);
    let mm = /^\/_mira\/(sync\.js|mira-draw\.js)$/.exec(rel);          // módulos do cliente (iguais para todos os decks)
    if (mm) return estatico(req, res, mm[1] === 'sync.js' ? path.join(PUB, 'sync.js') : path.join(PUB, 'mira', 'mira-draw.js'), false);
    mm = /^\/_d\/([a-z0-9][a-z0-9._-]*)\/(.+)$/i.exec(rel);            // arquivos do deck da PRÓPRIA sessão
    if (mm && sessoes.get(slug).deck === mm[1] && !BLOQUEADO.test(mm[2])) {
      const raiz = path.join(DECKS, mm[1]), arq = path.normalize(path.join(raiz, mm[2]));
      if (!arq.startsWith(raiz + path.sep)) { res.writeHead(403); return res.end(); }
      return estatico(req, res, arq, !/\.html$/.test(arq));
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Não encontrado');
  } catch (e) {
    if (!res.headersSent) json(res, 400, { erro: 'Requisição inválida.' }); else res.end();
  }
});
servidor.keepAliveTimeout = 65e3;
if (require.main === module) servidor.listen(PORT, () => console.log('[mira-remoto] no ar na porta ' + PORT + ' · decks: ' + (listarDecks().join(', ') || '(nenhum)')));
module.exports = servidor;
