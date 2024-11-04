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

    await printTicketWithBuffer(testData, printerName);
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
