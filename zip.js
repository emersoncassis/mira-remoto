'use strict';
/* Leitor mínimo de .zip, sem dependências (usa só zlib). Feito para receber decks: só leitura, com limites e proteção contra
   caminhos perigosos (zip slip), links simbólicos, arquivos cifrados e "bombas" de descompressão. */
const zlib = require('zlib'), fs = require('fs'), path = require('path');

class ErroZip extends Error { }
const erro = m => new ErroZip(m);

function lerEntradas(buf, lim) {
  lim = Object.assign({ entradas: 3000, descomprimido: 400e6, arquivo: 120e6 }, lim);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw erro('O arquivo não é um .zip válido.');
  const total = buf.readUInt16LE(eocd + 10), tamCd = buf.readUInt32LE(eocd + 12), offCd = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || tamCd === 0xffffffff || offCd === 0xffffffff) throw erro('Zip64 não é suportado. Compacte de novo com o zip padrão.');
  if (total > lim.entradas) throw erro('Arquivos demais no .zip (máximo ' + lim.entradas + ').');
  const saida = []; let p = offCd, soma = 0;
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw erro('Índice do .zip corrompido.');
    const flag = buf.readUInt16LE(p + 8), metodo = buf.readUInt16LE(p + 10), tamC = buf.readUInt32LE(p + 20), tam = buf.readUInt32LE(p + 24);
    const nNome = buf.readUInt16LE(p + 28), nExtra = buf.readUInt16LE(p + 30), nCom = buf.readUInt16LE(p + 32), attr = buf.readUInt32LE(p + 38), off = buf.readUInt32LE(p + 42);
    const nome = buf.toString((flag & 0x800) ? 'utf8' : 'utf8', p + 46, p + 46 + nNome);
    p += 46 + nNome + nExtra + nCom;
    if (flag & 1) throw erro('O .zip tem arquivos protegidos por senha.');
    if (tam === 0xffffffff || tamC === 0xffffffff) throw erro('Zip64 não é suportado.');
    const ehDir = nome.endsWith('/'), unixModo = (attr >>> 16) & 0xffff;
    if (!ehDir && (unixModo & 0xf000) === 0xa000) throw erro('Links simbólicos não são aceitos.');
    saida.push({ nome, ehDir, metodo, tamC, tam, off });
    if (!ehDir) { if (tam > lim.arquivo) throw erro('Há um arquivo grande demais no .zip (' + nome + ').'); soma += tam; if (soma > lim.descomprimido) throw erro('O conteúdo do .zip é grande demais.'); }
  }
  return saida;
}

function limparNome(nome) {                       // devolve o caminho relativo seguro, ou null para ignorar; lança para caminho perigoso
  const n = nome.replace(/\\/g, '/');
  if (/^\/|^[a-z]:|(^|\/)\.\.(\/|$)|\0/i.test(n)) throw erro('Caminho perigoso dentro do .zip: ' + nome);
  const partes = n.split('/').filter(x => x && x !== '.');
  if (!partes.length || partes[0] === '__MACOSX' || partes[partes.length - 1] === '.DS_Store' || partes[partes.length - 1] === 'Thumbs.db') return null;
  return partes.join('/');
}

function dadosDe(buf, e) {
  const p = e.off;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) throw erro('Entrada do .zip corrompida: ' + e.nome);
  const ini = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28), cru = buf.subarray(ini, ini + e.tamC);
  if (cru.length !== e.tamC) throw erro('.zip truncado: ' + e.nome);
  let d;
  if (e.metodo === 0) d = cru;
  else if (e.metodo === 8) { try { d = zlib.inflateRawSync(cru, { maxOutputLength: e.tam + 1 }); } catch (_) { throw erro('Não foi possível descompactar ' + e.nome); } }
  else throw erro('Método de compactação não suportado em ' + e.nome);
  if (d.length !== e.tam) throw erro('Tamanho inesperado em ' + e.nome);
  return d;
}

/* Extrai para `destino` (pasta nova). Se todo o conteúdo estiver dentro de uma única pasta, remove esse nível. Devolve {arquivos, bytes}. */
function extrair(buf, destino, lim) {
  const todas = lerEntradas(buf, lim).map(e => ({ e, rel: limparNome(e.nome) })).filter(x => x.rel);
  const arquivos = todas.filter(x => !x.e.ehDir);
  if (!arquivos.length) throw erro('O .zip está vazio.');
  let prefixo = '';
  if (!arquivos.some(x => x.rel === 'index.html')) {
    const topo = new Set(arquivos.map(x => x.rel.split('/')[0]));
    if (topo.size === 1 && arquivos.every(x => x.rel.includes('/'))) prefixo = [...topo][0] + '/';
  }
  if (!arquivos.some(x => x.rel === prefixo + 'index.html')) throw erro('Não encontrei o index.html na raiz do deck. O .zip deve conter a pasta do deck do Mira, com index.html.');
  const raiz = path.resolve(destino); let bytes = 0;
  fs.mkdirSync(raiz, { recursive: true });
  for (const { e, rel } of arquivos) {
    const r = prefixo && rel.startsWith(prefixo) ? rel.slice(prefixo.length) : rel;
    const alvo = path.resolve(raiz, r);
    if (!alvo.startsWith(raiz + path.sep)) throw erro('Caminho perigoso dentro do .zip: ' + e.nome);
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    const d = dadosDe(buf, e); fs.writeFileSync(alvo, d); bytes += d.length;
  }
  return { arquivos: arquivos.length, bytes };
}

module.exports = { extrair, lerEntradas, ErroZip };
