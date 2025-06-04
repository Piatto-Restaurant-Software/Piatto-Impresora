const { app, ipcMain, globalShortcut } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

const cors = require("cors");
const express = require("express");
const bodyParser = require("body-parser");
const bonjour = require("bonjour")();
const WebSocket = require("ws");
const i18n = require("i18n");
const dgram = require("dgram");

const { setAppDataPath } = require("./services/pdfUtil");
const UIService = require("./services/UIService");
const PrinterService = require("./services/PrinterService");
const printQueue = require("./services/PrintQueue");
const { printTicket } = require("./services/pdfUtil");

let server;
let wss;
const port = 3002;
let lastPrinterState = [];
const uiService = new UIService();
const printerService = new PrinterService();

// Inicialización principal de la aplicación
app.whenReady().then(() => {
  const gotTheLock = app.requestSingleInstanceLock();

  if (!gotTheLock) {
    app.quit();
    return;
  }

  // Configurar el manejo de segunda instancia
  app.on("second-instance", (event, argv, workingDirectory) => {
    if (uiService.window) {
      if (uiService.window.isMinimized()) uiService.window.restore();
      uiService.window.show();
      uiService.window.focus();
    }
  });

  // Configurar inicio automático
  app.setLoginItemSettings({
    openAtLogin: true,
    path: app.getPath("exe"),
    args: ["--hidden"],
  });

  // Configurar la ruta antes de cualquier operación que use pdfUtil
  setAppDataPath(app.getPath("userData"));

  const isHidden = process.argv.includes("--hidden");

  if (isHidden) {
    uiService.createTray(); // Solo crea la bandeja del sistema
  } else {
    uiService.createMainWindow(); // Crea la ventana principal
    uiService.createTray();
  }

  // Configurar WebSocket y atajos globales
  initializeWebSocket();
  globalShortcut.register("CommandOrControl+Q", () => {
    uiService.isQuitting = true;
    app.quit();
  });

  // Inicia el servidor solo si no está corriendo
  startServer();
});

app.on("before-quit", () => {
  uiService.isQuitting = true;
  globalShortcut.unregisterAll();
  stopServer();
  bonjour.unpublishAll(() => bonjour.destroy());
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  stopServer();
  bonjour.unpublishAll(() => bonjour.destroy());
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

function startServer() {
  if (!server) {
    server = expressApp.listen(3001, "0.0.0.0", () => {
      logToRenderer(
        "info",
        `Express server has started on IP: ${getLocalIPAddress()} and port 3001`
      );
      publishBonjourService();
      startUDPBroadcast();
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error(
          "El puerto 3001 ya está en uso. Verifica si el servidor ya está corriendo."
        );
      } else {
        throw err;
      }
    });
  }
}

function stopServer() {
  if (server) {
    server.close(() => {});
    server = null;
  }
}

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

function getBroadcastAddress() {
  const nets = os.networkInterfaces();
  const preferredInterfaces = ["Wi-Fi", "Ethernet", "en0", "eth0"];

  for (const name of preferredInterfaces) {
    const ifaceList = nets[name];
    if (!ifaceList) continue;

    for (const iface of ifaceList) {
      if (iface.family === "IPv4" && !iface.internal && iface.netmask) {
        const ipParts = iface.address.split('.').map(Number);
        const maskParts = iface.netmask.split('.').map(Number);
        const broadcastParts = ipParts.map((ip, i) => ip | (~maskParts[i] & 255));
        return broadcastParts.join('.');
      }
    }
  }

  // Fallback: escoge la primera IPv4 no interna con netmask
  for (const ifaceList of Object.values(nets)) {
    for (const iface of ifaceList) {
      if (iface.family === "IPv4" && !iface.internal && iface.netmask) {
        const ipParts = iface.address.split('.').map(Number);
        const maskParts = iface.netmask.split('.').map(Number);
        const broadcastParts = ipParts.map((ip, i) => ip | (~maskParts[i] & 255));
        return broadcastParts.join('.');
      }
    }
  }

  return "255.255.255.255"; // fallback seguro
}


function startUDPBroadcast() {
  const localIP = getLocalIPAddress();
  const broadcastIP = getBroadcastAddress();

  console.log(`[UDP] Configurando broadcast desde ${localIP} a ${broadcastIP}`);

  const message = JSON.stringify({
    ip: localIP,
    port: 3001,
    serviceName: "POS-Impresora",
    timestamp: Date.now(),
  });

  const udpServer = dgram.createSocket("udp4");

  udpServer.on("listening", () => {
    const address = udpServer.address();
    console.log(`[UDP] Escuchando en ${address.address}:${address.port}`);
    udpServer.setBroadcast(true);
  });

  udpServer.bind(() => {
    console.log("[UDP] Iniciando broadcast...");

    // Enviar inmediatamente al iniciar
    udpServer.send(message, 0, message.length, 12345, broadcastIP, (err) => {
      if (err) console.error("[UDP] Error en primer envío:", err);
    });

    // Configurar intervalo regular
    const interval = setInterval(() => {
      const now = new Date().toISOString();
      // console.debug(`[UDP] Enviando broadcast a ${now}`);
      udpServer.send(message, 0, message.length, 12345, broadcastIP, (err) => {
        if (err) console.error("[UDP] Error en envío periódico:", err);
      });
    }, 1000);

    // Limpiar al cerrar
    udpServer.on("close", () => {
      clearInterval(interval);
      console.log("[UDP] Broadcast detenido");
    });
  });

  udpServer.on("error", (err) => {
    console.error("[UDP] Error en el socket:", err.message);
  });
}

// Configuración de WebSocket

function initializeWebSocket() {
  if (!wss) {
    wss = new WebSocket.Server({ port });

    // Solo obtener impresoras al iniciar
    PrinterService.getAllConnectedPrinters()
      .then((currentPrinters) => {
        lastPrinterState = currentPrinters;
        broadcastPrinterState(currentPrinters);
        console.log("✅ Impresoras detectadas al iniciar:", currentPrinters);
      })
      .catch((err) => {
        console.error("Error al obtener impresoras al iniciar:", err);
      });

    wss.on("connection", (ws) => {
      sendPrinterState(ws);

      ws.on("close", () => {
        // No hay intervalos que limpiar
      });
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
  const nets = os.networkInterfaces();
  const preferredOrder = ["Wi-Fi", "Ethernet", "en0", "eth0"];

  // Buscar interfaces en el orden preferido
  for (const name of preferredOrder) {
    const net = nets[name];
    if (net) {
      for (const iface of net) {
        if (iface.family === "IPv4" && !iface.internal) {
          return iface.address;
        }
      }
    }
  }

  // Fallback: tomar la primera IPv4 no interna
  for (const interfaces of Object.values(nets)) {
    for (const iface of interfaces) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }

  return "127.0.0.1";
}

ipcMain.handle("request-server-info", async () => {
  const localIP = getLocalIPAddress();
  return { localIP, port };
});

app.on("ready", () => {
  console.log("App is ready.");
});

expressApp.get("/api/v1/server/status", (req, res) => {
  const status = {
    status: "running",
    ip: getLocalIPAddress(),
    port: 3001,
    uptime: process.uptime(),
    lastPrinterCheck: new Date().toISOString(),
    printers: lastPrinterState,
  };
  res.send(status);
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

    console.log("DATA RECIBIDA DESDE POST: ", data);
    console.log("TIPO DE IMPRESION: ", ticketType);
    console.log("NOMBRE DE IMPRESORA: ", printerName);

    // Obtener la configuración para abrir gaveta
    const abrirGavetaConfig =
      typeof printerName === "object" && printerName !== null
        ? printerName.abrir_gaveta
        : false; // Por defecto false si no es objeto o no existe la propiedad

    // Manejar printerName (string u objeto)
    const printerNameStr =
      typeof printerName === "string" ? printerName : printerName?.nombre;

    if (!printerNameStr) {
      throw new Error("Formato de printerName inválido");
    }

    // Validar data
    if (!data || (Array.isArray(data) && data.length === 0)) {
      throw new Error("El campo data está vacío");
    }

    // Configurar idioma
    const locale = req.headers["accept-language"] || "es";
    i18n.setLocale(locale);
    const translations = loadedLocales[locale]?.precuenta || {};

    // Impresión para Comanda (múltiples impresoras)
    if (ticketType === "Comanda" && Array.isArray(data)) {
      const results = await processBatchPrint(data, translations, ticketType);
      handleBatchResponse(res, results);
      return;
    }

    // Impresión para otros tipos (Precuenta, Cierre, etc.)
    const dataToPrint = Array.isArray(data) ? data[0] : data;
    await processSinglePrint(
      dataToPrint,
      printerNameStr,
      translations,
      ticketType,
      res,
      abrirGavetaConfig
    );
  } catch (error) {
    console.error("Error al encolar la impresión:", error);
    res.status(500).send({
      success: false,
      message: "Error al encolar la impresión",
      error: error.message,
    });
  }
});

// --- Funciones auxiliares ---
async function processBatchPrint(data, translations, ticketType) {
  const results = { success: [], errors: [] };

  for (const comanda of data) {
    try {
      if (!comanda.impresora?.nombre) {
        throw new Error(
          `Comanda ${comanda.numero_comanda} sin impresora definida`
        );
      }

      const isConnected = await new PrinterService().testPrinterConnection(
        comanda.impresora.nombre
      );
      if (!isConnected) {
        throw new Error(
          `Impresora ${comanda.impresora.nombre} no está conectada`
        );
      }

      printQueue.addJob(async () => {
        await printTicket(
          comanda,
          comanda.impresora.nombre,
          translations,
          ticketType
        );
      }, ticketType);

      results.success.push(comanda.numero_comanda);
    } catch (error) {
      results.errors.push(`${comanda.numero_comanda}: ${error.message}`);
    }
  }

  return results;
}

async function processSinglePrint(
  data,
  printerName,
  translations,
  ticketType,
  res,
  abrirGavetaConfig
) {
  const isConnected = await new PrinterService().testPrinterConnection(
    printerName
  );
  if (!isConnected) {
    return res.status(400).send({
      success: false,
      message: "La impresora no está conectada o activa.",
    });
  }

  printQueue.addJob(async () => {
    await printTicket(data, printerName, translations, ticketType, abrirGavetaConfig);
  }, ticketType);

  res.send({
    success: true,
    message: `Trabajo de impresión encolado: ${ticketType}`,
  });
}

function handleBatchResponse(res, results) {
  if (results.success.length === 0) {
    throw new Error(
      `Ninguna comanda pudo imprimirse. Errores: ${results.errors.join("; ")}`
    );
  }

  res.send({
    success: true,
    message: `${results.success.length} comanda(s) encoladas. ${results.errors.length} error(es)`,
    warnings: results.errors,
  });
}

// expressApp.post("/api/v1/impresion/test", async (req, res) => {
//   try {
//     const { data, printerName, ticketType } = req.body;

//     console.log('DATA RECIBIDA DESDE POST: ', data);
//     console.log('TIPO DE IMPRESION: ', ticketType);

//     // Manejar los dos casos de printerName
//     let printerNameStr;

//     if (typeof printerName === "string") {
//       printerNameStr = printerName;
//     } else if (typeof printerName === "object" && printerName.nombre) {
//       printerNameStr = printerName.nombre;
//     } else {
//       throw new Error("Formato de printerName invalido");
//     }

//     // Validar que data no esté vacío
//     if (!data || (Array.isArray(data) && data.length === 0)) {
//       throw new Error("El campo data esta vacio");
//     }

//     // Obtener idioma del encabezado Accept-Language
//     const locale = req.headers["accept-language"] || "es";
//     i18n.setLocale(locale);
//     const translations = loadedLocales[locale]?.[["precuenta"]] || {};

//     // Impresión para Comanda (varios elementos)
//     if (ticketType === "Comanda" && Array.isArray(data)) {
//       let atLeastOnePrinted = false;
//       let errors = [];

//       for (const comanda of data) {
//         console.log('DATA DEL ARREGLO COMANDA:', comanda);

//         if (!comanda.impresora || !comanda.impresora.nombre) {
//           const errorMsg = `Comanda ${comanda.numero_comanda} sin impresora definida`;
//           console.warn(errorMsg);
//           errors.push(errorMsg);
//           continue;
//         }

//         // Validar tipo de conector (solo USB = 1)
//         if (comanda.impresora.tipo_conector_id !== 1) {
//           const errorMsg = `Comanda ${comanda.numero_comanda} omitida - Impresora ${comanda.impresora.nombre} no es USB (tipo_conector_id=${comanda.impresora.tipo_conector_id})`;
//           console.warn(errorMsg);
//           errors.push(errorMsg);
//           continue;
//         }

//         try {
//           const isConnected = await printerService.testPrinterConnection(comanda.impresora.nombre);

//           if (!isConnected) {
//             const errorMsg = `Impresora ${comanda.impresora.nombre} para comanda ${comanda.numero_comanda} no esta conectada`;
//             console.warn(errorMsg);
//             errors.push(errorMsg);
//             continue;
//           }

//           printQueue.addJob(async () => {
//             const printerInfo = await PrinterService.getNamePrinter(comanda.impresora.nombre);
//             await printTicket(comanda, printerInfo, translations, ticketType);
//           }, ticketType);

//           atLeastOnePrinted = true;
//           console.log(`Comanda ${comanda.numero_comanda} encolada para impresion en ${comanda.impresora.nombre}`);

//         } catch (error) {
//           const errorMsg = `Error al procesar comanda ${comanda.numero_comanda}: ${error.message}`;
//           console.error(errorMsg);
//           errors.push(errorMsg);
//         }
//       }

//       if (!atLeastOnePrinted) {
//         throw new Error(`Ninguna comanda pudo ser impresa. Errores: ${errors.join('; ')}`);
//       }

//       // Respuesta con advertencias si hubo errores parciales
//       if (errors.length > 0) {
//         res.send({
//           success: true,
//           message: 'Trabajo de impresion encolado con algunas advertencias',
//           warnings: errors
//         });
//       } else {
//         res.send({
//           success: true,
//           message: 'Todas las comandas encoladas para impresion correctamente'
//         });
//       }

//       return; // Salir temprano para evitar ejecutar el resto del código

//     } else {
//       // Impresión para otros tipos (Precuenta, full, Cierre, etc.)
//       let dataToPrint;
//       if (Array.isArray(data)) {
//         dataToPrint = data[0];
//       } else if (typeof data === "object") {
//         dataToPrint = data;
//       } else {
//         throw new Error("Formato de data invalido");
//       }

//       // Verificar conexión de la impresora para tickets no-Comanda
//       const isConnected = await printerService.testPrinterConnection(printerNameStr);
//       if (!isConnected) {
//         return res.status(400).send({
//           success: false,
//           message: "La impresora no esta conectada o activa.",
//         });
//       }

//       printQueue.addJob(async () => {
//         const printerInfo = await PrinterService.getNamePrinter(printerNameStr);
//         await printTicket(dataToPrint, printerInfo, translations, ticketType);
//       }, ticketType);

//       // Respuesta inmediata al cliente
//       res.send({
//         success: true,
//         message: `Trabajo de impresion encolado: ${ticketType}`,
//       });
//     }

//   } catch (error) {
//     console.error("Error al encolar la impresion:", error);
//     res.status(500).send({
//       success: false,
//       message: "Error al encolar la impresion",
//       error: error.message,
//     });
//   }
// });

expressApp.get("/api/v1/impresoras/actualizar", async (req, res) => {
  try {
    const currentPrinters = await PrinterService.getAllConnectedPrinters();
    lastPrinterState = currentPrinters;
    broadcastPrinterState(currentPrinters);
    res.send({ success: true, printers: currentPrinters });
  } catch (err) {
    res.status(500).send({ success: false, error: err.message });
  }
});

expressApp.post("/api/v1/impresion/prueba", async (req, res) => {
  try {
    console.log("Iniciando impresión de prueba...");
    const { printerName } = req.body;
    console.log("Impresora recibida:", printerName);

    const isConnected = await new PrinterService().testPrinterConnection(
      printerName
    );
    console.log("Estado de conexión:", isConnected);

    if (!isConnected) {
      console.log("Impresora no conectada");
      return res.status(400).send({
        success: false,
        message: `La impresora "${printerName}" no está conectada o no responde.`,
      });
    }

    const locale = req.headers["accept-language"] || "es";
    i18n.setLocale(locale);
    const translations = loadedLocales[locale]?.precuenta || {};

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

    console.log("Enviando a printTicket...");
    await printTicket(testData, printerName, translations);
    console.log("Impresión completada");

    res.send({
      success: true,
      message: `Impresión de prueba enviada a "${printerName}"`,
    });
  } catch (error) {
    console.error("Error completo en /impresion/prueba:", {
      message: error.message,
      stack: error.stack,
      rawError: error,
    });
    res.status(500).send({
      success: false,
      message:
        "Error al imprimir. Verifica que la impresora esté instalada correctamente.",
      error: error.message,
      details: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});
