const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  getDetectedGame: () => ipcRenderer.invoke('get-detected-game'),
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
