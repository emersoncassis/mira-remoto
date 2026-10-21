# Sugestão ao mira-animator: `/mira-remoto` (apresentar pela internet)

Para: Sandeco Macedo · De: Emerson de Carvalho Assis (aluno)
Repositório de referência: <https://github.com/emersoncassis/mira-remoto>

## Por que

O `/mira-remote` resolve a apresentação **na mesma rede**: notebook no palco, celular como controle e espelho. Na prática, muita apresentação comercial acontece com o cliente **em outra cidade**. Ele não alcança o IP do notebook, e hoje a saída é compartilhar a tela por videochamada, o que perde a animação fluida do Mira (a animação vira vídeo comprimido).

A sugestão é uma segunda camada, irmã da primeira: o mesmo deck, sem edição, servido por um servidor na internet, e o cliente abre um link.

## O que já existe e funciona

O mira-remoto é um servidor Node sem dependências (`server.js`, cerca de 270 linhas) mais um cliente (`sync.js`). Ele foi usado em uma apresentação comercial real e agora foi generalizado para servir qualquer deck do Mira:

- o deck é copiado para `decks/<nome>/`, sem alteração;
- o servidor injeta `<base>`, o `mira-draw.js` com a API de sincronia e o `sync.js` na hora de entregar a página;
- slide e desenho viajam por SSE, com *long polling* como via de reserva (o Quick Tunnel da Cloudflare não suporta SSE); a animação de cada slide roda local (Regra Zero preservada);
- pré-carregamento de tudo antes de o espectador ver o primeiro slide;
- link por apresentação, criado com uma chave, que deixa de valer ao encerrar;
- `references/` e arquivos de apoio nunca são entregues;
- `npm run tunel`: apresenta do próprio notebook por um túnel gratuito da Cloudflare, sem conta e sem domínio;
- deck de demonstração no próprio padrão do Mira e teste automatizado (33 verificações).

A API do `mira-draw.js` (`onchange`, `getShapes`, `setShapes`) que você já criou para o `/mira-remote` foi exatamente o que tornou isso possível sem tocar no módulo. O mira-remoto reaproveita o que o Mira já tem.

## Proposta de skill: `/mira-remoto`

Mesma lógica do `/mira-remote`: **copiar, não reescrever**.

1. Localizar o deck (a pasta com o `index.html`).
2. Copiar de `mira-templates/remoto/` para uma pasta de publicação: `server.js`, `public/` (`sync.js`, `apresentar.html`, `mira/mira-draw.js`), `Dockerfile`, `docker-compose.yml`.
3. Colocar o deck em `decks/<nome>/` dessa pasta (ou apontar `DECKS_DIR` para a pasta `decks/` do projeto Mira).
4. Se o deck usa CDN, sugerir `/mira-offline` antes.
5. Orientar: subir o servidor (local, Docker ou Dokploy), definir `PRESENTER_KEY`, abrir `/apresentar`, copiar o link do cliente.
6. Checklist: deck intacto, `references/` fora do alcance do espectador, chave definida, HTTPS no domínio.

Reversão: apagar a pasta de publicação; o deck original não foi tocado.

## Como o `/mira-remoto` se encaixa com o `/mira-remote`

| Situação | Skill |
|---|---|
| Sala, mesmo Wi-Fi, celular como controle | `/mira-remote` |
| Cliente em outra cidade, só assistindo | `/mira-remoto` |

Um possível passo seguinte é o apresentador usar o celular como controle também no mira-remoto (hoje ele conduz pelo teclado do computador).

## Pontos em aberto

- **Passos internos e módulos ao vivo.** O `/mira-remote` sincroniza `{slide, reveal}`; o mira-remoto sincroniza só o slide e o desenho. Mesa tática, quiz e survey rodam locais em cada tela.
- **Persistência.** As sessões ficam na memória; reiniciar o servidor encerra as transmissões abertas.
- **Autenticação.** Uma única chave de apresentador por servidor, suficiente para uso pessoal ou de uma equipe pequena.
- **Hospedagem.** Para demonstração basta o túnel gratuito (endereço muda a cada vez, sem garantia de disponibilidade). Para uso profissional, recomendo servidor com HTTPS e domínio próprio. Documentado para Docker e Dokploy.
- **Licença e atribuição.** O tema, a estrutura de slides e o `mira-draw.js` do deck de demonstração vêm do Mira. Se houver interesse em incorporar a ideia ao pacote, o código pode ser doado ou adaptado como você preferir.

## Como experimentar em 2 minutos

```bash
git clone https://github.com/emersoncassis/mira-remoto && cd mira-remoto
PRESENTER_KEY=teste node server.js
# abra http://localhost:3000/apresentar, escolha demo-mira-remoto, copie o link do cliente
```
