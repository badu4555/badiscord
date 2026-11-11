const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gameOverlayAPI', {
  onState: (callback) => {
    const listener = (event, state) => callback(state);
    ipcRenderer.on('game-overlay:state', listener);
    return () => ipcRenderer.removeListener('game-overlay:state', listener);
  }
});
