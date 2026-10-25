const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setStreamFullscreen: (enabled) => ipcRenderer.invoke('stream-fullscreen:set', enabled),
  onStreamFullscreenChanged: (callback) => {
    const listener = (event, enabled) => callback(enabled);
    ipcRenderer.on('stream-fullscreen:changed', listener);
    return () => ipcRenderer.removeListener('stream-fullscreen:changed', listener);
  },
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  getDetectedGame: () => ipcRenderer.invoke('get-detected-game'),
  grantCameraPermission: () => ipcRenderer.invoke('camera-permission:grant'),
  startProcessAudioCapture: (sourceId) => ipcRenderer.invoke('start-process-audio-capture', sourceId),
  resumeProcessAudioCapture: () => ipcRenderer.invoke('resume-process-audio-capture'),
  stopProcessAudioCapture: () => ipcRenderer.invoke('stop-process-audio-capture'),
  onProcessAudioChunk: (callback) => {
    const listener = (event, chunk) => callback(chunk);
    ipcRenderer.on('process-audio-chunk', listener);
    return () => ipcRenderer.removeListener('process-audio-chunk', listener);
  },
  onProcessAudioError: (callback) => {
    const listener = (event, message) => callback(message);
    ipcRenderer.on('process-audio-error', listener);
    return () => ipcRenderer.removeListener('process-audio-error', listener);
  }
});
