if (!process.versions.electron) {
  require('./server/server');
} else {
const { app, BrowserWindow, ipcMain, desktopCapturer, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

function ensureWritableElectronPaths() {
  const os = require('os');
  const baseDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'BADISCORD');
  const userDataDir = path.join(baseDir, 'User Data');
  const cacheDir = path.join(baseDir, 'Cache');
  const logsDir = path.join(baseDir, 'Logs');

  for (const dir of [baseDir, userDataDir, cacheDir, logsDir]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      console.warn(`Não foi possível criar ${dir}:`, err.message);
    }
  }

  app.setPath('userData', userDataDir);
  app.setPath('cache', cacheDir);
  app.setPath('logs', logsDir);

  app.commandLine.appendSwitch('user-data-dir', userDataDir);
  app.commandLine.appendSwitch('disk-cache-dir', cacheDir);
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache', 'true');
}

ensureWritableElectronPaths();

process.on('uncaughtException', (err) => {
  try {
    fs.writeFileSync(path.join(__dirname, 'crash.log'), (err.stack || String(err)) + '\n');
  } catch (e) {}
});

let mainWindow;
let processAudioCapture = null;

function relayProcessAudioPcm(capture, data) {
  const combined = capture.unalignedPcm.length
    ? Buffer.concat([capture.unalignedPcm, data])
    : data;
  const alignedLength = combined.length - (combined.length % 8);
  if (alignedLength && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('process-audio-chunk', Uint8Array.from(combined.subarray(0, alignedLength)));
  }
  capture.unalignedPcm = Buffer.from(combined.subarray(alignedLength));
}

function stopProcessAudioCapture() {
  const capture = processAudioCapture;
  processAudioCapture = null;
  if (!capture) return;
  clearTimeout(capture.startTimeout);
  capture.child.stdout.removeAllListeners('data');
  if (!capture.child.killed) capture.child.kill();
}

async function startProcessAudioCapture(sourceId) {
  if (process.platform !== 'win32') {
    throw new Error('A captura isolada de áudio está disponível somente no aplicativo desktop para Windows.');
  }
  const windowSource = /^window:(\d+):[01]$/.exec(String(sourceId || ''));
  if (!windowSource) {
    throw new Error('Selecione uma janela de aplicativo para capturar o áudio exclusivo do jogo.');
  }

  const currentSources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 0, height: 0 }
  });
  if (!currentSources.some((source) => source.id === sourceId)) {
    throw new Error('A janela selecionada não está mais disponível. Atualize a lista e tente novamente.');
  }

  stopProcessAudioCapture();
  const helperPath = app.isPackaged
    ? path.join(process.resourcesPath, 'process-audio-capture.exe')
    : path.join(__dirname, 'native', 'process-audio-capture.exe');
  if (!fs.existsSync(helperPath)) {
    throw new Error('O módulo nativo de áudio não foi compilado. Execute npm run build:native-audio e tente novamente.');
  }

  const capture = {
    child: spawn(helperPath, [windowSource[1]], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }),
    headerReady: false,
    pendingOutput: Buffer.alloc(0),
    unalignedPcm: Buffer.alloc(0),
    errorOutput: '',
    startTimeout: null,
    startSettled: false
  };
  processAudioCapture = capture;

  return new Promise((resolve, reject) => {
    const failStart = (error) => {
      if (capture.startSettled) return;
      capture.startSettled = true;
      clearTimeout(capture.startTimeout);
      if (processAudioCapture === capture) processAudioCapture = null;
      if (!capture.child.killed) capture.child.kill();
      reject(error);
    };

    capture.startTimeout = setTimeout(() => {
      failStart(new Error('A captura isolada de áudio demorou demais para iniciar.'));
    }, 15000);

    capture.child.stderr.on('data', (chunk) => {
      capture.errorOutput = (capture.errorOutput + chunk.toString()).slice(-2000);
    });
    capture.child.stdout.on('data', (chunk) => {
      if (!capture.headerReady) {
        capture.pendingOutput = Buffer.concat([capture.pendingOutput, chunk]);
        if (capture.pendingOutput.length < 16) return;
        const header = capture.pendingOutput.subarray(0, 16);
        if (header.subarray(0, 8).toString('binary') !== 'BDSPCM1\0') {
          failStart(new Error('O módulo nativo retornou um formato de áudio inválido.'));
          return;
        }
        const sampleRate = header.readUInt32LE(8);
        const channels = header.readUInt32LE(12);
        if (sampleRate < 8000 || sampleRate > 192000 || channels !== 2) {
          failStart(new Error('O módulo nativo retornou uma configuração de áudio incompatível.'));
          return;
        }
        capture.headerReady = true;
        capture.sampleRate = sampleRate;
        capture.pendingOutput = capture.pendingOutput.subarray(16);
        capture.child.stdout.pause();
        capture.startSettled = true;
        clearTimeout(capture.startTimeout);
        resolve({ sampleRate, channels });
        return;
      }
      relayProcessAudioPcm(capture, chunk);
    });
    capture.child.on('error', (error) => {
      if (!capture.headerReady) {
        failStart(new Error(`Não foi possível iniciar a captura isolada de áudio: ${error.message}`));
        return;
      }
      if (processAudioCapture === capture) processAudioCapture = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('process-audio-error', error.message);
      }
    });
    capture.child.on('close', (code) => {
      if (!capture.headerReady) {
        failStart(new Error(capture.errorOutput.trim() || `A captura de áudio encerrou antes de iniciar (${code}).`));
        return;
      }
      if (processAudioCapture === capture) {
        processAudioCapture = null;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('process-audio-error', capture.errorOutput.trim() || 'A captura isolada de áudio foi interrompida.');
        }
      }
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#1e1f22',
    title: 'BADISCORD',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    try {
      fs.writeFileSync(path.join(app.getPath('userData'), 'load-error.log'), `Failed to load: ${errorCode} - ${errorDescription} - ${validatedURL}\n`);
    } catch (e) {}
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    try {
      fs.writeFileSync(path.join(app.getPath('userData'), 'render-gone.log'), `Render process gone: ${JSON.stringify(details)}\n`);
    } catch (e) {}
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://github.com/badu4555/badiscord/releases/')) {
      shell.openExternal(url).catch((error) => {
        console.error('Não foi possível abrir a página de download:', error);
      });
    }
    return { action: 'deny' };
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
  mainWindow.on('closed', () => {
    mainWindow = null;
    stopProcessAudioCapture();
  });
}

// Handler para listar telas e janelas disponíveis para transmissão (como no Discord)
ipcMain.handle('get-screen-sources', async () => {
  try {
    let sources = [];
    try {
      sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 480, height: 270 },
        fetchWindowIcons: true
      });
    } catch (e1) {
      console.warn('Fallback para getSources simplificado:', e1);
      sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 320, height: 180 }
      });
    }

    const IGNORED_EXACT_NAMES = [
      'default ime',
      'msctfime ui',
      'program manager',
      'dwm notification window'
    ];

    const GAME_KEYWORDS = [
      'roblox', 'minecraft', 'valorant', 'counter-strike', 'cs:go', 'cs2', 'league of legends', 'lol',
      'gta', 'grand theft auto', 'fortnite', 'apex legends', 'apex', 'genshin', 'cyberpunk',
      'rocket league', 'call of duty', 'warzone', 'cod', 'overwatch', 'fifa', 'ea sports fc', 'fc 24', 'fc 25',
      'dead by daylight', 'terraria', 'among us', 'fivem', 'steam', 'epic games',
      'baldurs gate', 'elden ring', 'dota', 'honkai', 'pubg', 'rdr2', 'red dead',
      'destiny', 'rust', 'rainbow six', 'r6', 'fall guys', 'stumble guys', 'brawlhalla',
      'forza', 'palworld', 'helldivers', 'wuthering waves', 'zenless', 'tarkov',
      'path of exile', 'poe', 'world of warcraft', 'wow', 'diablo', 'god of war', 'assassin',
      'the sims', 'sims', 'lethal company', 'phasmophobia', 'euro truck', 'ets2', 'farming simulator',
      'cuphead', 'hollow knight', 'hades', 'osu!', 'geometry dash', 'brawl stars', 'clash', 'bluestacks',
      'retroarch', 'game', 'jogos', 'simulator', 'stardew valley', 'sea of thieves', 'smite'
    ];

    return sources
      .filter(source => {
        const isScreen = source.id.startsWith('screen:');
        if (isScreen) return true;
        const name = (source.name || '').trim().toLowerCase();
        if (!name) return false;
        // Não oculta janelas de jogos ou navegadores
        if (IGNORED_EXACT_NAMES.includes(name)) return false;
        return true;
      })
      .map(source => {
        const isScreen = source.id.startsWith('screen:');
        const name = (source.name || '').trim();
        const lowerName = name.toLowerCase();
        const isGame = !isScreen && GAME_KEYWORDS.some(k => lowerName.includes(k));

        let appIconData = null;
        try {
          if (source.appIcon && !source.appIcon.isEmpty()) {
            appIconData = source.appIcon.toDataURL();
          }
        } catch (e) {}

        let thumbData = '';
        try {
          if (source.thumbnail && !source.thumbnail.isEmpty()) {
            thumbData = source.thumbnail.toDataURL();
          }
        } catch (e) {}

        return {
          id: source.id,
          name: name || (isScreen ? 'Monitor Principal' : 'Janela de Jogo'),
          thumbnail: thumbData,
          appIcon: appIconData,
          isScreen,
          isGame
        };
      });
  } catch (err) {
    console.error('Erro ao listar fontes de captura:', err);
    return [];
  }
});

ipcMain.handle('start-process-audio-capture', async (event, sourceId) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('Origem da captura de áudio inválida.');
  }
  return startProcessAudioCapture(sourceId);
});

ipcMain.handle('resume-process-audio-capture', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || !processAudioCapture?.headerReady) {
    throw new Error('A captura isolada de áudio não está pronta.');
  }
  const capture = processAudioCapture;
  if (capture.pendingOutput.length) {
    relayProcessAudioPcm(capture, capture.pendingOutput);
    capture.pendingOutput = Buffer.alloc(0);
  }
  capture.child.stdout.resume();
  return true;
});

ipcMain.handle('stop-process-audio-capture', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return false;
  stopProcessAudioCapture();
  return true;
});

// Handler ultra-rápido e leve para detecção de jogos em tempo real (sem gerar thumbnails pesados)
ipcMain.handle('get-detected-game', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: true
    });

    const IGNORED_EXACT_NAMES = [
      'default ime',
      'msctfime ui',
      'program manager',
      'dwm notification window',
      'badiscord'
    ];

    const GAME_KEYWORDS = [
      'roblox', 'minecraft', 'valorant', 'counter-strike', 'cs:go', 'cs2', 'league of legends', 'lol',
      'gta', 'grand theft auto', 'fortnite', 'apex legends', 'apex', 'genshin', 'cyberpunk',
      'rocket league', 'call of duty', 'warzone', 'cod', 'overwatch', 'fifa', 'ea sports fc', 'fc 24', 'fc 25',
      'dead by daylight', 'terraria', 'among us', 'fivem', 'steam', 'epic games',
      'baldurs gate', 'elden ring', 'dota', 'honkai', 'pubg', 'rdr2', 'red dead',
      'destiny', 'rust', 'rainbow six', 'r6', 'fall guys', 'stumble guys', 'brawlhalla',
      'forza', 'palworld', 'helldivers', 'wuthering waves', 'zenless', 'tarkov',
      'path of exile', 'poe', 'world of warcraft', 'wow', 'diablo', 'god of war', 'assassin',
      'the sims', 'sims', 'lethal company', 'phasmophobia', 'euro truck', 'ets2', 'farming simulator',
      'cuphead', 'hollow knight', 'hades', 'osu!', 'geometry dash', 'brawl stars', 'clash', 'bluestacks',
      'retroarch', 'game', 'jogos', 'simulator', 'stardew valley', 'sea of thieves', 'smite'
    ];

    const validWindows = sources.filter(s => {
      const name = (s.name || '').trim().toLowerCase();
      if (!name) return false;
      if (IGNORED_EXACT_NAMES.some(ign => name === ign || name.startsWith('badiscord'))) return false;
      return true;
    });

    if (validWindows.length === 0) return null;

    // Prioridade 1: Janela que combina com qualquer palavra-chave de jogo
    let matchedGame = validWindows.find(s => {
      const lower = s.name.toLowerCase();
      return GAME_KEYWORDS.some(k => lower.includes(k));
    });

    // Prioridade 2: Se não houver jogo por palavra-chave, pegar a primeira janela de aplicação aberta
    if (!matchedGame) {
      matchedGame = validWindows[0];
    }

    if (!matchedGame) return null;

    let appIconData = null;
    try {
      if (matchedGame.appIcon && !matchedGame.appIcon.isEmpty()) {
        appIconData = matchedGame.appIcon.toDataURL();
      }
    } catch (e) {}

    const isRecognizedGame = GAME_KEYWORDS.some(k => matchedGame.name.toLowerCase().includes(k));

    return {
      id: matchedGame.id,
      name: matchedGame.name.trim(),
      isGame: isRecognizedGame,
      appIcon: appIconData
    };
  } catch (err) {
    console.error('Erro ao detectar jogo:', err);
    return null;
  }
});

app.whenReady().then(() => {
  app.on('web-contents-created', (event, contents) => {
    contents.session.setPermissionRequestHandler((webContents, permission, callback) => {
      const allowedPermissions = ['media', 'camera', 'microphone', 'display-capture'];

      if (allowedPermissions.includes(permission)) {
        callback(true);
        return;
      }
      callback(false);
    });
  });

  app.on('before-quit', stopProcessAudioCapture);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
}
