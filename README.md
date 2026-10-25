# BADISCORD

Aplicativo independente para comunidades, com clientes Web/Electron e backend Node.js. Recursos atuais:
- **Canais de Voz** com cancelamento de eco, supressão de ruído e áudio Opus em 48 kHz.
- **Detecção de Fala em Tempo Real** (borda verde iluminada no avatar quando você fala).
- **Transmissão de tela em 720p, 1080p e 2K (1440p)** com seleção de FPS.
- **Áudio isolado da janela selecionada** no aplicativo desktop Windows, sem incluir o áudio dos demais aplicativos.
- **Lista de participantes por canal de voz**, atualizada sem precisar entrar no canal.
- **Controle de volume individual** dos participantes, salvo no dispositivo.
- **Menu de participantes acessível por toque longo no celular**, com controles locais de volume, silenciar e ocultar vídeo.
- **Ícone de servidor personalizável** pelo botão de câmera sobre a bolinha do servidor (para proprietários).
- **Lista de membros online e offline**, com cargos personalizados e seções definidas pelo dono ou administradores.
- **Chamadas privadas de voz** entre amigos, ações de moderação persistidas no servidor e convite para jogar ou ouvir música.
- **Atividade atual de jogo ou Spotify** no perfil e na lista de membros; ícones de jogos vêm do aplicativo detectado no desktop.
- Temas visuais próprios, incluindo a paleta Aurora; personalizações de perfil disponíveis sem assinatura.

---

## 🚀 Como Executar no seu Computador

### Passo 1: Acessar a pasta e instalar dependências
Abra o PowerShell ou Prompt de Comando e execute:
```powershell
cd C:\Users\Luis_\badiscord
npm install
```
Para compilar a captura de áudio isolada, instale o Visual Studio Build Tools com o compilador C++ x64 e o Windows SDK, além do Python 3 para o `node-gyp` reconstruir o driver SQLite no empacotamento. A captura por processo requer Windows 10 build 20348 ou posterior.

### Passo 2: Iniciar a aplicação
```powershell
npm run desktop
```
O comando compila o helper nativo de áudio antes de abrir o aplicativo. A captura exclusiva do áudio de um aplicativo/janela está disponível no aplicativo desktop Windows. No navegador, o compartilhamento solicita o áudio do sistema quando suportado; é necessário habilitá-lo no seletor se o navegador pedir. O som pode incluir outros aplicativos, e o navegador ou a fonte escolhida podem não fornecer áudio.

No desktop, o botão de transmitir abre a lista de janelas; selecionar uma janela não inicia nem abre o jogo, e a captura começa somente após confirmar a transmissão. O indicador de latência usa o RTT ICE da conexão com o servidor LiveKit. Participantes conectados compartilham essa medição para que ela apareça ao lado de cada pessoa; ela representa a rota até o servidor de voz (não uma conexão direta entre participantes). Se não houver estatísticas disponíveis, o app mostra `--` em vez de inventar um valor.

---

## Baixar o aplicativo desktop para Windows

Baixe o instalador `.exe` ou a versão portátil `.zip` na [página de releases do BADISCORD](https://github.com/badu4555/badiscord/releases/latest). O instalador cria atalhos no Menu Iniciar e na área de trabalho. A versão portátil pode ser extraída e executada sem instalação.

O aplicativo desktop precisa de conexão com a internet para abrir o BADISCORD e entrar na conta. Ele usa o domínio oficial HTTPS para que o login, os cookies de sessão e o reCAPTCHA funcionem corretamente.

A versão instalada pelo `.exe` procura atualizações automaticamente ao abrir e periodicamente enquanto estiver em execução. Quando uma nova versão estiver disponível, uma janela mostrará a versão e permitirá baixar e instalar agora ou adiar; depois do download, é possível reiniciar para concluir. A primeira versão com atualização automática precisa ser instalada manualmente; as seguintes poderão ser atualizadas pelo próprio aplicativo. A versão portátil `.zip` continua sendo atualizada por download manual.

Os pacotes ainda não são assinados digitalmente; o Windows pode exibir um aviso do SmartScreen na primeira execução.

## Gerar os pacotes para Windows

Em Windows com Visual Studio Build Tools (C++ x64 e Windows SDK) e Python 3 instalados, execute:
```powershell
npm ci
npm run build:release
```
O instalador, o ZIP portátil e os metadados de atualização serão gerados na pasta `dist/`. As versões publicadas são compiladas automaticamente pelo GitHub Actions ao enviar uma tag `vX.Y.Z` que corresponda à versão no `package.json`; os pacotes e metadados são anexados a uma GitHub Release para permitir as atualizações automáticas.

## Aplicativo Android

O projeto Android fica em `android/` e usa um WebView restrito ao domínio oficial do BADISCORD. Para transmitir, o aplicativo solicita a permissão de captura de tela do Android e publica o vídeo por um participante LiveKit separado, sem substituir a conexão de voz do WebView. A transmissão permanece ativa em segundo plano por meio de um serviço foreground e pode ser encerrada pelo botão na notificação.

Em um computador com JDK 17 ou superior, Android SDK (API 35) e Gradle 8.9, gere o APK de depuração com:

```powershell
cd C:\Users\Luis_\badiscord\android
gradle --no-daemon :app:assembleDebug
```

O APK ficará em `android\app\build\outputs\apk\debug\app-debug.apk`. O workflow `Android APK` também compila esse APK e o disponibiliza como artefato de execução. A primeira instalação precisa ser validada em um dispositivo Android real: aceite a permissão de captura na tela do sistema e confirme que a transmissão aparece para outro participante do canal.

## Publicar o backend no Render

O arquivo `render.yaml` configura o serviço Node automaticamente. No Render, crie um Blueprint a partir deste repositório e preencha `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` e `ALLOWED_ORIGINS` como variáveis secretas. O endpoint ficará disponível em `https://badiscord-api.onrender.com` ou no domínio gerado pelo Render.

### Configurar atividade do Spotify

Crie um aplicativo no [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), adicione como Redirect URI exatamente `https://SEU-DOMINIO-DA-API/api/spotify/callback` e configure no backend:

- `SPOTIFY_CLIENT_ID` e `SPOTIFY_CLIENT_SECRET` do aplicativo Spotify.
- `SPOTIFY_REDIRECT_URI` com a URI de callback cadastrada, sem diferenças de caminho ou protocolo.
- `PUBLIC_APP_URL` com a origem HTTPS da interface BADISCORD para onde o Spotify retorna após a autorização.
- `SPOTIFY_TOKEN_ENCRYPTION_KEY` com 32 bytes aleatórios em hexadecimal (64 caracteres). Gere uma chave própria e mantenha-a como segredo; perder ou trocar essa chave exige reconectar as contas Spotify.

O BADISCORD solicita apenas leitura do playback atual e não controla a reprodução. Cada usuário conecta a própria conta pela nota musical na lista de membros. A atividade de música aparece enquanto o Spotify indicar uma faixa em reprodução.

## Publicar o backend no Railway

O arquivo `railway.json` já configura o comando `npm run server`. No Railway, adicione as variáveis `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `PORT` e `ALLOWED_ORIGINS` usando os valores do seu projeto LiveKit. Use `.env.example` apenas como referência e nunca publique o API Secret no código.
