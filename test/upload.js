'use strict';
/* Teste do envio de decks (.zip): node test/upload.js */
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib'), assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-up-'));
process.env.PRESENTER_KEY = 'k1'; process.env.UPLOADS_DIR = tmp; process.env.UPLOAD_MAX_MB = '1';
const servidor = require('../server.js');

function crc32(b) { let c, t = crc32.t || (crc32.t = Array.from({ length: 256 }, (_, n) => { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; })); let r = ~0; for (const x of b) r = t[(r ^ x) & 255] ^ (r >>> 8); return ~r >>> 0; }
function zipDe(arquivos, opc = {}) {            // arquivos: {nome: Buffer|string}; opc.store = sem compressão
  const loc = [], cen = []; let off = 0;
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    const d = Buffer.from(conteudo), nm = Buffer.from(nome), met = opc.store ? 0 : 8, c = met ? zlib.deflateRawSync(d) : d, crc = crc32(d);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(met, 8); h.writeUInt32LE(crc, 14); h.writeUInt32LE(c.length, 18); h.writeUInt32LE(d.length, 22); h.writeUInt16LE(nm.length, 26);
    const e = Buffer.alloc(46); e.writeUInt32LE(0x02014b50, 0); e.writeUInt16LE(20, 4); e.writeUInt16LE(20, 6); e.writeUInt16LE(met, 10); e.writeUInt32LE(crc, 16); e.writeUInt32LE(c.length, 20); e.writeUInt32LE(d.length, 24); e.writeUInt16LE(nm.length, 28); e.writeUInt32LE(off, 42);
    loc.push(h, nm, c); cen.push(e, nm); off += 30 + nm.length + c.length;
  }
  const cd = Buffer.concat(cen), f = Buffer.alloc(22); f.writeUInt32LE(0x06054b50, 0); f.writeUInt16LE(cen.length / 2, 8); f.writeUInt16LE(cen.length / 2, 10); f.writeUInt32LE(cd.length, 12); f.writeUInt32LE(off, 16);
  return Buffer.concat([...loc, cd, f]);
}

servidor.listen(0, async () => {
  const b = 'http://127.0.0.1:' + servidor.address().port; let n = 0; const ok = m => console.log('ok ' + (++n) + ' · ' + m);
  const envia = (nome, corpo, extra = '', chave = 'k1') => fetch(b + '/api/decks?nome=' + encodeURIComponent(nome) + extra, { method: 'POST', headers: { 'X-Chave': chave, 'Content-Type': 'application/zip' }, body: corpo });
  const lista = () => fetch(b + '/api/decks', { headers: { 'X-Chave': 'k1' } }).then(r => r.json());
  try {
    const bom = zipDe({ 'meu-deck/index.html': '<html><head></head><body><section>oi</section></body></html>', 'meu-deck/assets/a.txt': 'x'.repeat(5000), '__MACOSX/._x': 'lixo', 'meu-deck/.DS_Store': 'x' });
    assert.strictEqual((await envia('Meu Deck', bom, '', 'errada')).status, 403); ok('envio exige a chave');
    let r = await envia('Meu Deck.zip', bom); assert.strictEqual(r.status, 201); let j = await r.json(); assert.strictEqual(j.deck, 'meu-deck'); assert.strictEqual(j.arquivos, 2); ok('envia o .zip, remove a pasta de topo e o lixo do macOS');
    assert.ok(fs.existsSync(path.join(tmp, 'meu-deck', 'index.html')) && !fs.existsSync(path.join(tmp, 'meu-deck', '.DS_Store'))); ok('arquivos gravados no UPLOADS_DIR');
    let l = await lista(); assert.ok(l.decks.includes('meu-deck') && l.decks.includes('demo-mira-remoto') && l.enviados.includes('meu-deck') && !l.enviados.includes('demo-mira-remoto')); ok('a lista traz decks do projeto e enviados');
    assert.strictEqual((await envia('meu-deck', bom)).status, 409); ok('nome repetido dá 409');
    assert.strictEqual((await envia('demo-mira-remoto', bom, '&substituir=1')).status, 409); ok('não deixa sobrescrever deck do projeto');
    assert.strictEqual((await envia('meu-deck', zipDe({ 'index.html': '<html><head></head><body><section>novo</section></body></html>' }, { store: true }), '&substituir=1')).status, 201); ok('substitui com a opção marcada (arquivo sem compressão)');
    assert.match(fs.readFileSync(path.join(tmp, 'meu-deck', 'index.html'), 'utf8'), /novo/); assert.ok(!fs.existsSync(path.join(tmp, 'meu-deck', 'assets'))); ok('a substituição troca tudo');
    assert.strictEqual((await envia('x1', zipDe({ '../fora.txt': 'x', 'index.html': 'a' }))).status, 400); assert.ok(!fs.existsSync(path.join(tmp, '..', 'fora.txt'))); ok('zip slip bloqueado');
    assert.strictEqual((await envia('x2', zipDe({ 'a/b.txt': 'x' }))).status, 400); ok('sem index.html dá 400');
    assert.strictEqual((await envia('x3', Buffer.from('não sou um zip'))).status, 400); ok('arquivo que não é zip dá 400');
    assert.strictEqual((await envia('x4', Buffer.alloc(1.2 * 1048576, 1))).status, 413); ok('acima do limite dá 413');
    assert.deepStrictEqual(fs.readdirSync(tmp).filter(x => x.startsWith('.tmp-')), []); ok('não sobra pasta temporária');
    const rs0 = await fetch(b + '/api/sessoes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chave: 'k1', nome: 'um', deck: 'meu-deck' }) });
    const rs = rs0; assert.strictEqual(rs.status, 201); const j2 = await rs.json(); const pg = await fetch(b + '/s/um'), ck = pg.headers.get('set-cookie').split(';')[0], h = await pg.text();
    assert.ok(h.includes('<base href="/_d/meu-deck/">') && h.includes('novo')); ok('o deck enviado entra em transmissão');
    assert.strictEqual((await fetch(b + '/_d/meu-deck/index.html', { headers: { cookie: ck } })).status, 200); ok('arquivos do deck enviado são servidos com o cookie');
    const del = id => fetch(b + '/api/decks/' + id, { method: 'DELETE', headers: { 'X-Chave': 'k1' } });
    assert.strictEqual((await del('meu-deck')).status, 409); ok('não exclui deck em transmissão');
    assert.strictEqual((await del('demo-mira-remoto')).status, 404); ok('não exclui deck do projeto');
    assert.strictEqual((await fetch(b + '/api/decks/meu-deck', { method: 'DELETE', headers: { 'X-Chave': 'errada' } })).status, 403); ok('excluir exige a chave');
    const tk = j2.token;
    await fetch(b + '/api/s/um/encerrar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ k: tk }) });
    assert.strictEqual((await del('meu-deck')).status, 200); assert.ok(!fs.existsSync(path.join(tmp, 'meu-deck'))); ok('exclui o deck enviado depois de encerrar a transmissão');
    fs.rmSync(tmp, { recursive: true, force: true }); console.log('Envio de decks ok: ' + n + ' verificações.'); servidor.close(); process.exit(0);
  } catch (e) { console.log('FALHOU: ' + e.stack); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); }
});
