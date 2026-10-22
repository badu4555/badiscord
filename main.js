const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');

process.on('uncaughtException', (err) => {
  try {
    fs.writeFileSync(path.join(__dirname, 'crash.log'), (err.stack || String(err)) + '\n');
  } catch (e) {}
});

let mainWindow;

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

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
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
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
