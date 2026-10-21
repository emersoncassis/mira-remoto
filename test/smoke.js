'use strict';
/* Teste de fumaça do mira-remoto: node test/smoke.js  (sem dependências) */
process.env.PRESENTER_KEY = 'chave-de-teste';
const assert = require('assert'), http = require('http');
const servidor = require('../server.js');

function sse(base, caminho, aoEvento) {
  const u = new URL(base + caminho);
  const req = http.get({ host: u.hostname, port: u.port, path: u.pathname + u.search }, res => {
    let buf = '';
    res.on('data', d => {
      buf += d;
      let i; while ((i = buf.indexOf('\n\n')) >= 0) {
        const bloco = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(bloco), da = /^data: (.+)$/m.exec(bloco);
        if (ev && da) aoEvento(ev[1], JSON.parse(da[1]));
      }
    });
  });
  return req;
}
const espera = (cond, ms = 3000) => new Promise((ok, no) => { const t0 = Date.now(); (function f() { if (cond()) return ok(); if (Date.now() - t0 > ms) return no(new Error('tempo esgotado')); setTimeout(f, 20); })(); });

servidor.listen(0, async () => {
  const base = 'http://127.0.0.1:' + servidor.address().port;
  const post = (p, corpo) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  let ok = 0; const passo = (nome) => console.log('ok ' + (++ok) + ' · ' + nome);
  try {
    assert.strictEqual((await fetch(base + '/saude')).status, 200); passo('saúde');
    const raiz = await (await fetch(base + '/')).text(); assert.match(raiz, /Acesso restrito/); passo('raiz mostra só "Acesso restrito"');
    assert.strictEqual((await fetch(base + '/s/nao-existe')).status, 404); passo('link inexistente dá 404');
    assert.strictEqual((await fetch(base + '/_d/demo-mira-remoto/index.html')).status, 404); passo('arquivos do deck sem sessão dão 404');
    assert.strictEqual((await fetch(base + '/apresentar')).status, 200); passo('/apresentar abre');

    assert.strictEqual((await fetch(base + '/api/decks', { headers: { 'X-Chave': 'errada' } })).status, 403); passo('lista de decks exige a chave');
    const dk = await (await fetch(base + '/api/decks', { headers: { 'X-Chave': 'chave-de-teste' } })).json();
    assert.ok(dk.decks.includes('demo-mira-remoto')); passo('lista inclui demo-mira-remoto');
    assert.strictEqual((await post('/api/sessoes', { chave: 'errada' })).status, 403); passo('chave errada não cria sessão');

    const r = await post('/api/sessoes', { chave: 'chave-de-teste', nome: 'Loja do João', deck: 'demo-mira-remoto' });
    assert.strictEqual(r.status, 201); const { slug, token } = await r.json(); assert.strictEqual(slug, 'loja-do-joao'); passo('sessão criada com slug limpo');
    assert.strictEqual((await post('/api/sessoes', { chave: 'chave-de-teste', nome: 'Loja do João' })).status, 409); passo('nome repetido dá 409');
    assert.strictEqual((await post('/api/sessoes', { chave: 'chave-de-teste', nome: 'x', deck: '../etc' })).status, 400); passo('deck inválido dá 400');

    const pg = await fetch(base + '/s/' + slug), html = await pg.text(), ck = pg.headers.get('set-cookie').split(';')[0];
    assert.strictEqual(pg.status, 200);
    assert.ok(html.includes('<base href="/_d/demo-mira-remoto/">')); assert.ok(html.includes('/_mira/sync.js')); assert.ok(html.includes('/_mira/mira-draw.js'));
    assert.ok(!/src="mira\/mira-draw\.js"/.test(html)); passo('deck entregue com <base>, sync.js e mira-draw.js do servidor');
    const H = { headers: { cookie: ck } };
    assert.strictEqual((await fetch(base + '/_d/demo-mira-remoto/assets/vendor/d3.v7.min.js', H)).status, 200); passo('assets do deck com cookie');
    assert.strictEqual((await fetch(base + '/_mira/sync.js', H)).status, 200); passo('sync.js com cookie');
    assert.strictEqual((await fetch(base + '/_d/demo-mira-remoto/references/x.pdf', H)).status, 404); passo('references/ nunca é entregue');
    assert.strictEqual((await fetch(base + '/_d/demo-mira-remoto/%2e%2e/%2e%2e/server.js', H)).status, 404); passo('path traversal bloqueado');
    assert.strictEqual((await fetch(base + '/_d/outro-deck/index.html', H)).status, 404); passo('cookie só vale para o deck da própria sessão');

    /* marca d'água e proteção são escolhidas por transmissão */
    const cfgDe = h => JSON.parse(/window\.__MIRA_REMOTO__=(\{.*?\});/.exec(h)[1]);
    assert.deepStrictEqual(cfgDe(html), { marcaDagua: true, protecao: true, marca: 'CONFIDENCIAL' }); passo('padrão: marca d\'água e proteção ligadas');
    for (const [nome, corpo, esperado] of [
      ['sem-nada', { marcaDagua: false, protecao: false }, { marcaDagua: false, protecao: false, marca: 'CONFIDENCIAL' }],
      ['so-marca', { marcaDagua: true, protecao: false, marca: 'Acme <b>"2026"</b>' }, { marcaDagua: true, protecao: false, marca: 'Acme b2026/b' }],
      ['so-protecao', { marcaDagua: false, protecao: true }, { marcaDagua: false, protecao: true, marca: 'CONFIDENCIAL' }]]) {
      const rr = await post('/api/sessoes', Object.assign({ chave: 'chave-de-teste', nome }, corpo)); assert.strictEqual(rr.status, 201);
      const jj = await rr.json(); assert.strictEqual(jj.marcaDagua, esperado.marcaDagua); assert.strictEqual(jj.protecao, esperado.protecao);
      const hh = await (await fetch(base + '/s/' + nome)).text(); assert.deepStrictEqual(cfgDe(hh), esperado);
      await post('/api/s/' + nome + '/encerrar', { k: jj.token });
    }
    passo('escolha por transmissão (sem nada, só marca, só proteção) chega ao deck e o texto é saneado');
    const dk2 = await (await fetch(base + '/api/decks', { headers: { 'X-Chave': 'chave-de-teste' } })).json();
    assert.deepStrictEqual(dk2.padrao, { marcaDagua: true, protecao: true, marca: 'CONFIDENCIAL' }); passo('/api/decks informa o padrão do servidor');

    const cli = [], pres = [];
    const c = sse(base, '/api/s/' + slug + '/eventos?c=abc123', (e, d) => cli.push([e, d]));
    const p = sse(base, '/api/s/' + slug + '/eventos?c=pres01&k=' + token, (e, d) => pres.push([e, d]));
    await espera(() => cli.length && pres.length);
    assert.strictEqual(cli[0][1].papel, 'cliente'); assert.strictEqual(pres[0][1].papel, 'apresentador'); passo('papéis: cliente e apresentador');
    assert.strictEqual((await post('/api/s/' + slug + '/estado', { k: 'falso', i: 2 })).status, 403); passo('só o apresentador muda o slide');
    await post('/api/s/' + slug + '/estado', { k: token, i: 3, shapes: [{ t: 'pen' }] });
    await espera(() => cli.some(x => x[0] === 'estado' && x[1].i === 3)); passo('slide 3 chegou ao cliente em tempo real');
    await post('/api/s/' + slug + '/pronto', { c: 'abc123', p: 100, ok: true });
    await espera(() => pres.some(x => x[0] === 'quem' && x[1].prontos === 1)); passo('apresentador vê "cliente pronto"');
    await post('/api/s/' + slug + '/encerrar', { k: token });
    await espera(() => cli.some(x => x[0] === 'fim')); passo('encerrar avisa o cliente');
    assert.strictEqual((await fetch(base + '/s/' + slug)).status, 404); passo('link some depois de encerrar');
    c.destroy(); p.destroy();
    console.log('\nTudo certo: ' + ok + ' verificações.'); servidor.close(); process.exit(0);
  } catch (e) { console.error('FALHOU:', e.message); process.exit(1); }
});
