const { app, BrowserWindow, Tray, Menu, globalShortcut } = require("electron");
const path = require("path");

class UIService {
  constructor() {
    this.window = null;
    this.tray = null;
    this.isQuitting = false;
  }

  createMainWindow() {
    // Verifica si la aplicación está empaquetada
    const isPackaged = app.isPackaged;

    // Determina la ruta del preload y del archivo HTML en función del entorno
    const preloadPath = isPackaged
      ? path.join(process.resourcesPath, "preload.js")
      : path.join(__dirname, "../preload.js");




    const htmlPath = isPackaged
      ? path.join(process.resourcesPath, "views", "index.html")
      : path.join(__dirname, "../views/index.html");



    // Ruta del icono en formato .icns para el dock
    const dockIconPath = isPackaged
      ? path.join(process.resourcesPath, "assets", "iconoDock.icns")
      : path.join(__dirname, "../assets/iconoDock.icns");


    this.window = new BrowserWindow({
      icon: dockIconPath,
      show: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: true, // Cambiamos a true para usar contextBridge de forma segura
        preload: preloadPath,
      },
    });

    // Carga el archivo HTML según el entorno
    this.window.loadFile(htmlPath);

    // this.window.loadFile("src/views/index.html");

    this.window.webContents.on("did-finish-load", () => {
      setTimeout(() => {

        this.window.webContents.send("request-server-info");
      }, 2000); // Ajusta el retraso si es necesario
    });

    // Evento cuando la ventana se enfoca
    this.window.on("focus", () => {
      // Vuelve a registrar el atajo Command+Q
      this.registerQuitShortcut();
    });

    // Evento cuando la ventana pierde el foco
    this.window.on("blur", () => {
      // Desactiva el atajo Command+Q
      globalShortcut.unregister("CommandOrControl+Q");
    });

    this.window.on("close", (event) => {
      if (!this.isQuitting) {
        event.preventDefault(); // Previene el cierre completo de la aplicación
        this.window.hide(); // Oculta la ventana
        if (process.platform === "darwin") {
          app.dock.hide(); // Oculta el icono en el dock en macOS
        } else {
          this.window.setSkipTaskbar(true); // Oculta la ventana de la barra de tareas en Windows
        }


        // Desactiva el atajo Command+Q
        globalShortcut.unregister("CommandOrControl+Q");
      }
    });

    this.window.on("show", () => {
      console.log("Evento: show");
      if (process.platform === "darwin") app.dock.show();
      // Vuelve a registrar el atajo Command+Q
      this.registerQuitShortcut();
    });

    this.window.on("maximize", () => {
      // Se registra el evento
      console.log("Evento: maximize");
    });

    this.window.on("unmaximize", () => {
      // Se registra el evento
      console.log("Evento: unmaximize");
    });

    this.window.on("minimize", () => {
      // No quita ni oculta en el dock
      console.log("Evento: minimize");
    });

    this.window.on("restore", () => {
      console.log("Evento: restore");
      if (process.platform === "darwin") app.dock.show();
      this.window.show();
      // Vuelve a registrar el atajo Command+Q
      this.registerQuitShortcut();
    });
  }

  registerQuitShortcut() {
    globalShortcut.register("CommandOrControl+Q", () => {
      if (this.window.isVisible() && this.window.isFocused()) {
        this.isQuitting = true;
        app.quit();
      } else {
        console.log(
          "El atajo Command+Q fue ignorado porque la app está en segundo plano"
        );
      }
    });
  }

  createTray() {
    // Verifica si la aplicación está empaquetada
    const isPackaged = app.isPackaged;
    console.log("Empaquetado 2: ", isPackaged);
    const trayIconPath = isPackaged
      ? path.join(process.resourcesPath, "assets", "icono.png")
      : path.join(__dirname, "../assets/icono.png");

    console.log("Ruta de icono: ", trayIconPath);
    this.tray = new Tray(trayIconPath);
    // this.tray = new Tray("src/assets/icono.png");
    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Mostrar",
        click: () => {
          console.log("Tray: Mostrar ventana");
          this.window.show(); // Muestra la ventana
          if (process.platform === "win32") {
            this.window.setSkipTaskbar(false); // Asegura que aparezca en la barra de tareas en Windows
          } else if (process.platform === "darwin") {
            app.dock.show(); // Asegura que aparezca en el dock en macOS
          }
        },
      },
      { type: "separator" },
      {
        label: "Cerrar",
        click: () => {
          console.log("Tray: Cerrar aplicación");
          this.isQuitting = true;
          app.quit();
        },
      },
    ]);

    this.tray.setContextMenu(contextMenu);
    this.tray.setToolTip("POS Impresora");

    this.tray.on("right-click", () => {
      console.log("Tray: Menú desplegado");
      this.tray.popUpContextMenu();
    });
  }
}

module.exports = UIService;
