'use strict';
/* Teste do BASE_PATH (servidor numa subpasta, ex.: /apresenta): node test/base.js */
process.env.PRESENTER_KEY = 'k1'; process.env.BASE_PATH = '/apresenta';
const assert = require('assert'), servidor = require('../server.js');
servidor.listen(0, async () => {
  const b = 'http://127.0.0.1:' + servidor.address().port;
  try {
    for (const pre of ['', '/apresenta']) {            // com e sem o prefixo (o proxy pode ou não removê-lo)
      assert.strictEqual((await fetch(b + pre + '/apresentar')).status, 200);
      const r = await fetch(b + pre + '/api/sessoes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chave: 'k1', nome: 't' + pre.length, deck: 'demo-mira-remoto' }) });
      assert.strictEqual(r.status, 201); const j = await r.json();
      const pg = await fetch(b + pre + '/s/' + j.slug), h = await pg.text(), ck = pg.headers.get('set-cookie');
      assert.ok(h.includes('<base href="/apresenta/_d/demo-mira-remoto/">')); assert.ok(h.includes('src="/apresenta/_mira/sync.js"')); assert.ok(h.includes('"base":"/apresenta"'));
      assert.ok(/Path=\/apresenta;/.test(ck));
      const H = { headers: { cookie: ck.split(';')[0] } };
      assert.strictEqual((await fetch(b + pre + '/_d/demo-mira-remoto/assets/vendor/d3.v7.min.js', H)).status, 200);
      assert.strictEqual((await fetch(b + pre + '/_mira/sync.js', H)).status, 200);
    }
    for (const raiz of ['/apresenta', '/apresenta/']) { const x = await fetch(b + raiz); assert.strictEqual(x.status, 200); assert.match(await x.text(), /Iniciar apresentação ao vivo/); }   // a raiz da subpasta abre o formulário
    console.log('BASE_PATH ok'); servidor.close(); process.exit(0);
  } catch (e) { console.log('FALHOU: ' + e.message); process.exit(1); }
});
