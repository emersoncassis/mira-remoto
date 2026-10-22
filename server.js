'use strict';
/* mira-remoto: servidor de apresentação ao vivo para decks do Mira (mira-animator).
   Zero dependências. Serve qualquer deck de decks/<nome>/ e sincroniza o apresentador com
   os espectadores por SSE (Server-Sent Events).

   Variáveis de ambiente:
     PORT           porta (3000)
     PRESENTER_KEY  chave de quem apresenta (se faltar, é gerada e mostrada no log)
     DECKS_DIR      pasta dos decks que vêm no projeto (./decks), somente leitura
     UPLOADS_DIR    pasta dos decks enviados pela tela /apresentar (./uploads). Em produção, monte um volume aqui
     UPLOAD_MAX_MB  tamanho máximo do .zip enviado (150)
     LIMITE_ENVIOS  máximo de envios de deck por pessoa (por IP), somando todos os envios feitos; 0 = sem limite (padrão)
     PROTEGER       padrão da tela /apresentar: 1 = marca d'água e proteção ligadas, 0 = desligadas
     MARCA          texto padrão da marca d'água (CONFIDENCIAL)
     BASE_PATH      prefixo quando o servidor roda numa subpasta do domínio, ex.: /apresenta (padrão: vazio, na raiz)
   Marca d'água e proteção são escolhidas a cada transmissão em /apresentar; estas duas só definem o padrão. */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PORT = +process.env.PORT || 3000;
const zip = require('./zip.js');
const PUB = path.join(__dirname, 'public');
const DECKS = path.resolve(process.env.DECKS_DIR || path.join(__dirname, 'decks'));
const UPLOADS = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, 'uploads'));
const UPLOAD_MAX = Math.max(1, +process.env.UPLOAD_MAX_MB || 150) * 1048576;
const LIMITE_ENVIOS = Math.max(0, parseInt(process.env.LIMITE_ENVIOS, 10) || 0);
const PROTEGER = process.env.PROTEGER !== '0';
const BASE = ('/' + String(process.env.BASE_PATH || '').replace(/^\/+|\/+$/g, '')).replace(/^\/$/, '').replace(/[^a-z0-9/_.-]/gi, '');   // '' ou '/apresenta'
const MARCA = String(process.env.MARCA || 'CONFIDENCIAL').slice(0, 40);
const bool = (v, padrao) => typeof v === 'boolean' ? v : padrao;
const limpaMarca = v => String(v == null ? '' : v).replace(/[\u0000-\u001f<>&"]/g, '').trim().slice(0, 40) || MARCA;
let KEY = process.env.PRESENTER_KEY || '';
if (!KEY) { KEY = crypto.randomBytes(6).toString('hex'); console.log('[mira-remoto] PRESENTER_KEY não definida; chave temporária: ' + KEY); }

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.ico': 'image/x-icon' };

/* Nunca entregues ao espectador: fontes do deck (references/), roteiros, scripts e arquivos ocultos. */
const BLOQUEADO = /(^|\/)(references|node_modules)(\/|$)|(^|\/)\.|\.(md|cjs|bat|command|sh|ps1|map)$/i;

/* ---------- decks ---------- */
const NOME_DECK = /^[a-z0-9][a-z0-9._-]*$/i;
function listarEm(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && NOME_DECK.test(e.name) && fs.existsSync(path.join(dir, e.name, 'index.html')))
      .map(e => e.name);
  } catch (_) { return []; }
}
/* Contagem de envios por pessoa (IP), guardada em UPLOADS_DIR/.envios.json para sobreviver a reinícios. Excluir um deck não devolve o envio. */
const ARQ_ENVIOS = () => path.join(UPLOADS, '.envios.json');
let envios = null;
const chaveEnvio = i => crypto.createHash('sha256').update('envios:' + i).digest('hex').slice(0, 24);   // não guarda o IP em claro
function carregaEnvios() { if (!envios) { try { envios = JSON.parse(fs.readFileSync(ARQ_ENVIOS(), 'utf8')); } catch (_) { envios = {}; } } return envios; }
function usadosEnvios(i) { return carregaEnvios()[chaveEnvio(i)] || 0; }
function contaEnvio(i) { const e = carregaEnvios(), k = chaveEnvio(i); e[k] = (e[k] || 0) + 1; try { fs.mkdirSync(UPLOADS, { recursive: true }); fs.writeFileSync(ARQ_ENVIOS() + '.tmp', JSON.stringify(e)); fs.renameSync(ARQ_ENVIOS() + '.tmp', ARQ_ENVIOS()); } catch (x) { console.error('[mira-remoto] não gravou a contagem de envios:', x.message); } }
function infoEnvios(i) { const u = usadosEnvios(i); return { limite: LIMITE_ENVIOS, usados: u, restantes: LIMITE_ENVIOS ? Math.max(0, LIMITE_ENVIOS - u) : null }; }

function listarDecks() { return [...new Set([...listarEm(DECKS), ...listarEm(UPLOADS)])].sort(); }
function listarEnviados() { const base = listarEm(DECKS); return listarEm(UPLOADS).filter(n => !base.includes(n)).sort(); }
function pastaDoDeck(nome) {                      // os decks do projeto têm prioridade; depois os enviados
  if (!NOME_DECK.test(nome)) return null;
  for (const dir of [DECKS, UPLOADS]) { const p = path.join(dir, nome); if (fs.existsSync(path.join(p, 'index.html'))) return p; }
  return null;
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
  s.clientes.forEach(c => { if (c.res && (!soClientes || !c.apresentador)) enviar(c.res, evento, dados); });
}
function resumo(s) {
  let n = 0, prontos = 0, min = 100;
  s.clientes.forEach(c => { if (c.apresentador) return; n++; if (c.pronto) prontos++; else min = Math.min(min, c.pct || 0); });
  return { clientes: n, prontos, pct: prontos === n ? 100 : Math.round(min) };
}
function avisarContagem(s) { const r = resumo(s); s.q = (s.q || 0) + 1; s.clientes.forEach(c => { if (c.apresentador && c.res) enviar(c.res, 'quem', r); }); acordar(s, true); }

/* ---------- long polling: segunda via de sincronia, para quando o SSE não passa (Cloudflare Quick Tunnel, proxies que seguram o streaming) ----------
   O cliente pergunta "mudou algo desde a versão v?". Se mudou, a resposta sai na hora; se não, o servidor segura a requisição por até 20 s. */
const POLL_MS = +process.env.POLL_MS || 20e3, POLL_VIVO_MS = 45e3;   // 20 s fica abaixo do limite de 100 s do Cloudflare
function cargaPoll(s, c, primeiro) {
  const o = Object.assign({ v: s.v, q: s.q }, resumo(s));
  if (!c.apresentador) { o.i = s.i; o.shapes = s.shapes; } else o.t = s.toque || null;
  if (primeiro) o.papel = c.apresentador ? 'apresentador' : 'cliente';
  return o;
}
function acordar(s, soApresentadores) {              // libera quem está esperando; o cliente volta a perguntar com a versão nova
  if (!s.espera) return;
  s.espera.forEach(w => { if (!soApresentadores || w.c.apresentador) { clearTimeout(w.t); s.espera.delete(w); w.c.visto = Date.now(); json(w.res, 200, cargaPoll(s, w.c, false)); } });
}

function batimento() { sessoes.forEach(s => s.clientes.forEach(c => { if (c.res) c.res.write(': ♥\n\n'); })); }
setInterval(() => {
  const agora = Date.now();
  sessoes.forEach((s, slug) => { if (s.clientes.size === 0 && agora - s.ultimo > TTL_MS) sessoes.delete(slug); });
}, 60e3).unref();
setInterval(() => {                                   // quem pergunta por polling e sumiu deixa de contar
  const agora = Date.now();
  sessoes.forEach(s => { let mudou = false; s.clientes.forEach(c => { if (c.poll && agora - c.visto > POLL_VIVO_MS) { s.clientes.delete(c); mudou = true; } }); if (mudou) avisarContagem(s); });
}, 15e3).unref();
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
/* Metadados do link (prévia no WhatsApp, Telegram, Slack, e-mail): título e descrição vêm do próprio deck
   (<title> e <meta name="description">); a imagem é og.jpg/png/webp na raiz do deck, servida em /s/<slug>/og
   sem exigir cookie, porque o robô que gera a prévia não tem sessão. */
const OG_ARQ = ['og.jpg', 'og.jpeg', 'og.png', 'og.webp'];
function imagemOg(deck) { const raiz = pastaDoDeck(deck); if (!raiz) return null; for (const n of OG_ARQ) { const a = path.join(raiz, n); if (fs.existsSync(a)) return a; } return null; }
const escAttr = t => String(t).replace(/&(?!(?:[a-z]+|#\d+);)/gi, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function metaLink(html, slug, deck, req) {
  const tit = (/<title[^>]*>([^<]*)<\/title>/i.exec(html) || [])[1] || deck;
  const tagD = /<meta\b[^>]*name=["']description["'][^>]*>/i.exec(html);
  const desc = (tagD && /content=["']([^"']*)["']/i.exec(tagD[0]) || [])[1] || 'Apresentação ao vivo: você acompanha em tempo real, direto no navegador.';
  const proto = (req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')).split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const url = proto + '://' + host + BASE + '/s/' + slug;
  const img = imagemOg(deck) ? url + '/og' : null;
  const t = escAttr(tit.trim()), d = escAttr(desc.trim());
  html = html.replace(/<meta\b[^>]*(?:property|name)=["'](?:og|twitter):[^>]*>/gi, '');
  if (!tagD) html = html.replace(/<head\b[^>]*>/i, m => m + '<meta name="description" content="' + d + '">');
  return html.replace(/<head\b[^>]*>/i, m => m
    + '<meta property="og:type" content="website"><meta property="og:site_name" content="' + 'Mira Remoto' + '">'
    + '<meta property="og:title" content="' + t + '"><meta property="og:description" content="' + d + '"><meta property="og:url" content="' + escAttr(url) + '">'
    + '<meta property="og:locale" content="pt_BR">'
    + (img ? '<meta property="og:image" content="' + escAttr(img) + '"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:image" content="' + escAttr(img) + '">' : '')
    + '<meta name="twitter:card" content="' + (img ? 'summary_large_image' : 'summary') + '"><meta name="twitter:title" content="' + t + '"><meta name="twitter:description" content="' + d + '">'
    + '<meta name="theme-color" content="#0B0F0D">');
}

function prepararDeck(slug, s, req) {
  const deck = s.deck;
  let html = fs.readFileSync(path.join(pastaDoDeck(deck), 'index.html'), 'utf8');
  const base = '<base href="' + BASE + '/_d/' + deck + '/">';
  html = /<base\b[^>]*>/i.test(html) ? html.replace(/<base\b[^>]*>/i, base) : html.replace(/<head\b[^>]*>/i, m => m + base);
  html = metaLink(html, slug, deck, req);
  html = html.replace(/<script\b[^>]*mira-draw[^>]*>\s*<\/script>/gi, '');        // usa a versão do servidor, que tem a API de sincronia
  html = html.replace(/<script\b[^>]*\bsync\.js[^>]*>\s*<\/script>/gi, '');
  const cfg = JSON.stringify({ marcaDagua: s.marcaDagua, protecao: s.protecao, marca: s.marca, base: BASE }).replace(/</g, '\\u003c');
  const tags = '<script>window.__MIRA_REMOTO__=' + cfg + ';</script>'
    + '<script defer src="' + BASE + '/_mira/mira-draw.js"></script><script defer src="' + BASE + '/_mira/sync.js"></script>';
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, tags + '</body>') : html + tags;
}

const ESTILO_PAG = 'margin:0;min-height:100vh;display:grid;place-items:center;background:#0B0F0D;color:#F2FFF8;font:18px/1.5 system-ui,sans-serif;text-align:center;padding:24px';
const PAG_404 = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Apresentação</title><body style="' + ESTILO_PAG + '"><div><h1 style="font-size:1.4rem">Esta apresentação não está no ar</h1><p style="opacity:.7">O link pode estar errado ou a transmissão já foi encerrada. Peça um novo link a quem apresenta.</p></div>';
const PAG_RESTRITO = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Acesso restrito</title><body style="' + ESTILO_PAG + '"><div><h1 style="font-size:1.4rem">Acesso restrito</h1><p style="opacity:.7">Esta apresentação é exibida apenas para convidados, por link enviado por quem apresenta.</p></div>';

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = url.pathname;
  if (BASE && (p === BASE || p.startsWith(BASE + '/'))) p = p.slice(BASE.length) || '/';        // o proxy pode ou não remover o prefixo
  try {
    if (p === '/saude') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }

    /* --- API --- */
    if (p === '/api/decks' && req.method === 'GET') {              // só com a chave: não vaza o nome dos seus decks
      const a = ip(req);
      if (bloqueado(a)) return json(res, 429, { erro: 'Muitas tentativas. Aguarde alguns minutos.' });
      if (!igualSeg(req.headers['x-chave'] || '', KEY)) { falhou(a); return json(res, 403, { erro: 'Chave incorreta.' }); }
      return json(res, 200, { decks: listarDecks(), enviados: listarEnviados(), envios: infoEnvios(a), padrao: { marcaDagua: PROTEGER, protecao: PROTEGER, marca: MARCA } });
    }
    if (p === '/api/decks' && req.method === 'POST') {            // envio de um deck pronto (.zip), só com a chave
      const a = ip(req);
      if (bloqueado(a)) return json(res, 429, { erro: 'Muitas tentativas. Aguarde alguns minutos.' });
      if (!igualSeg(req.headers['x-chave'] || '', KEY)) { falhou(a); return json(res, 403, { erro: 'Chave incorreta.' }); }
      if (LIMITE_ENVIOS && usadosEnvios(a) >= LIMITE_ENVIOS) return json(res, 403, { erro: 'Você já usou os ' + LIMITE_ENVIOS + ' envios permitidos neste ambiente de teste.', envios: infoEnvios(a) });
      if (+req.headers['content-length'] > UPLOAD_MAX) { res.setHeader('Connection', 'close'); return json(res, 413, { erro: 'Arquivo grande demais (máximo ' + Math.round(UPLOAD_MAX / 1048576) + ' MB).' }); }
      const nome = String(url.searchParams.get('nome') || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\.zip$/i, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^[-._]+|[-.]+$/g, '').slice(0, 60);
      if (!nome || !NOME_DECK.test(nome)) return json(res, 400, { erro: 'Dê um nome ao deck (letras, números, ponto, hífen e sublinhado).' });
      if (listarEm(DECKS).includes(nome)) return json(res, 409, { erro: 'Já existe um deck do projeto com esse nome. Escolha outro.' });
      const existe = listarEm(UPLOADS).includes(nome), substituir = url.searchParams.get('substituir') === '1';
      if (existe && !substituir) return json(res, 409, { erro: 'Já existe um deck enviado com esse nome. Marque "substituir" ou escolha outro nome.' });
      if (existe) for (const s of sessoes.values()) if (s.deck === nome) return json(res, 409, { erro: 'Esse deck está em transmissão agora. Encerre antes de substituir.' });
      const partes = []; let n = 0;
      try {
        await new Promise((ok, no) => {
          req.on('data', d => { n += d.length; if (n > UPLOAD_MAX) { no(new Error('GRANDE')); } else partes.push(d); });
          req.on('end', ok); req.on('error', no); req.on('aborted', () => no(new Error('ABORT')));
        });
      } catch (e) { return json(res, e.message === 'GRANDE' ? 413 : 400, { erro: e.message === 'GRANDE' ? 'Arquivo grande demais (máximo ' + Math.round(UPLOAD_MAX / 1048576) + ' MB).' : 'Envio interrompido.' }); }
      const tmp = path.join(UPLOADS, '.tmp-' + crypto.randomBytes(6).toString('hex'));
      try {
        fs.mkdirSync(UPLOADS, { recursive: true });
        const r = zip.extrair(Buffer.concat(partes), tmp);
        const final = path.join(UPLOADS, nome);
        if (existe) fs.rmSync(final, { recursive: true, force: true });
        fs.renameSync(tmp, final);
        contaEnvio(a);
        return json(res, 201, { deck: nome, arquivos: r.arquivos, bytes: r.bytes, substituido: existe, envios: infoEnvios(a) });
      } catch (e) {
        fs.rmSync(tmp, { recursive: true, force: true });
        if (e instanceof zip.ErroZip) return json(res, 400, { erro: e.message });
        console.error('[mira-remoto] falha no envio do deck:', e.message); return json(res, 500, { erro: 'Não foi possível salvar o deck no servidor.' });
      }
    }
    let md = /^\/api\/decks\/([a-z0-9][a-z0-9._-]*)$/i.exec(p);
    if (md && req.method === 'DELETE') {                          // só apaga decks enviados, nunca os do projeto
      const a = ip(req);
      if (bloqueado(a)) return json(res, 429, { erro: 'Muitas tentativas. Aguarde alguns minutos.' });
      if (!igualSeg(req.headers['x-chave'] || '', KEY)) { falhou(a); return json(res, 403, { erro: 'Chave incorreta.' }); }
      if (!listarEnviados().includes(md[1])) return json(res, 404, { erro: 'Deck enviado não encontrado.' });
      for (const s of sessoes.values()) if (s.deck === md[1]) return json(res, 409, { erro: 'Esse deck está em transmissão agora. Encerre antes de excluir.' });
      fs.rmSync(path.join(UPLOADS, md[1]), { recursive: true, force: true });
      return json(res, 200, { ok: true });
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
      const marcaDagua = bool(b.marcaDagua, PROTEGER), protecao = bool(b.protecao, PROTEGER), marca = limpaMarca(b.marca);
      sessoes.set(slug, { deck, token, marcaDagua, protecao, marca, i: 0, v: 1, q: 1, espera: new Set(), shapes: [], clientes: new Set(), ultimo: Date.now() });
      return json(res, 201, { slug, token, deck, marcaDagua, protecao, marca });
    }
    let m = /^\/api\/s\/([a-z0-9-]+)\/toque$/.exec(p);                 // o cliente tocou na tela: avisa quem apresenta
    if (m && req.method === 'POST') {
      const s = sessoes.get(m[1]); if (!s) return json(res, 404, { erro: 'Sessão não encontrada.' });
      const b = await corpo(req, 2e3), id = String(b.c || '').replace(/[^a-z0-9]/gi, '').slice(0, 32);
      let ok = false; s.clientes.forEach(c => { if (!c.apresentador && id && c.id === id) ok = true; });
      const agora = Date.now();
      if (ok && agora - (s.tToque || 0) >= 700) {
        s.tToque = agora; const f = v => Math.max(0, Math.min(1, +v || 0));
        s.toque = { n: (s.nt = (s.nt || 0) + 1), x: f(b.x), y: f(b.y), i: Math.max(0, Math.min(999, b.i | 0)) };
        s.clientes.forEach(c => { if (c.apresentador && c.res) enviar(c.res, 'toque', s.toque); });
        s.q = (s.q || 0) + 1; acordar(s, true);
      }
      res.writeHead(204); return res.end();
    }
    m = /^\/api\/s\/([a-z0-9-]+)\/pronto$/.exec(p);
    if (m && req.method === 'POST') {
      const s = sessoes.get(m[1]); if (!s) return json(res, 404, { erro: 'Sessão não encontrada.' });
      const b = await corpo(req, 2e3), id = String(b.c || '').replace(/[^a-z0-9]/gi, '').slice(0, 32);
      s.clientes.forEach(c => { if (!c.apresentador && id && c.id === id) { c.pct = Math.max(0, Math.min(100, +b.p || 0)); c.pronto = b.ok === true; } });
      avisarContagem(s); res.writeHead(204); return res.end();
    }
    m = /^\/api\/s\/([a-z0-9-]+)\/poll$/.exec(p);
    if (m && req.method === 'GET') {
      const s = sessoes.get(m[1]); if (!s) return json(res, 404, { erro: 'Sessão não encontrada.' });
      const id = String(url.searchParams.get('c') || '').replace(/[^a-z0-9]/gi, '').slice(0, 32);
      if (!id) return json(res, 400, { erro: 'Falta o identificador.' });
      const apresentador = igualSeg(url.searchParams.get('k') || '', s.token);
      let c = null; s.clientes.forEach(x => { if (x.poll && x.id === id) c = x; });
      const novo = !c;
      if (novo) { c = { res: null, poll: true, apresentador, id, pct: 0, pronto: false }; s.clientes.add(c); }
      c.visto = Date.now(); s.ultimo = Date.now();
      if (novo) avisarContagem(s);
      const v = +url.searchParams.get('v'), q = +url.searchParams.get('q');
      if (novo || v !== s.v || (apresentador && q !== s.q)) return json(res, 200, cargaPoll(s, c, novo || !Number.isFinite(v) || v < 0));
      const w = { res, c, t: setTimeout(() => { s.espera.delete(w); c.visto = Date.now(); json(res, 200, cargaPoll(s, c, false)); }, POLL_MS) };
      s.espera.add(w); req.on('close', () => { clearTimeout(w.t); s.espera.delete(w); });
      return;
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
        s.i = i; if (Array.isArray(b.shapes)) s.shapes = b.shapes.slice(0, 500); s.ultimo = Date.now(); s.v++;
        difundir(s, 'estado', { i: s.i, shapes: s.shapes }, true); acordar(s, false);
        res.writeHead(204); return res.end();
      }
      if (m[2] === 'encerrar' && req.method === 'POST') {
        difundir(s, 'fim', {}, false); s.clientes.forEach(c => { if (c.res) c.res.end(); });
        s.espera.forEach(w => { clearTimeout(w.t); json(w.res, 200, { fim: true }); }); s.espera.clear(); sessoes.delete(m[1]);
        res.writeHead(204); return res.end();
      }
      return json(res, 405, { erro: 'Método não permitido.' });
    }

    /* --- páginas --- */
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    m = /^\/s\/([a-z0-9-]+)\/og$/.exec(p);                         // imagem da prévia do link (pública, só desta sessão ativa)
    if (m) {
      const so = sessoes.get(m[1]), ai = so && imagemOg(so.deck);
      if (!ai) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Sem imagem'); }
      return estatico(req, res, ai, true);
    }
    m = /^\/s\/([a-z0-9-]+)\/?$/.exec(p);
    if (m) {
      const s = sessoes.get(m[1]);
      if (!s) { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(PAG_404); }
      let html; try { html = prepararDeck(m[1], s, req); } catch (_) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Deck indisponível.'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow',
        'Set-Cookie': 'ap=' + m[1] + '.' + assina(m[1]) + '; Path=' + (BASE || '/') + '; HttpOnly; SameSite=Lax; Max-Age=43200'
          + (req.socket.encrypted || /^https/i.test(req.headers['x-forwarded-proto'] || '') ? '; Secure' : '') });   // Secure só em HTTPS (funciona também em http://localhost)
      return res.end(req.method === 'HEAD' ? undefined : html);
    }
    if (p === '/apresentar' || (BASE && p === '/')) return estatico(req, res, path.join(PUB, 'apresentar.html'), false);

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
      const raiz = pastaDoDeck(mm[1]); if (!raiz) { res.writeHead(404); return res.end(); }
      const arq = path.normalize(path.join(raiz, mm[2]));
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
