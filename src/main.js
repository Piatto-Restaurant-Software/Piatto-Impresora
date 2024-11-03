const { app, BrowserWindow, ipcMain, globalShortcut } = require("electron");
const cors = require("cors");
const express = require("express");
const bodyParser = require("body-parser");
const { printTicketWithBuffer } = require("./services/pdfUtil");
const os = require("os");
const fs = require("fs");
const path = require("path");
const Handlebars = require("handlebars");
const bonjour = require("bonjour")();
const PrinterService = require("./services/PrinterService");
const UIService = require("./services/UIService");
const { networkInterfaces } = os;

let server;
const uiService = new UIService();

const plantillas = {
  1: "./views/venta_rapida.html",
  2: "./views/precuenta.html",
  3: "./views/",
};

ipcMain.handle("get-connected-printers", async () => {
  try {
    const printers = await PrinterService.getAllConnectedPrinters();
    console.log("Impresoras encontradas:", printers);
    return printers;
  } catch (error) {
    console.error("Error al obtener impresoras:", error);
    return [];
  }
});

function compilarPlantilla(id, datos) {
  const templatePath = path.join(__dirname, plantillas[id]);
  const source = fs.readFileSync(templatePath, "utf8");
  const template = Handlebars.compile(source);
  return template({ ticket: datos });
}

app.whenReady().then(async () => {
  uiService.createMainWindow();  // Mostrar la ventana principal al inicio
  uiService.createTray();

  const expressApp = express();
  expressApp.use(cors());
  expressApp.use(bodyParser.json());
  expressApp.use("/assets", express.static("assets"));

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
        return res.status(404).send({ success: false, message: "Impresora no encontrada" });
      }

      const testData = {
        local: { nombre: "Test", telefono: "000-000-0000" },
        venta: { mesa: "0" },
        pedidos: [
          { cantidad: 1, producto_presentacion: { nombre: "Producto de prueba" }, precio_unitario: 1.0, precio_total: 1.0 }
        ],
        cuenta_venta: { subtotal: 1.0, total: 1.0 }
      };

      await printTicketWithBuffer(testData, printerName);
      res.send({ success: true, message: "Impresión de prueba completada exitosamente" });
    } catch (error) {
      console.error("Error al imprimir el ticket de prueba:", error);
      res.status(500).send({
        success: false,
        message: "Error al imprimir el ticket de prueba",
        error: error.message,
      });
    }
  });

  server = expressApp.listen(3001, () => {
    console.log("Server started on http://localhost:3001");
    const localIP = getLocalIPAddress();
    const bonjourService = bonjour.publish({
      name: "POS-Impresora",
      host: localIP,
      type: "http",
      port: 3001,
      txt: { info: "Servicio de impresión para POS" },
    });

    bonjourService.on("up", () => {
      console.log("Servicio POS-Impresora publicado exitosamente en mDNS");
    });

    bonjourService.on("error", (err) => {
      console.error("Error al publicar el servicio mDNS:", err);
    });
  });

  // Global shortcuts
  globalShortcut.register("CommandOrControl+Q", () => {
    uiService.isQuitting = true;
    app.quit();
  });
});

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
