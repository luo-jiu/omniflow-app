const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dragDropLab', {
  getEnvironment: () => ipcRenderer.invoke('drag-drop-lab:get-environment'),
  onBrowserEvent: (listener) => {
    const wrapped = (_event, payload) => listener(payload)
    ipcRenderer.on('drag-drop-lab:browser-event', wrapped)
    return () => ipcRenderer.removeListener('drag-drop-lab:browser-event', wrapped)
  },
  resetPage: () => ipcRenderer.invoke('drag-drop-lab:reset-page'),
  revealFixture: () => ipcRenderer.invoke('drag-drop-lab:reveal-fixture'),
  setNavigateOnDrop: (enabled) => ipcRenderer.invoke('drag-drop-lab:set-navigate-on-drop', enabled),
  startNativeDrag: () => ipcRenderer.send('drag-drop-lab:start-native-drag'),
})
