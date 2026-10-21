# mira-remoto

Apresente um deck do [Mira](https://github.com/sandeco/mira-animator) ao vivo para quem está longe. Você conduz; a tela de quem assiste acompanha em tempo real, com o desenho da caneta (`P`). Basta mandar um link. Não é preciso editar o deck.

Complementa o `/mira-remote-control` do Mira, que espelha o deck **na mesma rede**. O mira-remoto leva o deck **pela internet**.

## Início rápido

```bash
PRESENTER_KEY=minha-chave node server.js
```

1. Abra `http://localhost:3000/apresentar`, digite a chave e escolha o deck (o repositório traz `demo-mira-remoto`, que explica o próprio projeto).
2. Em **Para quem assiste**, escolha marca d'água e proteção.
3. Clique em **Copiar link do cliente** e envie. Setas e Espaço trocam o slide, `P` liga a caneta, `F` abre a tela cheia, **Encerrar** termina.

Requer Node 18 ou superior. Sem dependências.

## Pela internet, sem domínio (túnel gratuito)

Instale o [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) (`winget install --id Cloudflare.cloudflared` no Windows, `brew install cloudflared` no macOS) e rode:

```bash
npm run tunel
```

Ele sobe o servidor e um Cloudflare Quick Tunnel e mostra `https://<nome>.trycloudflare.com/apresentar` e a chave. Sem conta e sem domínio. Ctrl+C encerra tudo.

Limites do túnel gratuito:
- o endereço muda a cada execução;
- sem garantia de disponibilidade (indicado para teste e demonstração);
- até 200 requisições simultâneas;
- seu computador precisa ficar ligado e online, e o seu upload serve o deck;
- não suporta SSE: o mira-remoto troca sozinho para *long polling*.

**Para uso profissional, prefira domínio próprio:** endereço fixo com a sua marca, sem depender do seu computador. Use um servidor com HTTPS (seção Deploy) ou um Cloudflare Tunnel nomeado com domínio seu.

## Colocar o seu deck do Mira

1. Copie a pasta do deck (a que tem o `index.html`) para `decks/`: `cp -r meu-deck decks/meu-deck`
2. Reinicie o servidor. O deck aparece em `/apresentar`.

O servidor injeta `<base>`, o `mira-draw.js` com a API de sincronia e o `sync.js` na hora de entregar a página. O deck original não é alterado e segue abrindo por `file://`.

O deck precisa de:
- `index.html` na raiz da pasta;
- slides como `<section>` filhos diretos do `<body>` (padrão do Mira);
- caminhos relativos para os recursos;
- sem CDN, para não depender de internet nem de firewall. Se usar, rode antes o `/mira-offline`.

Nunca são entregues ao espectador: `references/`, arquivos `.md`, `.cjs`, `.bat`, `.command`, `.sh`, `.ps1`, `.map` e arquivos ocultos.

## Recursos

- Qualquer deck do Mira, vários no mesmo servidor.
- Link por transmissão (`/s/<nome>`) que deixa de valer ao encerrar.
- Slide e desenho sincronizados; a animação de cada slide roda local (a Regra Zero do Mira continua valendo).
- Pré-carregamento: o espectador só vê o deck depois de baixar tudo, e você vê "✔ Cliente pronto, pode iniciar".
- **Marca d'água** (nome do link, código do visitante, data e texto seu) e **proteção** (sem copiar nem imprimir, tela preta ao perder o foco), escolhidas a cada transmissão, juntas, separadas ou nenhuma.

## Deploy

**Docker**

```bash
docker build -t mira-remoto .
docker run -d -p 3000:3000 -e PRESENTER_KEY=minha-chave mira-remoto
```

Ou `PRESENTER_KEY=minha-chave docker compose up -d --build`. Para adicionar decks sem rebuildar: `-v $(pwd)/decks:/app/decks:ro`.

**Dokploy (recomendado: aplicação com Dockerfile):** crie uma *Application*, fonte Git deste repositório, branch `main`, Build Type `Dockerfile`. Em *Environment*, defina `PRESENTER_KEY` (e `BASE_PATH` se for numa subpasta, ex.: `/apresenta`). Em *Domains*, porta `3000`, HTTPS ligado e, se for subpasta, o mesmo caminho em *Path* (sem *Strip Path*). Para trocar a chave, altere a variável e faça novo deploy. Pelo *Compose* (`docker-compose.yml`) também funciona, mas algumas versões do Dokploy falham ao gravar o `.env` ao lado do arquivo.

| Variável | Padrão | Função |
|---|---|---|
| `PRESENTER_KEY` | gerada no log | chave de quem apresenta |
| `PORT` | `3000` | porta |
| `DECKS_DIR` | `./decks` | pasta dos decks |
| `PROTEGER` | `1` | `0` abre o formulário com marca d'água e proteção desmarcadas |
| `MARCA` | `CONFIDENCIAL` | texto padrão da marca d'água |
| `BASE_PATH` | vazio | prefixo quando roda numa subpasta do domínio, ex.: `/apresenta` (então `/apresenta` abre a tela de apresentar, que também fica em `/apresenta/apresentar`, e o link do cliente fica em `/apresenta/s/<nome>`) |
| `POLL_MS` | `20000` | tempo que o servidor segura cada pergunta do polling (ms) |

## Segurança e limites

- A raiz mostra só "Acesso restrito". O deck só é entregue a quem abre o link de uma transmissão ativa (cookie assinado).
- Criar transmissão e listar decks exigem a chave, com limite de 6 tentativas erradas a cada 10 minutos por IP.
- Sem marca d'água e sem proteção, o espectador pode copiar, imprimir e tirar print. Nenhum navegador impede foto da tela; a marca d'água serve para identificar quem vazou.
- Sincroniza **slide e desenho**. Passos internos de um slide, quiz, survey e mesa tática do Mira não são espelhados.
- As sessões ficam na memória: reiniciar o servidor encerra as transmissões abertas.

## Como funciona

O apresentador publica `{slide, desenho}` em `POST /api/s/<nome>/estado`; o servidor repassa aos espectadores por SSE. Se o SSE não entregar nada em 4 segundos, o cliente troca para `GET /api/s/<nome>/poll` (long polling). `?t=poll` na URL força essa via.

| Rota | Função |
|---|---|
| `GET /apresentar` | formulário: chave, deck, nome, marca d'água e proteção |
| `GET /api/decks` | lista os decks (header `X-Chave`) |
| `POST /api/sessoes` | cria a transmissão `{chave, deck, nome, marcaDagua, protecao, marca}` |
| `GET /s/<nome>` | entrega o deck com a camada de sincronia |
| `GET /api/s/<nome>/eventos` | canal SSE (`?k=<token>` entra como apresentador) |
| `GET /api/s/<nome>/poll` | via de reserva do SSE |
| `POST /api/s/<nome>/estado` | apresentador publica slide e desenho |
| `POST /api/s/<nome>/pronto` | espectador informa o progresso do carregamento |
| `POST /api/s/<nome>/encerrar` | encerra a transmissão |
| `GET /_d/<deck>/...` | arquivos do deck, só com o cookie da sessão |

## Testes

```bash
npm test
```

33 verificações (mais um teste do BASE_PATH): acesso restrito, chave, sessões, marca d'água e proteção, injeção no deck, bloqueio de `references/` e de path traversal, sincronia por SSE e por polling, pré-carregamento e encerramento.

## Sugestão ao mira-animator

A proposta de uma skill `/mira-remoto` está em [`docs/SUGESTAO-MIRA-ANIMATOR.md`](docs/SUGESTAO-MIRA-ANIMATOR.md).

## Licença e créditos

**PolyForm Noncommercial 1.0.0**, a mesma do Mira: uso não comercial (pessoal, educacional, de pesquisa e por organizações sem fins comerciais). Não pode ser vendido nem embutido em software comercial. Veja o [LICENSE](LICENSE).

- **Mira** (mira-animator): Sandeco Macedo, <https://github.com/sandeco/mira-animator>. O tema, a estrutura dos slides e o `mira-draw.js` vêm dele.
- **mira-remoto**: Emerson de Carvalho Assis.
