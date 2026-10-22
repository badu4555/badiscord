# VoiceLive PC (Desktop App para Windows)

Aplicativo para Windows desenvolvido com a mesma arquitetura do **Discord Desktop** (Electron + WebRTC + Node.js), incluindo:
- **Canais de Voz** com cancelamento de eco, supressão de ruído e áudio Opus em 48 kHz.
- **Detecção de Fala em Tempo Real** (borda verde iluminada no avatar quando você fala).
- **Transmissão de Tela / Janelas em 1080p 60 FPS** usando a API nativa `desktopCapturer` do Electron.
- Interface escura clássica no padrão Discord.

---

## 🚀 Como Executar no seu Computador

### Passo 1: Acessar a pasta e instalar dependências
Abra o PowerShell ou Prompt de Comando e execute:
```powershell
cd C:\Users\Luis_\.gemini\antigravity\scratch\voice-live-pc
npm install
```

### Passo 2: Iniciar a aplicação
```powershell
npm start
```
*O aplicativo abrirá diretamente em uma janela nativa no seu Windows!*

---

## 📦 Como Gerar o Instalador / Executável (.exe)

Para criar um arquivo executável portátil (`.exe`) para distribuir para amigos:
```powershell
npm run build:exe
```
O executável `.exe` será gerado automaticamente na pasta `dist/`.

## Publicar o backend no Render

O arquivo `render.yaml` configura o serviço Node automaticamente. No Render, crie um Blueprint a partir deste repositório e preencha `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` e `ALLOWED_ORIGINS` como variáveis secretas. O endpoint ficará disponível em `https://badiscord-api.onrender.com` ou no domínio gerado pelo Render.

## Publicar o backend no Railway

O arquivo `railway.json` já configura o comando `npm run server`. No Railway, adicione as variáveis `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `PORT` e `ALLOWED_ORIGINS` usando os valores do seu projeto LiveKit. Use `.env.example` apenas como referência e nunca publique o API Secret no código.
