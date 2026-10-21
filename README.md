# mira-remoto

**Apresente um deck do [Mira](https://github.com/sandeco/mira-animator) ao vivo, para quem está longe.**
Você conduz no seu computador; a tela de quem assiste acompanha em tempo real, inclusive o desenho da caneta (tecla `P`). Basta mandar um link.

É uma variação, e uma sugestão, para o projeto **mira-animator** do professor **Sandeco Macedo**. O Mira cria os slides animados em HTML; o mira-remoto leva esses mesmos slides para a internet, sem alterar nenhum deck.

> Quer ver funcionando antes de ler? O repositório já traz o deck `demo-mira-remoto`, um deck do Mira que explica o próprio mira-remoto. Rode o servidor (veja abaixo), abra `/apresentar`, escolha esse deck e entre no link do cliente em outra aba.

## O que ele resolve

O Mira já tem o `/mira-remote`, que espelha o deck no celular **pela rede local** (mesmo Wi-Fi). Funciona muito bem na sala, mas o cliente que está em outra cidade não alcança o seu computador. O mira-remoto resolve esse caso:

| | `/mira-remote` (Mira) | mira-remoto (este projeto) |
|---|---|---|
| Alcance | mesma rede ou hotspot | internet |
| Quem hospeda | seu notebook | um servidor (VPS, Docker, Dokploy) |
| Como o outro lado entra | QR code | link `/s/<nome>` |
| Papéis | palco, controle e espelho por IP | apresentador (com chave) e espectadores |
| O que sincroniza | slide, passos e desenho | slide e desenho |
| Precisa mexer no deck | não | não |

Os dois se complementam: LAN para a sala, mira-remoto para o cliente à distância.

## Recursos

- **Qualquer deck do Mira, sem editar.** Copie a pasta para `decks/`. O servidor injeta o necessário na hora de entregar a página.
- **Link por apresentação** (`/s/loja-do-joao`), criado por quem apresenta com uma chave. Quando você encerra, o link morre.
- **Slide e desenho sincronizados.** O desenho usa o `mira-draw` (telestrator do Mira) e viaja em coordenadas do quadro 16:9, então cai no mesmo lugar em qualquer tela.
- **Viaja o estado, não o vídeo.** Só o número do slide e os traços; a animação de cada slide roda local em cada tela (a Regra Zero do Mira continua valendo).
- **Pré-carregamento.** O espectador só vê o deck depois de baixar tudo (imagens, vídeos). Na sua barra aparece "N carregando (xx%)" e, no fim, "✔ pronto, pode iniciar".
- **Marca d'água e proteção, escolhidas a cada transmissão.** Ao iniciar, você marca ou desmarca: **marca d'água** (nome do link, código do visitante e data, com o texto que você quiser) e **bloqueio de cópia e impressão com tela preta ao perder o foco ou ao apertar PrintScreen**. Dá para usar só uma, as duas ou nenhuma. O formulário lembra a sua última escolha.
- **Vários decks no mesmo servidor.** Na hora de iniciar, você escolhe qual deck apresentar.
- **Zero dependências.** Um `server.js` em Node 18+ e arquivos estáticos.

## Rodar localmente

```bash
PRESENTER_KEY=minha-chave node server.js
# [mira-remoto] no ar na porta 3000 · decks: demo-mira-remoto
```

Sem `PRESENTER_KEY`, o servidor gera uma chave temporária e mostra no log.

1. Abra `http://localhost:3000/apresentar`, digite a chave, escolha o deck e (opcional) um nome para o link. Em **Para quem assiste**, escolha se haverá marca d'água (e o texto dela) e se a proteção fica ligada.
2. Você cai no deck como apresentador. Clique em **Copiar link do cliente** e envie.
3. Setas, Espaço e PageUp/PageDown trocam o slide. O cliente acompanha. `P` liga a caneta, `F` abre a tela cheia.
4. **Encerrar** (na barra, embaixo) termina a transmissão.

## Colocar o seu deck do Mira no mira-remoto

1. **Copie a pasta do deck** (a que tem o `index.html`) para dentro de `decks/`:

   ```bash
   cp -r ~/slide/decks/meu-deck decks/meu-deck
   ```

   O nome da pasta pode ter letras, números, ponto, hífen e sublinhado.

2. **Reinicie o servidor** (ou refaça o deploy). O deck aparece na lista de `/apresentar`.

3. **Apresente**: `/apresentar` → chave → escolher `meu-deck` → copiar o link do cliente.

Não é preciso editar o `index.html`. Na hora de entregar, o servidor:

- coloca um `<base href="/_d/meu-deck/">` para os caminhos relativos (`assets/...`, `mira/...`) funcionarem;
- troca o `mira-draw.js` do deck pelo do servidor, que tem a API de sincronização (`onchange`, `getShapes`, `setShapes`);
- adiciona o `sync.js`, que faz o resto.

O deck continua abrindo normalmente por `file://` no seu computador, porque nada dele foi alterado.

### O que o deck precisa ter

- Um `index.html` na raiz da pasta do deck.
- Os slides como `<section>` filhos diretos do `<body>` (é o padrão do Mira). A sincronização acompanha a posição de rolagem dessas seções.
- Recursos por caminho **relativo** (padrão do Mira).
- Se o deck usa CDN (Tailwind, AOS, Lucide, D3, fonte Inter), rode antes o **`/mira-offline`**. Assim o espectador não depende de CDN e nada é bloqueado por firewall.

### O que não é entregue ao espectador

Dentro do deck, o servidor nunca serve a pasta `references/`, nem arquivos `.md`, `.cjs`, `.bat`, `.command`, `.sh`, `.ps1`, `.map` e arquivos ocultos. Seus roteiros e fontes ficam só no servidor.

### Limites conhecidos

- Sincroniza **slide e desenho**. Passos internos de um slide, módulos ao vivo (quiz, survey) e a mesa tática do Mira não são espelhados; cada tela roda os seus.
- As sessões ficam na **memória** do servidor: reiniciar o container encerra as transmissões abertas.

## Deploy

### Docker

```bash
docker build -t mira-remoto .
docker run -d --name mira-remoto -p 3000:3000 -e PRESENTER_KEY=minha-chave mira-remoto
```

Ou com compose: `PRESENTER_KEY=minha-chave docker compose up -d --build`.

Para adicionar decks sem rebuildar, monte a pasta: `-v $(pwd)/decks:/app/decks:ro`.

### Dokploy

- **Compose:** Git → este repositório → Compose Path `./docker-compose.yml`. Em *Domains*, serviço `mira-remoto`, porta `3000`. Em *Environment*, defina `PRESENTER_KEY`.
- **Application:** Git → Build Type `Dockerfile` → porta `3000`.

Use sempre HTTPS (o Dokploy faz isso com o domínio). O cookie da sessão ganha `Secure` automaticamente atrás de HTTPS.

### Variáveis de ambiente

| Variável | Padrão | Para que serve |
|---|---|---|
| `PRESENTER_KEY` | gerada no log | chave de quem apresenta (a que aparece em "Chave de acesso") |
| `PORT` | `3000` | porta |
| `DECKS_DIR` | `./decks` | pasta dos decks |
| `PROTEGER` | `1` | padrão das duas caixas de "Para quem assiste" (`0` abre o formulário com elas desmarcadas) |
| `MARCA` | `CONFIDENCIAL` | texto padrão da marca d'água |

Marca d'água e proteção são decididas **por transmissão**, no `/apresentar`; as duas variáveis só definem o padrão.

**Para trocar a chave:** altere `PRESENTER_KEY` e reinicie (no Dokploy: *Environment* → salvar → *Deploy*). Trocar a chave encerra as transmissões abertas.

## Segurança

- A raiz (`/`) mostra só "Acesso restrito". O deck e seus arquivos só são entregues a quem abre um link `/s/<nome>` de uma transmissão ativa (cookie assinado, que deixa de valer a cada reinício).
- Criar transmissão e listar os decks exigem a chave. Tentativas erradas têm limite (6 a cada 10 minutos por IP).
- A comparação de chaves é em tempo constante; o token do apresentador só vai na primeira URL e some do endereço em seguida.
- Sem marca d'água e sem proteção, o espectador consegue copiar, imprimir e tirar print. Use essa opção para público de confiança ou conteúdo aberto.
- Nenhum navegador impede foto da tela. A marca d'água serve para identificar quem vazou.

## Como funciona

```
 apresentador ──POST /api/s/<nome>/estado {i, shapes}──▶  mira-remoto  ──SSE (estado)──▶ espectador 1
 (sync.js + mira-draw)                                    (server.js)  ──SSE (estado)──▶ espectador 2
```

| Rota | Quem usa | Função |
|---|---|---|
| `GET /apresentar` | você | formulário: chave, deck, nome do link |
| `GET /api/decks` | você | lista os decks (header `X-Chave`) |
| `POST /api/sessoes` | você | cria a transmissão `{chave, deck, nome, marcaDagua, protecao, marca}` (os três últimos são opcionais) |
| `GET /s/<nome>` | todos | entrega o deck com a camada de sincronia |
| `GET /api/s/<nome>/eventos` | todos | canal SSE; com `?k=<token>` entra como apresentador |
| `POST /api/s/<nome>/estado` | apresentador | publica slide e desenho |
| `POST /api/s/<nome>/pronto` | espectador | informa o progresso do pré-carregamento |
| `POST /api/s/<nome>/encerrar` | apresentador | encerra a transmissão |
| `GET /_d/<deck>/...` | todos | arquivos do deck (só com o cookie da sessão) |

## Testes

```bash
node test/smoke.js
```

Sobe o servidor e confere 26 pontos: acesso restrito, chave, criação de sessão, escolha de marca d'água e proteção por transmissão, injeção no deck, bloqueio de `references/` e de path traversal, sincronia do slide em tempo real, pré-carregamento e encerramento.

## Sugestão para o mira-animator

A ideia de levar o `/mira-remote` para a internet, como uma skill `/mira-remoto` do Mira, está descrita em [`docs/SUGESTAO-MIRA-ANIMATOR.md`](docs/SUGESTAO-MIRA-ANIMATOR.md).

## Créditos

- **Mira** (mira-animator): Sandeco Macedo, <https://github.com/sandeco/mira-animator>. O tema, a estrutura de slides e o telestrator `mira-draw.js` vêm dele.
- mira-remoto: Emerson de Carvalho Assis.
- O servidor e o `sync.js` nasceram da apresentação remota do projeto Receptor de Contagem.
