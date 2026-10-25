if (!process.versions.electron) {
  require('./server/server');
} else {
const { app, BrowserWindow, ipcMain, desktopCapturer, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const APP_ORIGIN = app.isPackaged
  ? 'https://badiscord.onrender.com'
  : 'http://localhost:3000';
const GAME_KEYWORDS = [
  'roblox', 'minecraft', 'valorant', 'counter-strike', 'cs:go', 'cs2', 'league of legends',
  'grand theft auto', 'gta v', 'gta online', 'fortnite', 'apex legends', 'apex', 'genshin', 'cyberpunk',
  'rocket league', 'call of duty', 'warzone', 'overwatch', 'ea sports fc', 'fc 24', 'fc 25', 'fifa',
  'dead by daylight', 'terraria', 'among us', 'fivem', 'baldurs gate', 'baldur\'s gate',
  'elden ring', 'dota', 'honkai', 'pubg', 'rdr2', 'red dead', 'destiny', 'rust', 'rainbow six',
  'fall guys', 'stumble guys', 'brawlhalla', 'forza', 'palworld', 'helldivers',
  'wuthering waves', 'zenless', 'tarkov', 'path of exile', 'world of warcraft', 'diablo',
  'god of war', 'assassin\'s creed', 'the sims', 'sims 4', 'lethal company', 'phasmophobia',
  'euro truck', 'ets2', 'farming simulator', 'cuphead', 'hollow knight', 'hades', 'osu!',
  'geometry dash', 'brawl stars', 'clash royale', 'clash of clans', 'retroarch', 'stardew valley',
  'sea of thieves', 'smite', 'team fortress', 'left 4 dead', 'portal 2', 'half-life',
  'monster hunter', 'resident evil', 'street fighter', 'tekken', 'mortal kombat',
  'final fantasy', 'kingdom hearts', 'nier', 'persona', 'dragon age', 'mass effect',
  'the witcher', 'elden ring', 'dark souls', 'sekiro', 'bloodborne', 'hades ii',
  'slay the spire', 'balatro', 'terraria', 'factorio', 'satisfactory', 'rimworld',
  'cities skylines', 'planet coaster', 'powerwash simulator', 'subnautica',
  'sons of the forest', 'the forest', 'ark survival', 'dayz', '7 days to die',
  'warframe', 'eve online', 'black desert', 'lost ark', 'new world', 'throne and liberty',
  'minecraft dungeons', 'sea of thieves', 'trackmania', 'need for speed', 'assetto corsa',
  'beamng', 'f1 2', 'f1 manager', 'age of empires', 'civilization vi', 'civilization vii',
  'hearthstone', 'teamfight tactics', 'legends of runeterra', 'marvel rivals',
  'the finals', 'delta force', 'xdefiant', 'once human', 'f1'
];
const BROWSER_WINDOW_MARKERS = [
  'google chrome', 'chrome', 'microsoft edge', 'msedge', ' - edge', 'firefox', 'brave',
  'opera', 'vivaldi', 'arc browser', 'safari', 'browser'
];

function isGameWindowName(name) {
  const lowerName = String(name || '').trim().toLowerCase();
  if (!lowerName || BROWSER_WINDOW_MARKERS.some((marker) => lowerName.includes(marker))) return false;
  return GAME_KEYWORDS.some((keyword) => {
    if (keyword.length > 3) return lowerName.includes(keyword);
    return new RegExp(`(^|[^a-z0-9])${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(lowerName);
  });
}

function isTrustedRenderer(event) {
  try {
    return event.sender === mainWindow?.webContents
      && event.senderFrame === event.sender.mainFrame
      && new URL(event.senderFrame.url).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

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
let updateWindow;
let processAudioCapture = null;
let cameraPermissionGranted = false;
let updateState = { status: 'available', version: '' };

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowPrerelease = false;

function sendUpdateState() {
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.webContents.send('desktop-update:state', {
      ...updateState,
      currentVersion: app.getVersion()
    });
  }
}

function showUpdateWindow() {
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.show();
    updateWindow.focus();
    return;
  }

  updateWindow = new BrowserWindow({
    width: 460,
    height: 340,
    minWidth: 460,
    maxWidth: 460,
    minHeight: 340,
    maxHeight: 340,
    parent: mainWindow || undefined,
    modal: Boolean(mainWindow),
    resizable: false,
    show: false,
    title: 'Atualização do BADISCORD',
    backgroundColor: '#1e1f22',
    webPreferences: {
      preload: path.join(__dirname, 'update-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  updateWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  updateWindow.once('ready-to-show', () => {
    updateWindow.show();
    sendUpdateState();
  });
  updateWindow.on('closed', () => {
    updateWindow = null;
  });
  updateWindow.loadFile(path.join(__dirname, 'renderer', 'update.html')).catch((error) => {
    console.error('Não foi possível abrir a tela de atualização:', error);
  });
}

async function checkForDesktopUpdates() {
  if (!app.isPackaged) return;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    console.warn('Não foi possível verificar atualizações do BADISCORD:', error);
  }
}

autoUpdater.on('checking-for-update', () => {
  updateState = { status: 'checking', version: '' };
  sendUpdateState();
});

autoUpdater.on('update-available', (info) => {
  updateState = { status: 'available', version: info.version };
  showUpdateWindow();
  sendUpdateState();
});

autoUpdater.on('update-not-available', () => {
  updateState = { status: 'not-available', version: app.getVersion() };
  sendUpdateState();
});

autoUpdater.on('download-progress', (progress) => {
  updateState = { status: 'downloading', version: updateState.version, percent: progress.percent };
  sendUpdateState();
});

autoUpdater.on('update-downloaded', (info) => {
  updateState = { status: 'downloaded', version: info.version };
  showUpdateWindow();
  sendUpdateState();
});

autoUpdater.on('error', (error) => {
  console.error('Erro no atualizador do BADISCORD:', error);
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateState = { status: 'error', version: updateState.version };
    sendUpdateState();
  }
});

function isUpdateWindow(event) {
  return Boolean(updateWindow)
    && !updateWindow.isDestroyed()
    && event.sender === updateWindow.webContents
    && event.senderFrame === event.sender.mainFrame;
}

ipcMain.handle('desktop-update:get-state', (event) => {
  if (!isUpdateWindow(event)) throw new Error('Origem da tela de atualização inválida.');
  return { ...updateState, currentVersion: app.getVersion() };
});

ipcMain.handle('desktop-update:download', async (event) => {
  if (!isUpdateWindow(event)) throw new Error('Origem da tela de atualização inválida.');
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    updateState = { status: 'error', version: updateState.version };
    sendUpdateState();
    throw error;
  }
});

ipcMain.handle('desktop-update:retry', async (event) => {
  if (!isUpdateWindow(event)) throw new Error('Origem da tela de atualização inválida.');
  if (updateState.version) {
    await autoUpdater.downloadUpdate();
    return;
  }
  await checkForDesktopUpdates();
});

ipcMain.handle('desktop-update:install', (event) => {
  if (!isUpdateWindow(event) || updateState.status !== 'downloaded') {
    throw new Error('A atualização ainda não terminou de baixar.');
  }
  autoUpdater.quitAndInstall();
});

ipcMain.handle('desktop-update:close', (event) => {
  if (!isUpdateWindow(event)) throw new Error('Origem da tela de atualização inválida.');
  updateWindow.close();
});

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
    try {
      const externalUrl = new URL(url);
      if (externalUrl.protocol === 'https:' || externalUrl.protocol === 'http:') {
        shell.openExternal(externalUrl.href).catch((error) => {
          console.error('Não foi possível abrir o link externo:', error);
        });
      }
    } catch (error) {
      console.error('Não foi possível validar o link externo:', error);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      if (new URL(url).origin !== APP_ORIGIN) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });

  mainWindow.loadURL(`${APP_ORIGIN}/`).catch((error) => {
    console.error('Não foi possível carregar o BADISCORD:', error);
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.on('closed', () => {
    mainWindow = null;
    stopProcessAudioCapture();
  });
}

// Handler para listar telas e janelas disponíveis para transmissão (como no Discord)
ipcMain.handle('get-screen-sources', async (event) => {
  if (!isTrustedRenderer(event)) throw new Error('Origem da captura de tela inválida.');
  try {
    let sources = [];
    try {
      sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true
      });
    } catch (e1) {
      console.warn('Fallback para getSources simplificado:', e1);
      sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 240, height: 135 }
      });
    }

    const IGNORED_EXACT_NAMES = [
      'default ime',
      'msctfime ui',
      'program manager',
      'dwm notification window'
    ];

    return sources
      .filter(source => {
        const name = (source.name || '').trim().toLowerCase();
        if (IGNORED_EXACT_NAMES.includes(name) || name === 'badiscord') return false;
        return true;
      })
      .map(source => {
        const isScreen = source.id.startsWith('screen:');
        const name = (source.name || '').trim();
        const lowerName = name.toLowerCase();
        const isGame = !isScreen && isGameWindowName(lowerName);

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
          name: name || (isScreen ? 'Monitor Principal' : 'Janela sem título'),
          thumbnail: thumbData,
          appIcon: appIconData,
          isScreen,
          isGame
        };
      });
  } catch (err) {
    console.error('Erro ao listar fontes de captura:', err);
    throw err;
  }
});

ipcMain.handle('camera-permission:grant', (event) => {
  if (!isTrustedRenderer(event)) throw new Error('Origem da solicitação de câmera inválida.');
  cameraPermissionGranted = true;
  return true;
});

ipcMain.handle('start-process-audio-capture', async (event, sourceId) => {
  if (!isTrustedRenderer(event)) {
    throw new Error('Origem da captura de áudio inválida.');
  }
  return startProcessAudioCapture(sourceId);
});

ipcMain.handle('resume-process-audio-capture', (event) => {
  if (!isTrustedRenderer(event) || !processAudioCapture?.headerReady) {
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
  if (!isTrustedRenderer(event)) throw new Error('Origem da captura de áudio inválida.');
  stopProcessAudioCapture();
  return true;
});

// Handler ultra-rápido e leve para detecção de jogos em tempo real (sem gerar thumbnails pesados)
ipcMain.handle('get-detected-game', async (event) => {
  if (!isTrustedRenderer(event)) throw new Error('Origem da detecção de jogos inválida.');
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

    const validWindows = sources.filter(s => {
      const name = (s.name || '').trim().toLowerCase();
      if (!name) return false;
      if (IGNORED_EXACT_NAMES.some(ign => name === ign || name.startsWith('badiscord'))) return false;
      return isGameWindowName(name);
    });

    if (validWindows.length === 0) return null;

    const matchedGame = validWindows[0];

    let appIconData = null;
    try {
      if (matchedGame.appIcon && !matchedGame.appIcon.isEmpty()) {
        appIconData = matchedGame.appIcon.toDataURL();
      }
    } catch (e) {}

    return {
      id: matchedGame.id,
      name: matchedGame.name.trim(),
      isGame: true,
      appIcon: appIconData
    };
  } catch (err) {
    console.error('Erro ao detectar jogo:', err);
    return null;
  }
});

app.whenReady().then(() => {
  app.on('web-contents-created', (event, contents) => {
    contents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const allowedPermissions = ['media', 'camera', 'microphone', 'display-capture'];
      let isTrustedOrigin = false;
      try {
        isTrustedOrigin = new URL(webContents.getURL()).origin === APP_ORIGIN;
      } catch {}

      const requestsCamera = permission === 'camera'
        || (permission === 'media' && details?.mediaTypes?.includes('video'));
      if (isTrustedOrigin && allowedPermissions.includes(permission) && (!requestsCamera || cameraPermissionGranted)) {
        callback(true);
        return;
      }
      callback(false);
    });
  });

  app.on('before-quit', stopProcessAudioCapture);
  createWindow();
  if (app.isPackaged) {
    setTimeout(checkForDesktopUpdates, 5000);
    setInterval(checkForDesktopUpdates, 4 * 60 * 60 * 1000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
}
