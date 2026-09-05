const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const os = require("os");

const {
  COMPROBANTE_CREDITO_FISCAL,
  GT_PEQUENO_CONTRIBUYENTE,
} = require("../constants/tipo-documento-factura-constant");

// Librería de impresión
const { Printer, InMemory, Align, Drawer } = require("escpos-buffer");
const { ImageManager } = require("escpos-buffer-image");

const {
  GUATEMALA,
  HONDURAS,
  PANAMA,
  EL_SALVADOR,
} = require("../constants/pais-constant");

// Variables para almacenar las rutas (se establecerán desde main.js)
let outputDir;
let outputPath;

// Función para establecer las rutas desde el proceso principal
function setAppDataPath(userDataPath) {
  outputDir = userDataPath;
  outputPath = path.join(outputDir, "ticket_output.bin");
}

/**
 * Genera una imagen QR optimizada para impresoras térmicas (Anti-bleed).
 * evita que la tinta térmica se expanda.
 */
function generateAntiBleedQR(qrData, targetSize = 350) {
  const QRCode = require("qrcode");
  const { Image } = require("escpos-buffer");

  const qrMatrix = QRCode.create(qrData, { errorCorrectionLevel: "L" });
  const moduleCount = qrMatrix.modules.size;
  const modules = qrMatrix.modules.data; // Array 1D (1 oscuro, 0 claro)

  let scale = Math.floor(targetSize / moduleCount);
  if (scale < 3) scale = 3;
  if (scale > 8) scale = 8;

  const paddingModules = 4;
  const totalModules = moduleCount + paddingModules * 2;
  const finalSize = totalModules * scale;

  const extraWidth = finalSize % 8 === 0 ? 0 : 8 - (finalSize % 8);
  const printWidth = finalSize + extraWidth;

  const buf = Buffer.alloc(printWidth * finalSize * 4, 255);

  for (let y = 0; y < moduleCount; y++) {
    for (let x = 0; x < moduleCount; x++) {
      if (modules[y * moduleCount + x]) {
        // ANTI-BLEED LOGIC
        const shave = scale > 3 ? 1 : 0;

        const startX = (x + paddingModules) * scale;
        const startY = (y + paddingModules) * scale;
        const endX = (x + paddingModules + 1) * scale - 1 - shave;
        const endY = (y + paddingModules + 1) * scale - 1 - shave;

        for (let drawY = startY; drawY <= endY; drawY++) {
          for (let drawX = startX; drawX <= endX; drawX++) {
            const idx = (drawY * printWidth + drawX) * 4;
            buf[idx] = 0;
            buf[idx + 1] = 0;
            buf[idx + 2] = 0;
          }
        }
      }
    }
  }

  return new Image({
    width: printWidth,
    height: finalSize,
    data: buf,
  });
}

/**
 * Imprime un ticket según el tipo y el sistema operativo
 * @param {Object} ticketData - Datos del ticket
 * @param {String} printerName - Nombre de la impresora
 * @param {Object} translations - Traducciones de textos
 * @param {String} ticketType - Tipo de ticket ("full", "Precuenta", "Comanda")
 */
async function printTicket(
  ticketData,
  printerName,
  translations,
  ticketType,
  abrirGavetaConfig,
) {
  try {
    if (os.platform() === "win32") {
      await printTicketWindows(
        ticketData,
        printerName,
        translations,
        ticketType,
        abrirGavetaConfig,
      );
    } else {
      await printTicketUnix(
        ticketData,
        printerName,
        translations,
        ticketType,
        abrirGavetaConfig,
      );
    }
  } catch (error) {
    console.error("Error en printTicket:", error);
    throw error; // Propaga el error para manejo superior
  }
}

/**
 * Imprime un ticket en sistemas Unix (macOS/Linux)
 */
async function printTicketUnix(
  ticketData,
  printerName,
  translations,
  ticketType,
) {
  const connection = new InMemory();
  const printer = await Printer.CONNECT("POS-80", connection);

  try {
    // Diseñar el ticket según el tipo
    if (ticketType === "full") {
      await designFullTicket(printer, connection, ticketData, translations);
    } else if (ticketType === "Precuenta") {
      await designPreBillUnix(printer, ticketData, translations);
    } else if (ticketType === "Comanda") {
      await designOrderSlipUnix(printer, ticketData, translations);
    } else {
      await designTestTicket(printer, ticketData, translations);
    }

    // Generar archivo temporal
    const tempFile = path.join(os.tmpdir(), `ticket_${Date.now()}.prn`);
    fs.writeFileSync(tempFile, connection.buffer());

    // Requerimos execFile de child_process al inicio del archivo si no está (o lo usamos directamente si ya destructuramos exec)
    // Para no romper la importación superior, llamamos a child_process.execFile
    const { execFile } = require("child_process");

    await new Promise((resolve, reject) => {
      execFile("lp", ["-d", printerName, tempFile], (error, stdout, stderr) => {
        try {
          fs.unlinkSync(tempFile);
        } catch (e) {} // Limpiar archivo temporal
        if (error) {
          console.error("Error al imprimir en Unix:", error, stderr);
          return reject(
            new Error(
              `No se pudo imprimir en ${printerName}: ${error.message}`,
            ),
          );
        }
        console.log(`Ticket enviado a ${printerName}`);
        resolve();
      });
    });
  } catch (error) {
    console.error("Error en printTicketUnix:", error);
    throw error;
  }
}

/** Imprime test de prueba como ticket */
async function designTestTicket(printer, testData, translations) {
  console.time("TestTicket_Speed");

  // --- CONSTANTES ESC/POS ---
  const ESC = "\x1B";
  const GS = "\x1D";
  const JUSTIFY_CENTER = ESC + "a\x01";
  const JUSTIFY_LEFT = ESC + "a\x00";
  const JUSTIFY_RIGHT = ESC + "a\x02";
  const TEXT_BOLD_LARGE = ESC + "!\x30";
  const TEXT_NORMAL = ESC + "!\x00";
  const CUT_PAPER = GS + "V\x41\x00";

  const SEPARATOR = "=".repeat(48) + "\n";
  const LINE_SEPARATOR = "-".repeat(48) + "\n";

  // Acumulador de buffer
  let b = "";

  // --- INICIO DEL DISEÑO ---
  b += ESC + "d\x01"; // Feed inicial
  b += JUSTIFY_CENTER;
  b += TEXT_BOLD_LARGE + "TICKET DE PRUEBA\n" + TEXT_NORMAL;
  b += SEPARATOR;

  // Información del local
  b += `${testData.local.nombre}\n`;
  b += `${testData.local.telefono}\n`;
  b += SEPARATOR;

  // Información de la venta
  b += JUSTIFY_LEFT;
  b += `${translations.table}: ${testData.venta.mesa}\n`;
  b += SEPARATOR;

  // Encabezado de tabla
  b += `${translations.qty.padEnd(6)}${translations.product.padEnd(20)}  ${translations.unit_price.padStart(8)}  ${translations.product_total.padStart(8)}\n`;
  b += LINE_SEPARATOR;

  // Lista de productos
  for (const pedido of testData.pedidos) {
    const cantidad = pedido.cantidad.toString().padEnd(6);
    const pUnitario = `$${pedido.precio_unitario.toFixed(2)}`.padStart(8);
    const pTotal = `$${pedido.precio_total.toFixed(2)}`.padStart(8);
    const producto = pedido.producto_presentacion.nombre;

    // Lógica de división de texto optimizada
    let lineasProducto = [];
    if (producto.length > 20) {
      let palabras = producto.split(" ");
      let lineaActual = "";
      for (let palabra of palabras) {
        if ((lineaActual + palabra).length > 20) {
          lineasProducto.push(lineaActual.trim());
          lineaActual = palabra + " ";
        } else {
          lineaActual += palabra + " ";
        }
      }
      lineasProducto.push(lineaActual.trim());
    } else {
      lineasProducto.push(producto);
    }

    // Primera línea: Cantidad | Producto | P.U | Total
    b += `${cantidad}${lineasProducto[0].padEnd(20)}  ${pUnitario}  ${pTotal}\n`;

    // Líneas adicionales del nombre
    for (let i = 1; i < lineasProducto.length; i++) {
      b += `      ${lineasProducto[i]}\n`; // Indentación de 6 espacios
    }
  }

  b += LINE_SEPARATOR;

  // Totales
  b += JUSTIFY_RIGHT;
  b += `${translations.subtotal}: $${testData.cuenta_venta.subtotal.toFixed(2)}\n`;
  b +=
    TEXT_BOLD_LARGE +
    `${translations.total}: $${testData.cuenta_venta.total.toFixed(2)}\n` +
    TEXT_NORMAL;

  // Pie de página
  b += JUSTIFY_CENTER + SEPARATOR;
  b += `${translations.thank_you}\n`;
  b += `${translations.come_again}\n`;

  // Salto y corte
  b += ESC + "d\x06"; // Feed 6
  b += CUT_PAPER;

  // --- ENVÍO ÚNICO ---
  try {
    await printer.write(b);
    console.timeEnd("TestTicket_Speed");
    console.log("¡Ticket de prueba enviado exitosamente!");
  } catch (err) {
    console.error("Error imprimiendo ticket de prueba:", err);
  }
}

/**
 * Impreme Ticket de cierre de caja Resumido Windows
 */
async function designTicketCierreWindows(printer, data, translations) {
  console.time("Cierre_Speed");

  // --- CONSTANTES ESC/POS ---
  const ESC = "\x1B";
  const GS = "\x1D";
  const JUSTIFY_CENTER = ESC + "a\x01";
  const JUSTIFY_LEFT = ESC + "a\x00";
  const TEXT_BOLD = ESC + "!\x08";
  const TEXT_NORMAL = ESC + "!\x00";
  const CUT_PAPER = GS + "V\x41\x00";

  const SEPARATOR = "=".repeat(48) + "\n";
  const LINE_SEPARATOR = "-".repeat(48) + "\n";

  // Helper para dividir texto largo
  function splitText(text, length) {
    if (!text) return ["-"];
    const words = text.split(" ");
    const lines = [];
    let currentLine = "";
    for (const word of words) {
      if ((currentLine + word).length > length) {
        lines.push(currentLine.trim());
        currentLine = word + " ";
      } else {
        currentLine += word + " ";
      }
    }
    lines.push(currentLine.trim());
    return lines;
  }

  // Acumulador de buffer
  let b = "";

  // Helper para filas alineadas (ahora solo concatena al string 'b')
  const addRow = (label, value) => {
    const val = (value || "0").toString();
    b += `${label.toString().padEnd(30)}${val.padStart(18)}\n`;
  };

  // --- INICIO DEL DISEÑO ---
  b += ESC + "d\x01"; // Feed 1
  b += JUSTIFY_CENTER + TEXT_BOLD + "CIERRE DE CAJA\n" + TEXT_NORMAL;
  b += SEPARATOR;

  // Información principal
  b += JUSTIFY_LEFT;
  b += `Caja: ${data.nombre_caja_aperturada}\n`;
  b += `Usuario Apertura: ${data.usuario_apertura}\n`;
  b += `Usuario Cierre: ${data.usuario_cierre}\n`;
  b += `Fecha Apertura: ${data.fecha_apertura}\n`;
  b += `Fecha Cierre: ${data.fecha_cierre}\n`;
  b += SEPARATOR;

  // Resumen de Caja
  b += JUSTIFY_CENTER + "RESUMEN DE CAJA\n" + SEPARATOR;
  b += JUSTIFY_LEFT;
  addRow("Total Apertura:", data.total_apertura);

  if (Array.isArray(data.totales_metodos)) {
    for (const metodo of data.totales_metodos) {
      addRow(`${metodo.metodo}:`, metodo.total);
    }
  }

  addRow("Total en Caja (efectivo):", data.total_caja_efectivo);
  addRow("Total en Caja (general):", data.total_caja_general);
  addRow("Venta credito general:", data.venta_credito_general);
  addRow("Venta credito intermediario:", data.total_credito_intermediarios);

  if (
    Array.isArray(data.venta_credito_intermediarios) &&
    data.venta_credito_intermediarios.length > 0
  ) {
    b += LINE_SEPARATOR;
    for (const venta of data.venta_credito_intermediarios) {
      addRow(venta.nombre, venta.total);
    }
    b += LINE_SEPARATOR;
  }
  b += SEPARATOR;

  // Ingresos y Egresos
  b += JUSTIFY_CENTER + "INGRESOS Y EGRESOS EN CAJA\n" + SEPARATOR;
  b += JUSTIFY_LEFT;
  addRow("Ingresos:", data.total_ingresos);
  addRow("Egresos:", data.total_gastos);

  if (Array.isArray(data.totales_propina_predeterminada)) {
    for (const propina of data.totales_propina_predeterminada) {
      addRow(`${propina.metodo}:`, propina.total);
    }
  }

  if (Array.isArray(data.totales_creditos_cobrados)) {
    for (const credito of data.totales_creditos_cobrados) {
      addRow(`${credito.metodo}:`, credito.total);
    }
  }
  b += SEPARATOR;

  // Descuentos
  b += JUSTIFY_CENTER + "DESCUENTOS APLICADOS\n" + SEPARATOR;
  b += JUSTIFY_LEFT;
  addRow("Descuentos a pedidos:", data.total_descuento_pedido);
  addRow("Descuentos al consumo:", data.total_descuento_consumo);
  addRow("Descuentos a la venta:", data.total_descuento_venta);
  b += SEPARATOR;

  // Productos Vendidos (La sección más pesada)
  if (data.pedidos && data.pedidos.length > 0) {
    b += JUSTIFY_CENTER + "PRODUCTOS VENDIDOS\n" + LINE_SEPARATOR;
    b += JUSTIFY_LEFT;
    b += `Cant  Producto            P.Unit    Importe\n`;
    b += LINE_SEPARATOR;

    for (const pedido of data.pedidos) {
      const cantidad = pedido.cantidad.toString().padEnd(6);
      const pUnit = (pedido.precio_unitario || "0").padStart(8);
      const pTotal = (pedido.total || "0").padStart(8);
      const lineasProducto = splitText(pedido.nombre, 20);

      // Primera línea
      b += `${cantidad}${lineasProducto[0].padEnd(20)}${pUnit}${pTotal}\n`;

      // Líneas extra
      for (let i = 1; i < lineasProducto.length; i++) {
        b += `      ${lineasProducto[i]}\n`;
      }
    }
    b += LINE_SEPARATOR + SEPARATOR;
  }

  // Actividad Final
  b += JUSTIFY_CENTER + "ACTIVIDAD\n" + SEPARATOR;
  b += JUSTIFY_LEFT;
  addRow("Subtotales:", data.subtotales);
  addRow("Impuestos:", data.total_impuestos);
  addRow("Totales:", data.totales);
  b += SEPARATOR;

  // Finalización
  b += ESC + "d\x06"; // Feed 6
  b += CUT_PAPER;

  // --- ÚNICO ENVÍO AL PUERTO ---
  try {
    await printer.write(b);
    console.timeEnd("Cierre_Speed");
  } catch (err) {
    console.error("Error en impresión de cierre:", err);
  }
}

/**
 * Imprime un ticket en Windows
 */
async function printTicketWindows(
  ticketData,
  printerName,
  translations,
  ticketType,
  abrirGavetaConfig,
) {
  const connection = new InMemory();
  const imageManager = new ImageManager();
  const printer = await Printer.CONNECT("POS-80", connection, imageManager);

  console.log("Imprimiendo en Windows");

  try {
    // Diseñar el ticket según el tipo
    switch (ticketType) {
      case "full":
        await designFullTicket(
          printer,
          connection,
          ticketData,
          translations,
          abrirGavetaConfig,
        );
        break;
      case "Precuenta":
        await designPreBillWindows(printer, ticketData, translations);
        break;
      case "Comanda":
        await designOrderSlipWindows(printer, ticketData, translations);
        break;
      case "Cierre":
        await designTicketCierreWindows(printer, ticketData, translations);
        break;
      case "AnulacionPedido":
        await cancelledOrderWindows(printer, ticketData, translations);
        break;
      case "IngresosEgresos":
        await printIncomeExpenseWindows(printer, ticketData, translations);
        break;
      default:
        await designTestTicket(printer, ticketData, translations);
    }

    // Generar archivo temporal
    const tempFile = path.join(os.tmpdir(), `ticket_${Date.now()}.prn`);
    fs.writeFileSync(tempFile, connection.buffer());

    // Comando de impresión nativo ultrarrápido usando winspool.drv (C# compilado)
    const printExe = path.join(__dirname, "print-raw.exe");
    const { execFile } = require("child_process");

    await new Promise((resolve, reject) => {
      execFile(printExe, [printerName, tempFile], (error, stdout, stderr) => {
        try {
          fs.unlinkSync(tempFile);
        } catch (e) {} // Limpiar archivo temporal
        if (error) {
          console.error("Error al imprimir en Windows:", error, stderr);
          return reject(
            new Error(
              `No se pudo imprimir en ${printerName}: ${error.message}`,
            ),
          );
        }
        console.log(`Ticket enviado a ${printerName}`);
        resolve();
      });
    });
  } catch (error) {
    console.error("Error en printTicketWindows:", error);
    throw error;
  }
}
/**
 * Diseño de precuenta para MACOS
 */
async function designPreBillUnix(printer, ticketData, translations) {
  console.time("PreBillUnix_Speed");

  // --- CONSTANTES ESC/POS ---
  const ESC = "\x1B";
  const GS = "\x1D";
  const JUSTIFY_CENTER = ESC + "a\x01";
  const JUSTIFY_LEFT = ESC + "a\x00";
  const JUSTIFY_RIGHT = ESC + "a\x02";
  const TEXT_BOLD_LARGE = ESC + "!\x30";
  const TEXT_NORMAL = ESC + "!\x00";
  const CUT_PAPER = GS + "V\x41\x00";

  const SEPARATOR = "=".repeat(48) + "\n";
  const LINE_SEPARATOR = "-".repeat(48) + "\n";

  // Acumulador de buffer
  let b = "";

  // Helper para dividir texto sin cortar palabras
  function getProductLines(name, limit) {
    if (name.length <= limit) return [name];
    let words = name.split(" ");
    let lines = [];
    let currentLine = "";
    for (let word of words) {
      if ((currentLine + word).length > limit) {
        lines.push(currentLine.trim());
        currentLine = word + " ";
      } else {
        currentLine += word + " ";
      }
    }
    lines.push(currentLine.trim());
    return lines;
  }

  // --- CONSTRUCCIÓN DEL TICKET ---
  b += JUSTIFY_CENTER;
  b += TEXT_BOLD_LARGE + `${translations.pre_bill}\n` + TEXT_NORMAL;
  b += SEPARATOR;

  // Información del local
  b += `${ticketData.local.nombre}\n`;
  b += `${ticketData.local.telefono}\n`;
  b += `${translations.table}: ${ticketData.mesa}\n`;
  b += SEPARATOR;

  // Encabezado de tabla
  b += JUSTIFY_LEFT;
  b += `${translations.qty.padEnd(6)}${translations.product.padEnd(20)}    ${translations.unit_price.padStart(8)}    ${translations.product_total.padStart(8)}\n`;
  b += LINE_SEPARATOR;

  // Lista de pedidos
  for (const pedido of ticketData.pedidos) {
    const cantidad = pedido.cantidad.toString().padEnd(6);
    const pUnitario = `$${pedido.precio_unitario.toFixed(2)}`.padStart(8);
    const pTotal = `$${pedido.precio_total.toFixed(2)}`.padStart(8);
    const lineasProducto = getProductLines(
      pedido.producto_presentacion.nombre,
      20,
    );

    // Primera línea de la fila
    b += `${cantidad}${lineasProducto[0].padEnd(20)}    ${pUnitario}    ${pTotal}\n`;

    // Líneas adicionales para nombres largos
    for (let i = 1; i < lineasProducto.length; i++) {
      b += `      ${lineasProducto[i]}\n`; // Indentación para alineación
    }
  }

  b += LINE_SEPARATOR;

  // Totales
  b += JUSTIFY_RIGHT;
  b += `${translations.subtotal}: $${ticketData.subtotal.toFixed(2)}\n`;
  b +=
    TEXT_BOLD_LARGE +
    `${translations.total}: $${ticketData.total.toFixed(2)}\n` +
    TEXT_NORMAL;

  // Pie de página
  b += JUSTIFY_CENTER + SEPARATOR;
  if (ticketData.encabezado_ticket) b += `${ticketData.encabezado_ticket}\n`;
  if (ticketData.pie_pagina_ticket) b += `${ticketData.pie_pagina_ticket}\n`;

  // Salto y corte
  b += ESC + "d\x06"; // Feed 6
  b += CUT_PAPER;

  // --- ENVÍO ÚNICO AL PUERTO ---
  try {
    await printer.write(b);
    console.timeEnd("PreBillUnix_Speed");
  } catch (err) {
    console.error("Error en impresión Unix:", err);
  }
}

/**
 * Diseño de precuenta para Windows
 */
async function designPreBillWindows(printer, ticketData, translations) {
  console.time("Precuenta_Speed");

  // --- CONSTANTES ESC/POS ---
  const ESC = "\x1B";
  const GS = "\x1D";
  const JUSTIFY_CENTER = ESC + "a\x01";
  const JUSTIFY_LEFT = ESC + "a\x00";
  const JUSTIFY_RIGHT = ESC + "a\x02";
  const TEXT_BOLD_LARGE = ESC + "!\x30";
  const TEXT_NORMAL = ESC + "!\x00";
  const CUT_PAPER = GS + "V\x41\x00";

  const SEPARATOR = "=".repeat(48) + "\n";
  const LINE_SEPARATOR = "-".repeat(48) + "\n";

  // Helper para dividir texto
  function splitText(text, length) {
    if (!text) return [""];
    const words = text.split(" ");
    const lines = [];
    let currentLine = "";
    for (const word of words) {
      if ((currentLine + word).length > length) {
        lines.push(currentLine.trim());
        currentLine = word + " ";
      } else {
        currentLine += word + " ";
      }
    }
    lines.push(currentLine.trim());
    return lines;
  }

  // --- INICIO DEL BUFFER ---
  let b = "";

  // Encabezado
  b += ESC + "d\x01"; // Feed 1
  b += JUSTIFY_CENTER;
  b += TEXT_BOLD_LARGE + `${translations.pre_bill}\n` + TEXT_NORMAL;
  b += SEPARATOR;

  // Información del local y mesa
  b += `${ticketData.local.nombre}\n`;
  b += `${ticketData.local.telefono}\n`;
  b += `${translations.table}: ${ticketData.mesa}\n`;
  b += `${ticketData.fecha_actual}\n`;
  b += SEPARATOR;

  // Encabezado de tabla
  b += JUSTIFY_LEFT;
  b += "Cant  Producto                  P.U.    Total\n";
  b += LINE_SEPARATOR;

  // Detalles de pedidos
  for (const pedido of ticketData.pedidos) {
    const cantidad = pedido.cantidad.toString().padEnd(6);
    const pUnitario =
      `${ticketData.simbolo_moneda}${pedido.precio_unitario}`.padStart(8);
    const pTotal =
      `${ticketData.simbolo_moneda}${pedido.precio_total}`.padStart(8);
    const producto = pedido.producto_presentacion.nombre;

    const lineasProducto = splitText(producto, 26);

    // Primera línea: Cantidad | Producto (parte 1) | P.U. | Total
    b += `${cantidad}${lineasProducto[0].padEnd(26)}${pUnitario}${pTotal}\n`;

    // Líneas adicionales del nombre si es muy largo
    for (let i = 1; i < lineasProducto.length; i++) {
      b += `      ${lineasProducto[i]}\n`; // 6 espacios de indentación
    }
  }

  // Subtotales y totales
  b += LINE_SEPARATOR;
  b += JUSTIFY_RIGHT;
  b += `${translations.subtotal}: ${ticketData.simbolo_moneda}${ticketData.subtotal}\n`;
  b += `Descuento: ${ticketData.simbolo_moneda}${ticketData.descuento}\n`;

  if (ticketData.impuestos && ticketData.impuestos.length > 0) {
    for (const impuesto of ticketData.impuestos) {
      b += `  ${impuesto.impuesto}: ${ticketData.simbolo_moneda}${impuesto.total}\n`;
    }
  }

  b += `${translations.tip}: ${ticketData.simbolo_moneda}${ticketData.propina_predeterminada}\n`;
  b +=
    TEXT_BOLD_LARGE +
    `${translations.total}: ${ticketData.simbolo_moneda}${ticketData.total}\n` +
    TEXT_NORMAL;

  // Pie del ticket
  b += JUSTIFY_CENTER + SEPARATOR;
  if (ticketData.encabezado_ticket) b += `${ticketData.encabezado_ticket}\n`;
  if (ticketData.pie_pagina_ticket) b += `${ticketData.pie_pagina_ticket}\n`;

  // Alimentar y cortar
  b += ESC + "d\x06"; // Feed 6 líneas
  b += CUT_PAPER;

  // --- ENVÍO ÚNICO AL PUERTO ---
  try {
    await printer.write(b);
    console.timeEnd("Precuenta_Speed");
  } catch (err) {
    console.error("Error imprimiendo precuenta:", err);
  }
}

/**
 * Diseño de ticket completo (full) para todos los sistemas operativos
 */
async function designFullTicket(
  printer,
  connection,
  ticketData,
  translations,
  abrirGavetaConfig,
) {
  const SEPARATOR = "=".repeat(48);
  const LINE_SEPARATOR = "-".repeat(48);
  const billingData = ticketData.billing;

  // Función para dividir texto en líneas de un largo específico
  function splitText(text, length) {
    const words = text.split(" ");
    const lines = [];
    let currentLine = "";

    for (const word of words) {
      if ((currentLine + word).length > length) {
        lines.push(currentLine.trim());
        currentLine = word + " ";
      } else {
        currentLine += word + " ";
      }
    }
    lines.push(currentLine.trim());
    return lines;
  }

  // Encabezado del ticket
  await printer.feed(1);
  await printer.setAlignment(Align.Center);
  await printer.write("\x1B\x21\x30"); // Texto grande/negrita

  if (
    billingData != null &&
    billingData.tipo_factura === COMPROBANTE_CREDITO_FISCAL
  ) {
    await printer.write(`${translations.ccf}\n`);
  } else if (billingData != null && billingData.id_pais == GUATEMALA) {
    if (billingData.tipo_factura === GT_PEQUENO_CONTRIBUYENTE) {
      await printer.write(`Factura pequeño\n`);
      await printer.write(`contribuyente\n`);
    } else {
      await printer.write(`Factura\n`);
    }
  } else if (billingData != null && billingData.id_pais == HONDURAS) {
    await printer.write(`FACTURA\n`);
  } else if (billingData != null && billingData.id_pais == PANAMA) {
    await printer.write("\x1B\x21\x08"); // texto negrita
    await printer.write(`DGI\n`);
    await printer.write(`COMPROBANTE AUXILIAR DE FACTURA ELECTRONICA\n`);
    await printer.write(`FACTURA DE OPERACION INTERNA\n`);
  } else {
    await printer.write(`${translations.full_ticket}\n`);
  }
  await printer.write("\x1B\x21\x00"); // Texto normal
  await printer.write(`${SEPARATOR}\n`);

  //* ======================================================
  //* ============== Información del local =================
  //* ======================================================
  if (billingData != null && billingData.id_pais == GUATEMALA) {
    // Razon social solo en GT
    await printer.write(`${ticketData.local.razon_social}\n`);
  }
  if (billingData != null && billingData.id_pais == PANAMA) {
    await printer.write(`${ticketData.local.razon_social}\n`);
  } else {
    await printer.write(`${ticketData.local.nombre}\n`);
  }

  if (
    (billingData != null && billingData.id_pais == GUATEMALA) ||
    (billingData != null && billingData.id_pais == HONDURAS)
  ) {
    // direccion solo en GT y HN
    await printer.write(`${ticketData.local.direccion}\n`);

    if (billingData.id_pais == GUATEMALA) {
      //Departamento y municipio solo en GT
      await printer.write(
        `${billingData.direccion_catalogo.municipio_local.nombre}, ${billingData.direccion_catalogo.departamento_local.nombre}\n`,
      );
    }
  }
  if (billingData != null && billingData.id_pais == PANAMA) {
    // Razon social y direccion solo en PTY
    await printer.write(`${ticketData.local.nombre}\n`);
    await printer.write(`${ticketData.local.direccion}\n`);
  }
  await printer.write(`Telefono: ${ticketData.local.telefono}\n`);
  if (ticketData.local.nit) {
    //* Informacion del documento del dominio PTY
    if (
      billingData != null &&
      billingData.id_pais == PANAMA &&
      billingData.id_factura_infile != null
    ) {
      let cufeData = extractCUFEData(billingData.id_factura_infile ?? "");
      await printer.write(
        `RUC:${cufeData["rucEmisor"]}  DV:${cufeData["dvRuc"]}\n`,
      );
      await printer.write(
        `Sucursal:${cufeData["codigoSucursal"]}  Caja:${cufeData["puntoFacturacion"]}\n`,
      );
    } else {
      await printer.write(
        `${ticketData.id_pais == HONDURAS ? "RTN:" : "NIT:"} ${ticketData.local.nit}\n`,
      );
    }
  }
  await printer.write(`Numero: ${ticketData.numero_comprobante}\n`);
  await printer.write(`${SEPARATOR}\n`);

  //* ======================================================
  //* ============== Información de FE GT =================
  //* ======================================================
  if (billingData != null && billingData.id_pais == GUATEMALA) {
    await printer.write(`REGIMEN FEL DOCUMENTO TRIBUTARIO ELECTRONICO\n`);
    await printer.write(`Nro Autorizacion: ${billingData.id_factura_infile}\n`);
    await printer.write(`Serie: ${billingData.serie}\n`);
    await printer.write(`Nro: ${billingData.numero_documento}\n`);

    //* Imprimiendo frases de restaurante guardados en variable de sesion GT
    if (billingData.frases != null) {
      for (const frase of billingData.frases) {
        await printer.write(`${frase.frase} \n`);
      }
    }

    await printer.write(`${SEPARATOR}\n`);
  }

  //* ======================================================
  //* ============== Información de FE HN =================
  //* ======================================================
  if (billingData != null && billingData.id_pais == HONDURAS) {
    await printer.setAlignment(Align.Left);
    let rangoDesdeFormat = `${ticketData.local.codigo}-${ticketData.cashRegister?.codigo_punto_venta ?? "N/A"}-${"01"}-${billingData.rango_desde ?? "N/A"}`;
    let rangoHastaFormat = `${ticketData.local.codigo}-${ticketData.cashRegister?.codigo_punto_venta ?? "N/A"}-${"01"}-${billingData.rango_hasta ?? "N/A"}`;

    await printer.write(`CAI: ${ticketData.local.codigo_autorizacion}\n`);
    await printer.write(`RANGO AUTORIZADO\n`);
    await printer.write(`DE: ${rangoDesdeFormat}\n`);
    await printer.write(`HASTA: ${rangoHastaFormat}\n`);
    await printer.write(
      `FECHA LIMITE: ${billingData.fecha_limite_autorizacion}\n`,
    );
    await printer.write(`${SEPARATOR}\n`);
  }

  //* ======================================================
  //* ========== Información del cliente y venta ===========
  //* ======================================================
  await printer.setAlignment(Align.Left);
  if (
    billingData != null &&
    billingData.id_pais == HONDURAS &&
    ticketData.cuenta_venta.cliente == null
  ) {
    await printer.write(`${translations.client}: CONSUMIDOR FINAL\n`);
    await printer.write(`RTN: 9999999999999\n`);
  } else if (ticketData.cuenta_venta.nombre_cliente_generico) {
    await printer.write(
      `${translations.client}: ${ticketData.cuenta_venta.nombre_cliente_generico}\n`,
    );
  }

  if (
    billingData != null &&
    billingData.id_pais == GUATEMALA &&
    ticketData.cuenta_venta.cliente != null
  ) {
    const cliente = ticketData.cuenta_venta.cliente;
    await printer.write(
      `${cliente.tipo_documento}: ${cliente.numero_documento}\n`,
    );
    await printer.write(`Direccion: ${cliente.direccion}\n`);
  }

  //* Documento cliente HN
  if (
    ticketData.cuenta_venta.cliente != null &&
    ticketData.cuenta_venta.cliente.id_pais == HONDURAS
  ) {
    const cliente = ticketData.cuenta_venta.cliente;
    await printer.write(
      `${cliente.tipo_documento}: ${cliente.numero_documento}\n`,
    );
    await printer.write(`Telefono: ${cliente.telefono}\n`);
    await printer.write(`Correo: ${cliente.email}\n`);
    await printer.write(`${SEPARATOR}\n`);
  }

  //* Documento cliente, direccion telefono y correo solo en PTY
  if (
    billingData != null &&
    billingData.id_pais == PANAMA &&
    ticketData.cuenta_venta.cliente != null
  ) {
    const cliente = ticketData.cuenta_venta.cliente;
    await printer.write(
      `${cliente.tipo_documento}:${cliente.numero_documento} ${cliente.documento_extra != null ? `DV:${cliente.documento_extra}` : ""}\n`,
    );
    await printer.write(`Direccion: ${cliente.direccion}\n`);
    await printer.write(`Telefono: ${cliente.telefono}\n`);
    await printer.write(`Correo: ${cliente.email}\n`);
    await printer.write(`${SEPARATOR}\n`);
  }

  if (
    billingData != null &&
    billingData.tipo_factura === COMPROBANTE_CREDITO_FISCAL
  ) {
    await printer.write(`${translations.date}: ${billingData.fecha_emision}\n`);
    await printer.write(
      `${translations.codigo_generacion}: ${billingData.codigo_generacion}\n`,
    );
    await printer.write(
      `${translations.numero_control}: ${billingData.numero_control}\n`,
    );
    await printer.write(
      `${translations.sello_recepcion}: ${billingData.sello_recepcion}\n`,
    );
  } else {
    await printer.write(`${translations.table}: ${ticketData.venta.mesa}\n`);
    await printer.write(
      `${translations.seller}: ${ticketData.usuario.nombre} ${ticketData.usuario.apellidos}\n`,
    );
    await printer.write(
      `${translations.date}: ${ticketData.venta.fin_venta}\n`,
    );
  }

  await printer.write(`${SEPARATOR}\n`);

  // Encabezado de productos
  await printer.write(
    `${translations.qty.padEnd(6)}${translations.product.padEnd(
      22,
    )}${translations.unit_price.padStart(
      10,
    )}${translations.product_total.padStart(10)}\n`,
  );
  await printer.write(`${LINE_SEPARATOR}\n`);

  // Lista de productos
  for (const pedido of ticketData.pedidos) {
    const cantidad = pedido.cantidad.toString().padEnd(6);
    const precioUnitario = `${
      ticketData.simbolo_moneda
    }${pedido.precio_unitario.toFixed(2)}`.padStart(10);
    const precioTotal = `${
      ticketData.simbolo_moneda
    }${pedido.precio_total.toFixed(2)}`.padStart(10);
    const producto = pedido.producto_presentacion.nombre;

    // Se divide el nombre del producto si es muy largo
    const lineasProducto = splitText(producto, 22);

    // Primera línea con cantidad, producto, precios
    await printer.write(
      `${cantidad}${lineasProducto[0].padEnd(
        22,
      )}${precioUnitario}${precioTotal}\n`,
    );

    // Si el nombre del producto es largo, se imprimen las siguientes líneas debajo
    for (let i = 1; i < lineasProducto.length; i++) {
      await printer.write(`      ${lineasProducto[i]}\n`); // Indentación para mantener formato
    }
  }

  await printer.write(`${LINE_SEPARATOR}\n`);

  // Totales
  await printer.setAlignment(Align.Right);

  //* ======================================================
  //* ====== Información de importes y excentos HN ========
  //* ======================================================
  if (billingData != null && billingData.id_pais == HONDURAS) {
    await printer.write(
      `Descuento y rebajas otorgados: ${ticketData.simbolo_moneda}${parseFloat(ticketData.cuenta_venta.descuento).toFixed(2) ?? 0.0}\n`,
    );
    await printer.write(`Exento: ${ticketData.simbolo_moneda}0.00\n`);
    await printer.write(`Exonerado: ${ticketData.simbolo_moneda}0.00\n`);
    if (ticketData.cuenta_venta.impuestos.length > 0) {
      const regex = /\((.*?)\)/;
      for (var impuesto of ticketData.cuenta_venta.impuestos) {
        let match = (impuesto.impuesto ?? "").match(regex);
        let porcentajeLimpio = match != null ? match[1] : impuesto.impuesto;
        let importe = parseFloat(impuesto.importe_gravado ?? "0.00");
        await printer.write(
          `Importe Gravado ${porcentajeLimpio}: ${ticketData.simbolo_moneda}${importe.toFixed(2)}\n`,
        );
      }
    }
  }

  await printer.write(
    `${translations.subtotal}: ${
      ticketData.simbolo_moneda
    }${ticketData.cuenta_venta.subtotal.toFixed(2)}\n`,
  );

  const descuento = parseFloat(ticketData.cuenta_venta.descuento) || 0;

  if (
    (descuento > 0 && billingData == null) ||
    (descuento > 0 && billingData != null && billingData.id_pais != HONDURAS)
  ) {
    await printer.write(
      `${translations.discount}: ${ticketData.simbolo_moneda}${descuento}\n`,
    );
  }

  // Mostrar los impuestos detalladamente
  let totalImpuestos = 0.0;
  if (ticketData.cuenta_venta.impuestos.length > 0) {
    for (const impuesto of ticketData.cuenta_venta.impuestos) {
      await printer.write(
        `  ${impuesto.impuesto}: ${ticketData.simbolo_moneda}${impuesto.total}\n`,
      );
      totalImpuestos += parseFloat(impuesto.total) || 0.0;
    }
  }

  //* ======================================================
  //* ====== Información de total de impuesto HN ========
  //* ======================================================
  await printer.write(
    `Impuesto: ${ticketData.simbolo_moneda}${totalImpuestos.toFixed(2)}\n`,
  );

  await printer.write(
    `${translations.tip}: ${
      ticketData.simbolo_moneda
    }${ticketData.cuenta_venta.propina_predeterminada.toFixed(2)}\n`,
  );
  // await printer.write(
  //   `Impuesto: ${ticketData.simbolo_moneda}${ticketData.cuenta_venta.propina_predeterminada.toFixed(2)}\n`
  // );
  await printer.write("\x1B\x21\x30"); // Texto grande
  await printer.write(
    `${translations.total}: ${
      ticketData.simbolo_moneda
    }${ticketData.cuenta_venta.total.toFixed(2)}\n`,
  );
  await printer.write("\x1B\x21\x00"); // Texto normal

  // Pagos
  if (ticketData.pagos && ticketData.pagos.length > 0) {
    await printer.write(`${SEPARATOR}\n`);
    await printer.write(`${translations.payments}\n`);
    for (const pago of ticketData.pagos) {
      if (pago.tipo_pago.id != 1) {
        await printer.write(
          `${pago.tipo_pago.nombre}: ${
            ticketData.simbolo_moneda
          }${pago.monto.toFixed(2)}${
            pago.tarjeta ? ` (${pago.tarjeta})` : ""
          }\n`,
        );
      }
    }

    if (ticketData.pagos.some((item) => item.tipo_pago.id === 1)) {
      await printer.write(
        `Efectivo: ${ticketData.simbolo_moneda}${ticketData.pago_efectivo}\n`,
      );

      await printer.write(
        `${translations.change}: ${ticketData.simbolo_moneda}${ticketData.vuelto}\n`,
      );
    }
  }

  // Crédito
  if (ticketData.credito) {
    await printer.write(`${SEPARATOR}\n`);
    await printer.write(
      `${translations.credit}: ${
        ticketData.simbolo_moneda
      }${ticketData.credito.total_credito.toFixed(2)}\n`,
    );
    await printer.write(
      `${translations.num_installments}: ${ticketData.credito.num_cuotas}\n`,
    );
  }

  //* ======================================================
  //* ============== Información de FE PY =================
  //* ======================================================
  if (billingData != null && billingData.id_pais == PANAMA) {
    await printer.setAlignment(Align.Left);
    await printer.write(`${SEPARATOR}\n`);
    await printer.write(
      `Protocolo de autorizacion:\n${billingData.sello_recepcion}\n\n`,
    );
    await printer.write(
      `Fecha de autorizacion: ${billingData.fecha_emision}\n\n`,
    );
    await printer.write(
      `Consulte en:\nhttps://dgi-fep.mef.gob.pa/Consultas/FacturasPorCUFE\n\n`,
    );
    await printer.write(
      `Usando el CUFE:\n${billingData.id_factura_infile}\n\n`,
    );
    await printer.write(`O escaneando el codigo QR:\n\n`);
  }

  //Imprimir QR con pdf documento
  if (
    billingData != null &&
    billingData.id_pais != GUATEMALA &&
    (billingData.pdf_path != null || billingData.pdf_path != undefined)
  ) {
    await printer.setAlignment(Align.Center);
    if (billingData.id_pais == EL_SALVADOR) {
      await printer.write(`${SEPARATOR}\n`);
      await printer.write(`${translations.download_document}\n`);
    }

    const urlString = billingData.pdf_path.toString();
    const len = urlString.length;

    if (len > 150) {
      const qrImage = generateAntiBleedQR(urlString, 350);
      await printer.draw(qrImage);
    } else {
      await printer.qrcode(urlString, 5);
    }
  }

  //* ======================================================
  //* =========== Información de FE Infile PY ==============
  //* ======================================================
  if (billingData != null && billingData.id_pais == PANAMA) {
    await printer.write(
      `Documento validado por INFILE, S.A. con RUC 155709791-2-2021, es Proveedor Autorizado Calificado, Resolucion No.201-3670 de 29/05/2022\n`,
    );
  }

  // Pie del ticket
  await printer.setAlignment(Align.Center);
  await printer.write(`${SEPARATOR}\n`);
  if (ticketData.local.pie_pagina_ticket) {
    await printer.write(`${ticketData.local.pie_pagina_ticket}\n`);
  }
  await printer.write(`${translations.thank_you}\n`);
  await printer.write(`${translations.come_again}\n`);

  //* ======================================================
  //* ========= Certificador FE GT (solo GT) ================
  //* ======================================================
  if (billingData != null && billingData.id_pais == GUATEMALA) {
    await printer.feed(1);
    await printer.write(`Certificador: INFILE. S.A\n`);
    await printer.write(`NIT: 12521337\n`);
  }

  // Alimentar y cortar papel
  await printer.feed(6);
  await printer.cutter();

  // Abrir gaveta si la configuración lo permite Y hay pagos en efectivo
  const esPagoEfectivo =
    ticketData.pagos &&
    ticketData.pagos.some((pago) => pago.tipo_pago && pago.tipo_pago.id === 1);

  console.log("Chequeando apertura de gaveta:"); // Para depuración
  console.log("  abrirGavetaConfig:", abrirGavetaConfig); // Para depuración
  console.log("  esPagoEfectivo:", esPagoEfectivo); // Para depuración

  if (abrirGavetaConfig && esPagoEfectivo) {
    console.log("Intentando abrir gaveta usando connection.write()...");
    const drawerCommand = Buffer.from([0x1b, 0x70, 0x00, 0x32, 0x32]); // Pin 2, 100ms ON, 100ms OFF

    if (connection && typeof connection.write === "function") {
      connection.write(drawerCommand);
      console.log(
        "Comando de apertura de gaveta enviado al buffer (via connection.write).",
      );
    } else {
      console.error(
        "ERROR: connection.write() no está disponible. No se puede abrir la gaveta con comando crudo.",
      );
    }
  }
}

/**
 * Diseño de comanda para Unix (macOS/Linux)
 */
async function designOrderSlipUnix(printer, ticketData, translations) {
  console.time("OrderSlipUnix_Speed");

  // --- CONSTANTES ESC/POS ---
  const ESC = "\x1B";
  const GS = "\x1D";
  const JUSTIFY_CENTER = ESC + "a\x01";
  const JUSTIFY_LEFT = ESC + "a\x00";
  const TEXT_BOLD_LARGE = ESC + "!\x30";
  const TEXT_NORMAL = ESC + "!\x00";
  const CUT_PAPER = GS + "V\x41\x00";

  const SEPARATOR_STAR = "*".repeat(48) + "\n";
  const SEPARATOR_DOT = ".".repeat(48) + "\n";
  const LINE_SEPARATOR = "-".repeat(48) + "\n";

  // Acumulador de buffer
  let b = "";

  // --- CONSTRUCCIÓN DEL TICKET ---

  // Encabezado
  b += JUSTIFY_CENTER;
  b += SEPARATOR_STAR;
  b += TEXT_BOLD_LARGE + `${translations.order_slip}\n` + TEXT_NORMAL;
  b += SEPARATOR_DOT;

  // Información general
  b += JUSTIFY_LEFT;
  b += `${translations.area}: ${ticketData.area}\n`;
  b += `${translations.table}: ${ticketData.mesa}\n`;
  b += `${translations.waiter}: ${ticketData.mesero}\n`;
  b += `${translations.date}: ${ticketData.fecha}\n`;
  b += SEPARATOR_STAR;
  b += ESC + "d\x01"; // Feed 1

  // Encabezados de tabla
  b += `${translations.qty.padEnd(8)}${translations.product.padEnd(32)}\n`;
  b += LINE_SEPARATOR;

  // Iterar sobre los pedidos
  for (const pedido of ticketData.pedidos) {
    const cantidad = String(pedido.cantidad).padEnd(8);
    const nombreProducto = pedido.presentacion ?? pedido.producto;

    // Aquí podrías usar splitText si el nombre es muy largo,
    // pero manteniendo tu lógica de padEnd:
    b += `${cantidad}${nombreProducto.padEnd(32)}\n`;

    // Iterar sobre modificadores
    if (pedido.modificadores && Array.isArray(pedido.modificadores)) {
      for (const modificador of pedido.modificadores) {
        const espacio = "".padEnd(8);
        const modTexto = `  * ${modificador.cantidad}x ${modificador.nombre}`;
        b += `${espacio}${modTexto}\n`;
      }
    }

    // Nota del pedido (Corregido: pedido.notaPedido en lugar de modificador.notaPedido)
    if (pedido.notaPedido) {
      const espacio = "".padEnd(8);
      const notTexto = `  - ${pedido.notaPedido}`;
      b += `${espacio}${notTexto}\n`;
    }
  }

  // Final del ticket
  b += ESC + "d\x02"; // Feed 2
  b += SEPARATOR_STAR;
  b += ESC + "d\x04"; // Feed 4
  b += CUT_PAPER;

  // --- ENVÍO ÚNICO AL PUERTO ---
  try {
    await printer.write(b);
    console.timeEnd("OrderSlipUnix_Speed");
  } catch (err) {
    console.error("Error en comanda Unix:", err);
  }
}

async function cancelledOrderWindows(printer, ticketData, translations) {
  console.time("Cancelacion_Speed");

  // --- CONSTANTES ESC/POS ---
  const ESC = "\x1B";
  const GS = "\x1D";
  const JUSTIFY_CENTER = ESC + "a\x01";
  const JUSTIFY_LEFT = ESC + "a\x00";
  const TEXT_BOLD_LARGE = ESC + "!\x30"; // Doble alto + Doble ancho + Negrita
  const TEXT_NORMAL = ESC + "!\x00";
  const TEXT_BOLD = ESC + "!\x08";
  const CUT_PAPER = GS + "V\x41\x00";

  const SEPARATOR = "=".repeat(48) + "\n";
  const LINE_SEPARATOR = "-".repeat(48) + "\n";
  const STAR_SEPARATOR = "*".repeat(48) + "\n";

  function splitText(text, length) {
    if (!text) return [""];
    const words = text.split(" ");
    const lines = [];
    let currentLine = "";
    for (const word of words) {
      if ((currentLine + word).length > length) {
        lines.push(currentLine.trim());
        currentLine = word + " ";
      } else {
        currentLine += word + " ";
      }
    }
    lines.push(currentLine.trim());
    return lines;
  }

  // --- INICIO DEL BUFFER ---
  let b = "";

  // Encabezado llamativo
  b += ESC + "d\x01"; // Feed 1
  b += JUSTIFY_CENTER;
  b += STAR_SEPARATOR;
  b += TEXT_BOLD_LARGE + `${translations.cancelled_order}\n` + TEXT_NORMAL;
  b += SEPARATOR;

  // Información de la ubicación y responsables
  b += JUSTIFY_LEFT;
  b += `${translations.area}: ${ticketData.area}\n`;
  b += `${translations.room}: ${ticketData.salon},  ${translations.table}: ${ticketData.mesa}\n`;
  b += `Anulado por: ${ticketData.anulado_por}\n`;

  if (ticketData.anulacion_autorizada_por != null) {
    b += `Autorizado por: ${ticketData.anulacion_autorizada_por}\n`;
  }

  b += `Comandado por: ${ticketData.comandado_por}\n`;
  b += `Fecha: ${ticketData.fecha}\n`;
  b += SEPARATOR;

  // Encabezado de producto
  b += `${translations.qty.padEnd(8)}${translations.product}\n`;
  b += LINE_SEPARATOR;

  // Detalle del producto anulado
  const pedido = ticketData.pedido;
  const cantidadStr = `${pedido.cantidad}`.padEnd(8);
  const indent = " ".repeat(8);
  const lineasProducto = splitText(pedido.presentacion || pedido.producto, 40);

  for (let i = 0; i < lineasProducto.length; i++) {
    const esPrimeraLinea = i === 0;
    const esUltimaLinea = i === lineasProducto.length - 1;

    b += esPrimeraLinea ? cantidadStr : indent;
    b += lineasProducto[i];

    if (esUltimaLinea && pedido.paraLlevar) {
      b += " " + TEXT_BOLD + "(Para Llevar)" + TEXT_NORMAL;
    }
    b += "\n";
  }

  // Modificadores
  if (pedido.modificadores?.length > 0) {
    for (const mod of pedido.modificadores) {
      const lineasMod = splitText(`* ${mod.cantidad}x ${mod.nombre}`, 40);
      for (const lm of lineasMod) {
        b += `${indent}${lm}\n`;
      }
    }
  }

  // Nota de la anulación
  if (pedido.notaPedido) {
    const lineasNota = splitText(pedido.notaPedido, 40);
    b += `${indent}- Nota:\n`;
    for (const ln of lineasNota) {
      b += `${indent}  ${ln}\n`;
    }
  }

  // Cierre y Corte
  b += STAR_SEPARATOR;
  b += ESC + "d\x06"; // Feed 6
  b += CUT_PAPER;

  // --- ENVÍO ÚNICO ---
  try {
    await printer.write(b);
    console.timeEnd("Cancelacion_Speed");
  } catch (err) {
    console.error("Error al imprimir orden cancelada:", err);
  }
}

async function designOrderSlipWindows(printer, ticketData, translations) {
  console.log("DATA COMANDA: ", ticketData);

  // COMANDOS ESC/POS PREDEFINIDOS
  const ESC = "\x1B";
  const GS = "\x1D";
  const JUSTIFY_CENTER = ESC + "a\x01";
  const JUSTIFY_LEFT = ESC + "a\x00";
  const TEXT_BOLD_LARGE = ESC + "!\x30";
  const TEXT_NORMAL = ESC + "!\x00";
  const TEXT_BOLD = ESC + "!\x08";
  const CUT_PAPER = GS + "V\x41\x00";

  const SEPARATOR = "=".repeat(48) + "\n";
  const LINE_SEPARATOR = "-".repeat(48) + "\n";
  const STAR_SEPARATOR = "*".repeat(48) + "\n";

  function splitText(text, length) {
    const words = text.split(" ");
    const lines = [];
    let currentLine = "";
    for (const word of words) {
      if ((currentLine + word).length > length) {
        lines.push(currentLine.trim());
        currentLine = word + " ";
      } else {
        currentLine += word + " ";
      }
    }
    lines.push(currentLine.trim());
    return lines;
  }

  // --- INICIO DE CONSTRUCCIÓN DEL BUFFER ---
  let b = "";

  // Encabezado
  b += ESC + "d\x01";
  b += JUSTIFY_CENTER;
  b += STAR_SEPARATOR;
  b += TEXT_BOLD_LARGE + `${translations.order_slip}\n` + TEXT_NORMAL;
  b += SEPARATOR;

  // Información General
  b += JUSTIFY_LEFT;
  b += TEXT_BOLD_LARGE + `N: ${ticketData.numero_comanda}\n` + TEXT_NORMAL;
  b += `${translations.area}: ${ticketData.area}\n`;
  b += `${ticketData.mesa || translations.unassigned}\n`;
  b += `Cantidad personas: ${ticketData.cantidad_personas || translations.unassigned}\n`;
  b += `Mesero: ${ticketData.mesero}\n`;
  b += `Fecha: ${ticketData.fecha}\n`;
  b += SEPARATOR;

  // Cabecera de Tabla
  b += `${translations.qty.padEnd(8)}${translations.product}\n`;
  b += LINE_SEPARATOR;

  // Loop de Pedidos
  for (const pedido of ticketData.pedidos) {
    const cantidadStr = `${pedido.cantidad}`.padEnd(8);
    const indent = " ".repeat(8);
    const lineasProducto = splitText(
      pedido.presentacion || pedido.producto,
      40,
    );

    for (let i = 0; i < lineasProducto.length; i++) {
      const esPrimeraLinea = i === 0;
      b += esPrimeraLinea ? cantidadStr : indent;
      b += lineasProducto[i];

      // Marca de "Para Llevar" al final del nombre
      if (i === lineasProducto.length - 1 && pedido.paraLlevar) {
        b += " " + TEXT_BOLD + "(Para Llevar)" + TEXT_NORMAL;
      }
      b += "\n";
    }

    // Modificadores
    if (pedido.modificadores?.length > 0) {
      for (const mod of pedido.modificadores) {
        const lineasMod = splitText(`* ${mod.cantidad}x ${mod.nombre}`, 40);
        for (const lm of lineasMod) {
          b += `${indent}${lm}\n`;
        }
      }
    }

    // Nota de Pedido
    if (pedido.notaPedido) {
      const lineasNota = splitText(pedido.notaPedido, 38);
      b += `${indent}- Nota:\n`;
      for (const ln of lineasNota) {
        b += `${indent}  ${ln}\n`;
      }
    }
    b += "\n"; // Espacio entre productos
  }

  // Pie y Corte
  b += STAR_SEPARATOR;
  b += ESC + "d\x06"; // Feed 6 líneas de golpe
  b += CUT_PAPER;

  // --- ENVÍO ÚNICO ---
  try {
    await printer.write(b);
    console.log("¡Impresión enviada con éxito!");
  } catch (err) {
    console.error("Error al enviar al buffer de la impresora:", err);
  }
}

async function printIncomeExpenseWindows(printer, ticketData) {
  console.time("printIncomeExpenseWindows");

  // --- CONSTANTES ESC/POS ---
  const ESC = "\x1B";
  const GS = "\x1D";
  const JUSTIFY_CENTER = ESC + "a\x01";
  const JUSTIFY_LEFT = ESC + "a\x00";
  const TEXT_BOLD_LARGE = ESC + "!\x30"; // Doble alto + Doble ancho + Negrita
  const TEXT_NORMAL = ESC + "!\x00";
  const CUT_PAPER = GS + "V\x41\x00";

  const SEPARATOR = "=".repeat(48) + "\n";
  const LINE_SEPARATOR = "-".repeat(48) + "\n";
  const STAR_SEPARATOR = "*".repeat(48) + "\n";

  // --- TRADUCCIONES DINÁMICAS ---
  const labels = ticketData.labels ?? {};
  const title = labels["titulo"] ?? "TICKET";
  const fechaLab = labels["fecha"] ?? "Fecha";
  const usuarioLab = labels["usuario_registro"] ?? "Usuario";
  const cajaLab = labels["caja"] ?? "Caja";
  const entregoLab = labels["entrego_a"] ?? "Entregado a";
  const montoLab = labels["monto"] ?? "Monto";
  const motivoLab = labels["motivo"] ?? "Motivo";
  const firmaLab = labels["firma"] ?? "Firma";
  const nombreUsuario =
    `${ticketData.usuario?.nombre ?? ""} ${ticketData.usuario?.apellidos ?? ""}`.trim();

  // --- INICIO DEL BUFFER ---
  let b = "";

  // Encabezado llamativo
  b += ESC + "d\x01"; // Feed 1
  b += JUSTIFY_CENTER;
  b += STAR_SEPARATOR;
  b += TEXT_BOLD_LARGE + `${title}\n` + TEXT_NORMAL;
  b += SEPARATOR;

  // Información general
  b += JUSTIFY_LEFT;
  b += `${fechaLab}: ${ticketData.fecha_string}\n`;
  b += `${usuarioLab}: ${nombreUsuario}\n`;
  b += `${cajaLab}: ${ticketData.movimiento_caja.caja.nombre}\n`;

  b += LINE_SEPARATOR;

  // Información especifica de ingreso/gasto
  b += JUSTIFY_LEFT;
  b += `${entregoLab}: ${ticketData.entrego_a}\n`;
  b += `${montoLab}: ${ticketData.simbolo_moneda}${ticketData.monto.toFixed(2)}\n`;
  b += `${motivoLab}: ${ticketData.motivo}\n`;

  b += SEPARATOR;

  // Espacio para firma
  b += "\n\n\n\n";
  b += JUSTIFY_CENTER;
  b += `______________________________\n`;
  b += `        ${firmaLab}        \n`;

  // Cierre y Corte
  b += ESC + "d\x06"; // Feed 6
  b += CUT_PAPER;

  // --- ENVÍO ÚNICO ---
  try {
    await printer.write(b);
    console.timeEnd("Cancelacion_Speed");
  } catch (err) {
    console.error("Error al imprimir orden cancelada:", err);
  }
}

function extractCUFEData(cufe) {
  const rucStart = 5;
  const rucEnd = 25;
  const rawRuc = cufe.substring(rucStart, rucEnd);

  const dvStart = 26;
  const dvEnd = 28;
  const rawDv = cufe.substring(dvStart, dvEnd);

  let rawRucSinCeros = rawRuc.replace(/^0+/, "");
  if (rawRucSinCeros === "") {
    rawRucSinCeros = "0";
  }

  const codigoSucursalStart = 28;
  const codigoSucursalEnd = 32;
  const codigoSucursal = cufe.substring(codigoSucursalStart, codigoSucursalEnd);

  const puntoFacturacionStart = 50;
  const puntoFacturacionEnd = 53;
  const puntoFacturacion = cufe.substring(
    puntoFacturacionStart,
    puntoFacturacionEnd,
  );

  return {
    rucEmisor: rawRucSinCeros,
    dvRuc: rawDv,
    codigoSucursal: codigoSucursal,
    puntoFacturacion: puntoFacturacion,
  };
}

module.exports = {
  printTicket,
  setAppDataPath,
};
