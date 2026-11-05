'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('quickPanelDesktop', {
  minimize: () => ipcRenderer.invoke('qp:minimize'),
  close: () => ipcRenderer.invoke('qp:close'),
  expand: () => ipcRenderer.invoke('qp:expand'),
  collapse: () => ipcRenderer.invoke('qp:collapse'),
  getMode: () => ipcRenderer.invoke('qp:mode-state'),
  onMode: (callback) => {
    const handler = (_event, mode) => callback(mode)
    ipcRenderer.on('qp:mode', handler)
    return () => ipcRenderer.removeListener('qp:mode', handler)
  },
  openMenu: () => ipcRenderer.invoke('qp:menu'),
  dragStart: (x, y) => ipcRenderer.invoke('qp:drag-start', x, y),
  dragMove: (x, y) => ipcRenderer.invoke('qp:drag-move', x, y),
  dragEnd: () => ipcRenderer.invoke('qp:drag-end'),
  togglePin: () => ipcRenderer.invoke('qp:pin'),
  pinState: () => ipcRenderer.invoke('qp:pin-state'),
})
