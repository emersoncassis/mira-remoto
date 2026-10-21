#!/usr/bin/env node
'use strict';
/* npm run tunel: sobe o mira-remoto e um Cloudflare Quick Tunnel (grátis, sem conta, sem domínio).
   Você recebe um endereço https://<nome>.trycloudflare.com que muda a cada execução.
   Variáveis: PORT (3000), PRESENTER_KEY (se faltar, gera uma chave forte), CLOUDFLARED (caminho do executável). */
const { spawn, spawnSync } = require('child_process'), http = require('http'), path = require('path'), crypto = require('crypto');

const PORT = String(process.env.PORT || 3000);
const CF = process.env.CLOUDFLARED || 'cloudflared';
const CHAVE = process.env.PRESENTER_KEY || crypto.randomBytes(9).toString('base64url');

const teste = spawnSync(CF, ['--version'], { encoding: 'utf8' });
if (teste.error || teste.status !== 0) {
  console.error(`
Não encontrei o cloudflared (o programa gratuito da Cloudflare que cria o túnel). Instale e rode de novo:

  Windows   winget install --id Cloudflare.cloudflared
  macOS     brew install cloudflared
  Linux     https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

Não precisa de conta nem de domínio.`);
  process.exit(1);
}

const filhos = [];
function encerrar(codigo) { filhos.forEach(f => { try { f.kill(); } catch (_) { } }); process.exit(codigo || 0); }
process.on('SIGINT', () => encerrar(0)); process.on('SIGTERM', () => encerrar(0));

const servidor = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')],
  { env: Object.assign({}, process.env, { PORT, PRESENTER_KEY: CHAVE }), stdio: ['ignore', 'inherit', 'inherit'] });
filhos.push(servidor);
servidor.on('exit', c => { console.error('O servidor parou.'); encerrar(c || 1); });

function noAr(tentativas) {
  http.get({ host: '127.0.0.1', port: PORT, path: '/saude' }, r => { r.resume(); r.statusCode === 200 ? abrirTunel() : repetir(tentativas); }).on('error', () => repetir(tentativas));
}
function repetir(n) { if (n <= 0) { console.error('O servidor não respondeu em /saude.'); return encerrar(1); } setTimeout(() => noAr(n - 1), 200); }

function abrirTunel() {
  const t = spawn(CF, ['tunnel', '--url', 'http://127.0.0.1:' + PORT, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'] });
  filhos.push(t);
  let achou = false;
  function ler(d) {
    const m = !achou && /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(String(d));
    if (!m) return; achou = true;
    console.log(`
╭──────────────────────────────────────────────────────────────╮
  mira-remoto no ar pela internet (Cloudflare Quick Tunnel)

  Para apresentar:  ${m[0]}/apresentar
  Chave de acesso:  ${CHAVE}

  Depois de criar a transmissão, copie o link do cliente na barra.
╰──────────────────────────────────────────────────────────────╯
  Atenção
  - O endereço muda toda vez que você roda este comando.
  - O túnel gratuito não tem garantia de disponibilidade: é bom para
    demonstração e reunião, não para algo crítico.
  - Seu computador precisa ficar ligado e online durante a apresentação.
  - Para uso profissional, prefira um domínio próprio (veja o README).
  Ctrl+C encerra o túnel e o servidor.
`);
  }
  t.stdout.on('data', ler); t.stderr.on('data', ler);
  t.on('exit', c => { console.error('O túnel parou (código ' + c + ').'); encerrar(c || 1); });
}
noAr(25);
