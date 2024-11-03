const { app, BrowserWindow, Tray, Menu, globalShortcut } = require("electron");

class UIService {
  constructor() {
    this.window = null;
    this.tray = null;
    this.isQuitting = false;
  }

  createMainWindow() {
    this.window = new BrowserWindow({
      show: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    this.window.loadFile("src/views/index.html");

    // this.window.on("close", (event) => {
    //   if (!this.isQuitting) {
    //     event.preventDefault(); // Evita el cierre completo de la aplicación
    //     this.window.hide(); // Oculta la ventana
    //     if (process.platform === "darwin") app.dock.hide(); // Oculta el icono en el dock en macOS
    //     console.log(
    //       "Evento: close - Ventana y dock ocultos, aplicación en segundo plano en el tray"
    //     );
    //   }
    // });

    this.window.on("close", (event) => {
      if (!this.isQuitting) {
        event.preventDefault(); // Previene el cierre completo de la aplicación
        this.window.hide(); // Oculta la ventana
        if (process.platform === "darwin") {
          app.dock.hide(); // Oculta el icono en el dock en macOS
        } else {
          this.window.setSkipTaskbar(true); // Oculta la ventana de la barra de tareas en Windows
        }
        console.log(
          "Evento: close - Ventana oculta, aplicación en segundo plano en el tray"
        );
      }
    });

    this.window.on("show", () => {
      console.log("Evento: show");
      if (process.platform === "darwin") app.dock.show();
    });

    this.window.on("maximize", () => {
      console.log("Evento: maximize");
      // No hagas nada al maximizar, solo registramos el evento
    });

    this.window.on("unmaximize", () => {
      console.log("Evento: unmaximize");
      // No hagas nada al restaurar, solo registramos el evento
    });

    this.window.on("minimize", () => {
      console.log("Evento: minimize");
      // No ocultes ni quites del dock al minimizar
    });

    this.window.on("restore", () => {
      console.log("Evento: restore");
      if (process.platform === "darwin") app.dock.show();
      this.window.show();
    });
  }

  //   createTray() {
  //     this.tray = new Tray("src/assets/icono.png");
  //     const contextMenu = Menu.buildFromTemplate([
  //       {
  //         label: "Mostrar",
  //         click: () => {
  //           console.log("Tray: Mostrar ventana");
  //           this.window.show();
  //         },
  //       },
  //       { type: "separator" },
  //       {
  //         label: "Cerrar",
  //         click: () => {
  //           console.log("Tray: Cerrar aplicación");
  //           this.isQuitting = true;
  //           app.quit();
  //         },
  //       },
  //     ]);

  //     this.tray.setContextMenu(contextMenu);
  //     this.tray.setToolTip("POS Impresora");

  //     this.tray.on("right-click", () => {
  //       console.log("Tray: Menú desplegado");
  //       this.tray.popUpContextMenu();
  //     });
  //   }

  createTray() {
    this.tray = new Tray("src/assets/icono.png");
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
