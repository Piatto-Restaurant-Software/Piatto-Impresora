const { app, BrowserWindow, ipcMain, globalShortcut } = require("electron");
const cors = require("cors");
const express = require("express");
const bodyParser = require("body-parser");
const { printTicketWithBuffer } = require("./services/pdfUtil");
const os = require("os");
const path = require("path");
const bonjour = require("bonjour")();
const PrinterService = require("./services/PrinterService");
const UIService = require("./services/UIService");
const { networkInterfaces } = os;
const WebSocket = require("ws");
const i18n = require("i18n");
const fs = require("fs");

let mainWindow;
let server;
let wss;
const port = 3002;
let lastPrinterState = [];
const uiService = new UIService();

function logToRenderer(type, message) {
  if (uiService.window) {
    uiService.window.webContents.send("log-message", { type, message });
  }
}

console.log("Attempting to start Express server (outside whenReady)...");

const expressApp = express();
expressApp.use(cors());
expressApp.use(bodyParser.json());
expressApp.use("/assets", express.static("assets"));

// Endpoint de prueba para verificar que el servidor está activo
expressApp.get("/api/v1/status", (req, res) => {
  res.send({ status: "Server is running" });
  console.log("Status endpoint hit");
});

// Inicia el servidor Express
server = expressApp.listen(3001, "0.0.0.0", () => {
  console.log(
    "Express server has started on IP:",
    getLocalIPAddress(),
    "and port 3001"
  );
  logToRenderer(
    "info",
    `Express server has started on IP: ${getLocalIPAddress()} and port 3001`
  );
  publishBonjourService();
});

function publishBonjourService(retries = 5) {
  const localIP = getLocalIPAddress();
  const bonjourService = bonjour.publish({
    name: "POS-Impresora",
    host: localIP,
    type: "http",
    port: 3001,
    txt: { info: "Servicio de impresión para POS" },
  });

  bonjourService.on("up", () => {
    console.log("Bonjour service published successfully");
  });

  bonjourService.on("error", (err) => {
    console.error("Error publishing Bonjour service:", err.message);
    if (retries > 0) {
      console.log(`Retrying Bonjour publish... (${retries} retries left)`);
      setTimeout(() => publishBonjourService(retries - 1), 1000);
    }
  });
}

// Configuración de WebSocket
function initializeWebSocket() {
  if (!wss) {
    wss = new WebSocket.Server({ port });
    console.log(`WebSocket iniciado en ws://localhost:${port}`);

    wss.on("connection", (ws) => {
      console.log("Cliente WebSocket conectado");
      sendPrinterState(ws);

      setInterval(async () => {
        const currentPrinters = await PrinterService.getAllConnectedPrinters();
        if (
          JSON.stringify(currentPrinters) !== JSON.stringify(lastPrinterState)
        ) {
          lastPrinterState = currentPrinters;
          broadcastPrinterState(currentPrinters);
        }
      }, 500);
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
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
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
  initializeWebSocket();
  uiService.createMainWindow();
  uiService.createTray();

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
  locales: ["en", "es"],
  defaultLocale: "es",
  objectNotation: true,
  register: global,
  updateFiles: false,
  directoryPermissions: "755",
});

// Envía las traducciones completas al renderizador cuando se carga la ventana principal
ipcMain.handle("get-translations", async (_, locale) => {
  console.log("Idioma solicitado:", locale);
  return loadedLocales[locale] || loadedLocales["es"]; // En caso de que no exista, envía el español por defecto
});


//Endpoints
expressApp.post("/api/v1/impresion/test", async (req, res) => {
  try {
    const { data, printerName } = req.body;
    const printerInfo = await PrinterService.findPrinterByName(printerName);

    console.log("Impresora encontrada:", printerInfo);

    await printTicketWithBuffer(data, printerName);
    res.send({ success: true, message: "Impresión completada exitosamente" });
  } catch (error) {
    console.error("Error al imprimir el ticket:", error);
    res.status(500).send({
      success: false,
      message: "Error al imprimir el ticket",
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
    const locale = req.headers["Accept-Language"] || "es";
    i18n.setLocale(locale); // Configura el idioma para cargar las traducciones correctas
    console.log("Locale: ", locale)
    console.log("Locale configurado en i18n:", i18n.getLocale());
    console.log("Acceso directo a precuenta:", i18n.__("precuenta"));
    console.log("Acceso directo a precuenta.pre_bill:", i18n.__("precuenta.pre_bill"));


    // Cargar traducciones localizadas para el ticket
    const translations = {
      title: i18n.__("precuenta.pre_bill"), 
      subtotal: i18n.__("precuenta.subtotal"), 
      total: i18n.__("precuenta.total"), 
      thankYou: i18n.__("precuenta.thank_you"), 
      comeAgain: i18n.__("precuenta.come_again"),
      table: i18n.__("precuenta.table"), 
      qty: i18n.__("precuenta.qty"), 
      product: i18n.__("precuenta.product"), 
      unit_price: i18n.__("precuenta.unit_price"), 
      product_total: i18n.__("precuenta.product_total") 
    };

    console.log("Json enviado tra: ", translations)
    

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
    await printTicketWithBuffer(testData, printerName, translations);
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
