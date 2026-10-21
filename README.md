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
- **Funciona sem domínio e sem servidor**, com um túnel gratuito (`npm run tunel`), e continua funcionando atrás de proxies que não deixam o SSE passar: se o tempo real não chegar, a sincronia troca sozinha para *long polling*.
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

## Apresentar sem domínio nem servidor (túnel gratuito)

Para demonstração, aula ou reunião, dá para rodar tudo no seu computador e abrir um endereço público com o **Cloudflare Quick Tunnel**: grátis, sem conta e sem domínio.

1. Instale o `cloudflared` uma vez:
   - Windows: `winget install --id Cloudflare.cloudflared`
   - macOS: `brew install cloudflared`
   - Linux: [downloads oficiais](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
2. Na pasta do projeto:

   ```bash
   npm run tunel
   ```

3. O comando sobe o servidor e o túnel e mostra algo assim:

   ```
   Para apresentar:  https://nome-aleatorio.trycloudflare.com/apresentar
   Chave de acesso:  Xk3p9...
   ```

4. Abra o endereço, digite a chave, escolha o deck, crie a transmissão e copie o link do cliente. Ctrl+C encerra tudo.

Se você já definiu `PRESENTER_KEY`, o comando usa essa chave; se não, gera uma chave forte, porque o túnel deixa a página `/apresentar` pública.

**Limites do túnel gratuito** (conferidos na [documentação da Cloudflare](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)):

- O endereço **muda a cada execução**. Sem problema: você cria a transmissão e manda o link na hora.
- **Sem garantia de disponibilidade**; a Cloudflare indica para teste e desenvolvimento.
- Até **200 requisições em andamento** por túnel; acima disso o excedente recebe erro 429.
- **Não suporta SSE.** Por isso o mira-remoto tem a sincronia por *long polling*: o cliente tenta o SSE e, se nada chegar em 4 segundos, troca sozinho. Não precisa configurar nada.
- O **seu computador** precisa ficar ligado e online, e o seu upload serve o deck para cada espectador. Como o espectador baixa o deck inteiro antes de começar, deck com vídeos pesados e muita gente ao mesmo tempo exigem boa internet.

### Recomendado para uso profissional: domínio próprio

O túnel gratuito é ótimo para testar e para a primeira reunião. Para apresentar a clientes com regularidade, **prefira um domínio próprio**:

| | Túnel gratuito | Domínio próprio |
|---|---|---|
| Endereço | muda a cada vez | fixo e com a sua marca (ex.: `apresenta.suaempresa.com.br`) |
| Disponibilidade | sem garantia | a que o seu servidor oferecer |
| Depende do seu computador | sim, ligado e online | não, se estiver num servidor |
| Banda | o upload da sua casa | a do servidor |
| Confiança de quem recebe | endereço aleatório pode parecer suspeito | endereço reconhecível |

Dois caminhos, do mais robusto ao mais simples:

1. **Servidor com Docker e HTTPS** (VPS, Dokploy, Railway etc.) apontado para um subdomínio seu. É o que a seção [Deploy](#deploy) descreve.
2. **Cloudflare Tunnel com domínio seu**: se o domínio já está na Cloudflare, um túnel nomeado dá um endereço fixo sem abrir porta no roteador e sem custo pelo túnel (o material que consultei não indica cota de banda ou de requisições). O servidor continua no seu computador, com endereço estável.

Outros túneis gratuitos existem, com ressalvas para este uso: o **Tailscale Funnel** dá um endereço fixo `*.ts.net`, mas pede conta, está em beta e o plano gratuito é para uso pessoal; o **ngrok** gratuito tem 1 GB de saída por mês e mostra uma página de aviso ao visitante, o que não combina com um deck que o espectador baixa inteiro.

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
| `POLL_MS` | `20000` | quanto tempo o servidor segura cada pergunta do *long polling* (ms) |
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

O canal principal é o SSE. Se ele não entregar nada em 4 segundos (túnel gratuito da Cloudflare, proxy de empresa), o cliente troca para `GET /poll`: pergunta "mudou algo desde a versão v?" e o servidor só responde quando muda ou em 20 segundos. A escolha é automática; `?t=poll` na URL do cliente força o polling.

| Rota | Quem usa | Função |
|---|---|---|
| `GET /apresentar` | você | formulário: chave, deck, nome do link |
| `GET /api/decks` | você | lista os decks (header `X-Chave`) |
| `POST /api/sessoes` | você | cria a transmissão `{chave, deck, nome, marcaDagua, protecao, marca}` (os três últimos são opcionais) |
| `GET /s/<nome>` | todos | entrega o deck com a camada de sincronia |
| `GET /api/s/<nome>/eventos` | todos | canal SSE; com `?k=<token>` entra como apresentador |
| `GET /api/s/<nome>/poll` | todos | via de reserva do SSE: responde quando algo muda (ou em 20 s); `?k=<token>` entra como apresentador |
| `POST /api/s/<nome>/estado` | apresentador | publica slide e desenho |
| `POST /api/s/<nome>/pronto` | espectador | informa o progresso do pré-carregamento |
| `POST /api/s/<nome>/encerrar` | apresentador | encerra a transmissão |
| `GET /_d/<deck>/...` | todos | arquivos do deck (só com o cookie da sessão) |

## Testes

```bash
node test/smoke.js
```

Sobe o servidor e confere 33 pontos: acesso restrito, chave, criação de sessão, escolha de marca d'água e proteção por transmissão, injeção no deck, bloqueio de `references/` e de path traversal, sincronia do slide em tempo real (SSE e long polling), pré-carregamento e encerramento.

## Sugestão para o mira-animator

A ideia de levar o `/mira-remote` para a internet, como uma skill `/mira-remoto` do Mira, está descrita em [`docs/SUGESTAO-MIRA-ANIMATOR.md`](docs/SUGESTAO-MIRA-ANIMATOR.md).

## Créditos

- **Mira** (mira-animator): Sandeco Macedo, <https://github.com/sandeco/mira-animator>. O tema, a estrutura de slides e o telestrator `mira-draw.js` vêm dele.
- mira-remoto: Emerson de Carvalho Assis.
- O servidor e o `sync.js` nasceram da apresentação remota do projeto Receptor de Contagem.
