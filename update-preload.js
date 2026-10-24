const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopUpdate', {
  getState: () => ipcRenderer.invoke('desktop-update:get-state'),
  download: () => ipcRenderer.invoke('desktop-update:download'),
  install: () => ipcRenderer.invoke('desktop-update:install'),
  close: () => ipcRenderer.invoke('desktop-update:close'),
  retry: () => ipcRenderer.invoke('desktop-update:retry'),
  onState: (callback) => {
    const listener = (event, state) => callback(state);
    ipcRenderer.on('desktop-update:state', listener);
    return () => ipcRenderer.removeListener('desktop-update:state', listener);
  }
});
