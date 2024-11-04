const { contextBridge, ipcRenderer } = require("electron");
const path = require("path");

contextBridge.exposeInMainWorld("electron", {
  ipcRenderer: ipcRenderer,
});

contextBridge.exposeInMainWorld("paths", {
  assetsPath: process.env.NODE_ENV === "production"
    ? path.join(process.resourcesPath, "assets")
    : path.join(__dirname, "assets"),
});
