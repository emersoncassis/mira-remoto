'use strict';
/* Teste do limite de envios por pessoa (LIMITE_ENVIOS): node test/limite.js */
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib'), assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-up-'));
process.env.PRESENTER_KEY = 'k1'; process.env.UPLOADS_DIR = tmp; process.env.UPLOAD_MAX_MB = '1'; process.env.LIMITE_ENVIOS = '2';
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
  const zip1 = nome => zipDe({ 'index.html': '<html><head></head><body><section>' + nome + '</section></body></html>' });
  const envia = (nome, ipc) => fetch(b + '/api/decks?nome=' + nome, { method: 'POST', headers: { 'X-Chave': 'k1', 'Content-Type': 'application/zip', 'X-Forwarded-For': ipc }, body: zip1(nome) });
  const info = ipc => fetch(b + '/api/decks', { headers: { 'X-Chave': 'k1', 'X-Forwarded-For': ipc } }).then(r => r.json());
  try {
    assert.deepStrictEqual((await info('1.1.1.1')).envios, { limite: 2, usados: 0, restantes: 2 }); ok('informa o limite e o que sobra');
    let r = await envia('a1', '1.1.1.1'); assert.strictEqual(r.status, 201); assert.strictEqual((await r.json()).envios.restantes, 1); ok('1º envio passa');
    assert.strictEqual((await envia('a2', '1.1.1.1')).status, 201); ok('2º envio passa');
    r = await envia('a3', '1.1.1.1'); assert.strictEqual(r.status, 403); assert.match((await r.json()).erro, /2 envios/); assert.ok(!fs.existsSync(path.join(tmp, 'a3'))); ok('3º envio é recusado');
    assert.strictEqual((await fetch(b + '/api/decks/a1', { method: 'DELETE', headers: { 'X-Chave': 'k1', 'X-Forwarded-For': '1.1.1.1' } })).status, 200);
    assert.strictEqual((await envia('a4', '1.1.1.1')).status, 403); ok('excluir um deck não devolve o envio');
    assert.strictEqual((await envia('b1', '2.2.2.2')).status, 201); ok('outra pessoa (outro IP) tem a sua própria cota');
    assert.ok(!fs.readFileSync(path.join(tmp, '.envios.json'), 'utf8').includes('1.1.1.1')); ok('o IP não é gravado em claro');
    assert.deepStrictEqual(fs.readdirSync(tmp).filter(x => x === '.envios.json').length, 1);
    fs.rmSync(tmp, { recursive: true, force: true }); console.log('Limite de envios ok: ' + n + ' verificações.'); servidor.close(); process.exit(0);
  } catch (e) { console.log('FALHOU: ' + e.stack); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); }
});
