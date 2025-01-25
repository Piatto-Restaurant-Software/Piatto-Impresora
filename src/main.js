const { app, BrowserWindow, ipcMain, globalShortcut } = require("electron");
const cors = require("cors");
const express = require("express");
const bodyParser = require("body-parser");
const { printTicket } = require("./services/pdfUtil");
const printQueue  = require("./services/PrintQueue");
const os = require("os");
const path = require("path");
const bonjour = require("bonjour")();
const PrinterService = require("./services/PrinterService");
const UIService = require("./services/UIService");
const { networkInterfaces } = os;
const WebSocket = require("ws");
const i18n = require("i18n");
const fs = require("fs");
const dgram = require("dgram");

let mainWindow;
let server;
let wss;
const port = 3002;
let lastPrinterState = [];
const uiService = new UIService();
const udpServer = dgram.createSocket("udp4");

function logToRenderer(type, message) {
  if (uiService.window) {
    uiService.window.webContents.send("log-message", { type, message });
  }
}

const expressApp = express();
expressApp.use(cors());
expressApp.use(bodyParser.json());
expressApp.use("/assets", express.static("assets"));

// Endpoint de prueba para verificar que el servidor está activo
expressApp.get("/api/v1/status", (req, res) => {
  res.send({ status: "Server is running" });
});

// Inicia el servidor Express
if (!server) {
  server = expressApp.listen(3001, "0.0.0.0", () => {
    logToRenderer(
      "info",
      `Express server has started on IP: ${getLocalIPAddress()} and port 3001`
    );
    publishBonjourService();
    startUDPBroadcast();
  });
}

function publishBonjourService(retries = 5) {
  const localIP = getLocalIPAddress();
  const bonjourService = bonjour.publish({
    name: "POS-Impresora",
    host: localIP,
    type: "http",
    port: 3001,
    txt: { info: "Servicio de impresión para POS" },
  });

  bonjourService.on("up", () => {});

  bonjourService.on("error", (err) => {
    console.error("Error publishing Bonjour service:", err.message);
    if (retries > 0) {
      setTimeout(() => publishBonjourService(retries - 1), 1000);
    }
  });
}

function startUDPBroadcast() {
  const localIP = getLocalIPAddress();
  const message = JSON.stringify({
    ip: localIP,
    port: 3001,
    serviceName: "POS-Impresora",
  });

  const udpServer = dgram.createSocket("udp4");

  udpServer.bind(() => {
    udpServer.setBroadcast(true);
    setInterval(() => {
      const subnetBroadcast = localIP.replace(/\d+$/, "255");
      udpServer.send(message, 0, message.length, 12345, subnetBroadcast);
    }, 1000); // Envía el mensaje cada segundo
  });

  udpServer.on("error", (err) => {
    console.error("Error en el servidor UDP:", err.message);
  });
}

// Configuración de WebSocket
function initializeWebSocket() {
  if (!wss) {
    wss = new WebSocket.Server({ port });

    wss.on("connection", (ws) => {
      sendPrinterState(ws);

      setInterval(async () => {
        const currentPrinters = await PrinterService.getAllConnectedPrinters();

        if (
          JSON.stringify(currentPrinters) !== JSON.stringify(lastPrinterState)
        ) {
          lastPrinterState = currentPrinters;
          broadcastPrinterState(currentPrinters);
        }
      }, 5000);
    });

    wss.on("error", (error) => {
      console.error("Error en el servidor WebSocket:", error);
    });
  }
}

function sendPrinterState(ws) {
  ws.send(JSON.stringify(lastPrinterState));
}

function broadcastPrinterState(printerState) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(printerState));
    }
  });
}

function getLocalIPAddress() {
  const nets = networkInterfaces();

  // Priorizar la interfaz Ethernet
  for (const [name, interfaces] of Object.entries(nets)) {
    if (name.toLowerCase().includes("ethernet")) {
      for (const net of interfaces) {
        if (net.family === "IPv4" && !net.internal) {
          return net.address;
        }
      }
    }
  }

  // Si no encuentra Ethernet, toma la primera IPv4 no interna
  for (const interfaces of Object.values(nets)) {
    for (const net of interfaces) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }

  return "127.0.0.1";
}

ipcMain.handle("request-server-info", async () => {
  const localIP = getLocalIPAddress();
  return { localIP, port };
});

app.whenReady().then(() => {
  // Configurar inicio automático
  app.setLoginItemSettings({
    openAtLogin: true,
    path: app.getPath("exe"),
  });

  const wasLaunchedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin;

  if (wasLaunchedAtLogin) {
    uiService.createTray(); // Solo crea la bandeja del sistema
  } else {
    uiService.createMainWindow(); // Crea la ventana principal
    uiService.createTray(); // También muestra la bandeja
  }

  // Configurar WebSocket y atajos globales
  initializeWebSocket();
  globalShortcut.register("CommandOrControl+Q", () => {
    uiService.isQuitting = true;
    app.quit();
  });
});

app.on("ready", () => {
  console.log("App is ready.");
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

app.on("before-quit", () => {
  uiService.isQuitting = true;
  globalShortcut.unregisterAll();
  if (server) server.close();
  bonjour.unpublishAll(() => bonjour.destroy());
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (server) server.close();
  bonjour.unpublishAll(() => bonjour.destroy());
});

// i18n
// Verifica si la aplicación está empaquetada y ajusta la ruta de las traducciones
const localesPath = app.isPackaged
  ? path.join(process.resourcesPath, "i18n")
  : path.join(__dirname, "i18n");

// Función para cargar archivos JSON de subcarpetas y combinarlos
function loadLocaleFiles(locale) {
  const localeDir = path.join(localesPath, locale);
  const translations = {};

  // Lee cada archivo JSON en el directorio de un idioma (e.g., en/interface.json)
  fs.readdirSync(localeDir).forEach((file) => {
    const filePath = path.join(localeDir, file);
    const fileContents = JSON.parse(fs.readFileSync(filePath, "utf-8"));

    // Usa el nombre del archivo sin extensión como clave para las traducciones
    const namespace = path.basename(file, ".json");
    translations[namespace] = fileContents;
  });

  return translations;
}

// Cargar los archivos de todos los idiomas soportados y configurarlos en i18n
const loadedLocales = {};
["en", "es"].forEach((locale) => {
  loadedLocales[locale] = loadLocaleFiles(locale);
});

// Configuración de i18n
i18n.configure({
  directory: localesPath,
  locales: ["en", "es"],
  defaultLocale: "es",
  objectNotation: true,
  register: global,
  updateFiles: false,
  directoryPermissions: "755",
});

// Envía las traducciones completas al renderizador cuando se carga la ventana principal
ipcMain.handle("get-translations", async (_, locale) => {
  return loadedLocales[locale] || loadedLocales["es"];
});

//Endpoints
expressApp.post("/api/v1/impresion/test", async (req, res) => {
  try {
    const { data, printerName, ticketType } = req.body;

    // Manejar los dos casos de printerName
    let printerNameStr;

    if (typeof printerName === "string") {
      printerNameStr = printerName;
    } else if (typeof printerName === "object" && printerName.nombre) {
      printerNameStr = printerName.nombre;
    } else {
      throw new Error("Formato de printerName inválido");
    }

    // Validar que data no esté vacío
    if (!data || (Array.isArray(data) && data.length === 0)) {
      throw new Error("El campo data está vacío");
    }

    // Determinar el elemento a imprimir según el tipo de data
    let dataToPrint;
    if (Array.isArray(data)) {
      dataToPrint = data[0];
    } else if (typeof data === "object") {
      dataToPrint = data;
    } else {
      throw new Error("Formato de data inválido");
    }

    // Agregar el trabajo de impresión a la cola con la prioridad basada en el tipo de ticket
    printQueue.addJob(async () => {
      const printerInfo = await PrinterService.getNamePrinter(printerNameStr);

      // Obtener el idioma del encabezado Accept-Language, o usa 'es' como predeterminado
      const locale = req.headers["accept-language"] || "es";
      i18n.setLocale(locale);

      // Cargar traducciones localizadas para el ticket
      const translations = loadedLocales[locale]?.[["precuenta"]] || {};

      // Ejecutar la impresión
      await printTicket(dataToPrint, printerInfo, translations, ticketType);

      console.log(`Impresión completada: ${ticketType}`);
    }, ticketType);

    // Respuesta inmediata al cliente
    res.send({
      success: true,
      message: `Trabajo de impresión encolado: ${ticketType}`,
    });
  } catch (error) {
    console.error("Error al encolar la impresión:", error);
    res.status(500).send({
      success: false,
      message: "Error al encolar la impresión",
      error: error.message,
    });
  }
});


expressApp.post("/api/v1/impresion/prueba", async (req, res) => {
  try {
    const { printerName } = req.body;
    const printerInfo = await PrinterService.findPrinterByName(printerName);

    if (!printerInfo) {
      return res
        .status(404)
        .send({ success: false, message: "Impresora no encontrada" });
    }

    // Obtener el idioma del encabezado Accept-Language, o usa 'es' como predeterminado
    const locale = req.headers["accept-language"] || "es";
    i18n.setLocale(locale);

    // Cargar traducciones localizadas para el ticket
    const translations = loadedLocales[locale].precuenta;

    // Datos de prueba para el ticket
    const testData = {
      local: { nombre: "Test", telefono: "000-000-0000" },
      venta: { mesa: "0" },
      pedidos: [
        {
          cantidad: 1,
          producto_presentacion: { nombre: "Producto de prueba" },
          precio_unitario: 1.0,
          precio_total: 1.0,
        },
      ],
      cuenta_venta: { subtotal: 1.0, total: 1.0 },
    };

    // Pasar el ticketData y las traducciones localizadas a la función de impresión
    await printTicket(testData, printerName, translations);
    res.send({
      success: true,
      message: "Impresión de prueba completada exitosamente",
    });
  } catch (error) {
    console.error("Error al imprimir el ticket de prueba:", error);
    res.status(500).send({
      success: false,
      message: "Error al imprimir el ticket de prueba",
      error: error.message,
    });
  }
});
