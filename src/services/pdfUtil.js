const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const os = require("os");
const { app } = require("electron");

// Librería de impresión
const { Printer, InMemory, Align, Drawer } = require("escpos-buffer");

// Directorio para almacenar el archivo temporal
const outputDir = app.getPath("userData");
const outputPath = path.join(outputDir, "ticket_output.bin");

/**
 * Imprime un ticket según el tipo y el sistema operativo
 * @param {Object} ticketData - Datos del ticket
 * @param {String} printerName - Nombre de la impresora
 * @param {Object} translations - Traducciones de textos
 * @param {String} ticketType - Tipo de ticket ("full", "pre-bill", "order-slip")
 */
async function printTicket(
  ticketData,
  printerName,
  translations,
  ticketType = "pre-bill"
) {
  if (os.platform() === "win32") {
    await printTicketWindows(ticketData, printerName, translations, ticketType);
  } else {
    await printTicketUnix(ticketData, printerName, translations, ticketType);
  }
}

/**
 * Imprime un ticket en sistemas Unix (macOS/Linux)
 */
async function printTicketUnix(
  ticketData,
  printerName,
  translations,
  ticketType
) {
  try {
    const connection = new InMemory();
    const printer = await Printer.CONNECT("POS-80", connection);

    if (ticketType === "full") {
      await designFullTicket(printer, ticketData, translations);
    } else if (ticketType === "pre-bill") {
      await designPreBillUnix(printer, ticketData, translations);
    } else if (ticketType === "order-slip") {
      await designOrderSlipUnix(printer, ticketData, translations);
    }

    fs.writeFileSync(outputPath, connection.buffer());
    exec(`lp -d "${printerName.replace(/ /g, "_")}" "${outputPath}"`, (err) => {
      if (err) console.error("Error al imprimir en Unix:", err);
      else console.log("Impresión completada en Unix");
    });
  } catch (error) {
    console.error("Error al imprimir el ticket en Unix:", error);
  }
}

/**
 * Imprime un ticket en Windows
 */
async function printTicketWindows(
  ticketData,
  printerName,
  translations,
  ticketType
) {
  try {
    const connection = new InMemory();
    const printer = await Printer.CONNECT("POS-80", connection);

    if (ticketType === "full") {
      await designFullTicket(printer, ticketData, translations);
    } else if (ticketType === "pre-bill") {
      await designPreBillWindows(printer, ticketData, translations);
    } else if (ticketType === "order-slip") {
      await designOrderSlipWindows(printer, ticketData, translations);
    }

    fs.writeFileSync(outputPath, connection.buffer());
    const formattedPrinterName = printerName.replace(/ /g, "_");
    const printCommand = `cmd.exe /c "print /D:\\\\localhost\\${formattedPrinterName} ${outputPath}"`;

    exec(printCommand, (err, stdout, stderr) => {
      if (err) {
        console.error("Error al imprimir en Windows:", err);
      } else {
        console.log("Impresión completada en Windows:", stdout);
      }
    });
  } catch (error) {
    console.error("Error al imprimir el ticket en Windows:", error);
  }
}

/**
 * Diseño de precuenta para MACOS
 */
async function designPreBillUnix(printer, ticketData, translations) {
  await printer.setAlignment(Align.Center);
  await printer.write("\x1B\x21\x30"); // Cambia a texto en negrita o doble ancho, si está disponible
  await printer.write(`${translations.pre_bill}\n`);
  await printer.write("\x1B\x21\x00"); // Restaura el estilo normal

  await printer.write("=".repeat(48) + "\n"); // Línea separadora debajo

  // Continuar con el resto del ticket
  await printer.setAlignment(Align.Center);
  await printer.write(`${ticketData.local.nombre}\n`);
  await printer.write(`${ticketData.local.telefono}\n`);
  await printer.write(`${translations.table}: ${ticketData.venta.mesa}\n`);
  await printer.write("=".repeat(48) + "\n"); // Separador de sección

  // Encabezado de tabla
  await printer.setAlignment(Align.Left);
  await printer.write(
    `${translations.qty}   ${translations.product}                 ${translations.unit_price}    ${translations.product_total}\n`
  );
  await printer.write("-".repeat(48) + "\n"); // Línea divisoria

  // Imprimir cada pedido
  for (const pedido of ticketData.pedidos) {
    const cantidad = pedido.cantidad.toString().padEnd(5); // "Cant" - 5 caracteres de ancho
    const precioUnitario = `$${pedido.precio_unitario.toFixed(2)}`.padStart(6); // "P.U" - 6 caracteres de ancho
    const precioTotal = `$${pedido.precio_total.toFixed(2)}`.padStart(6); // "Total" - 6 caracteres de ancho

    // Separar el nombre del producto sin cortar palabras
    const producto = pedido.producto_presentacion.nombre;
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

    // Imprimir cantidad, primera línea del producto, precio unitario y total en la misma fila
    await printer.write(
      `${cantidad}${lineasProducto[0].padEnd(
        20
      )}     ${precioUnitario}    ${precioTotal}\n`
    );

    // Imprimir las líneas adicionales del producto, si las hay
    for (let i = 1; i < lineasProducto.length; i++) {
      await printer.write(`      ${lineasProducto[i]}\n`);
    }
  }

  await printer.write("-".repeat(48) + "\n"); // Separador de subtotal
  await printer.setAlignment(Align.Right);
  await printer.write(
    `${translations.subtotal}: $${ticketData.cuenta_venta.subtotal.toFixed(
      2
    )}\n`
  );
  await printer.write(
    `${translations.total}: $${ticketData.cuenta_venta.total.toFixed(2)}\n`
  );

  await printer.setAlignment(Align.Center);
  await printer.write("=".repeat(48) + "\n"); // Línea inferior
  await printer.write(`${translations.thank_you}\n`);
  await printer.write(`${translations.come_again}\n`);

  await printer.feed(6); // Alimentar papel
  await printer.cutter();
  await printer.drawer(Drawer.First);
}

/**
 * Diseño de precuenta para Windows
 */
async function designPreBillWindows(printer, ticketData, translations) {
  await printer.setAlignment(Align.Center);
  await printer.write("\x1B\x21\x30"); // Cambia a texto en negrita o doble ancho, si está disponible
  await printer.write(`${translations.pre_bill}\n`);
  await printer.write("\x1B\x21\x00"); // Restaura el estilo normal

  await printer.write("=".repeat(48) + "\n"); // Línea separadora debajo

  // Continuar con el resto del ticket
  await printer.setAlignment(Align.Center);
  await printer.write(`${ticketData.local.nombre}\n`);
  await printer.write(`${ticketData.local.telefono}\n`);
  await printer.write(`${translations.table}: ${ticketData.venta.mesa}\n`);
  await printer.write("=".repeat(48) + "\n"); // Separador de sección

  // Imprimir cada pedido
  for (const pedido of ticketData.pedidos) {
    const cantidad = pedido.cantidad.toString().padEnd(5); // "Cant" - 5 caracteres de ancho
    const precioUnitario = `$${pedido.precio_unitario.toFixed(2)}`.padStart(6); // "P.U" - 6 caracteres de ancho
    const precioTotal = `$${pedido.precio_total.toFixed(2)}`.padStart(6); // "Total" - 6 caracteres de ancho

    // Separar el nombre del producto sin cortar palabras
    const producto = pedido.producto_presentacion.nombre;
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

    // Imprimir cantidad, primera línea del producto, precio unitario y total en la misma fila
    await printer.write(
      `${cantidad}${lineasProducto[0].padEnd(
        20
      )} ${precioUnitario} ${precioTotal}\n`
    );

    // Imprimir las líneas adicionales del producto, si las hay
    for (let i = 1; i < lineasProducto.length; i++) {
      await printer.write(` ${lineasProducto[i]}\n`); // Espacio inicial para alinear las líneas adicionales del producto
    }
  }

  await printer.write("-".repeat(48) + "\n");
  await printer.setAlignment(Align.Right);
  await printer.write(
    `${translations.subtotal}: $${ticketData.cuenta_venta.subtotal.toFixed(
      2
    )}\n`
  );
  await printer.write(
    `${translations.total}: $${ticketData.cuenta_venta.total.toFixed(2)}\n`
  );
  await printer.setAlignment(Align.Center);
  await printer.write("=".repeat(48) + "\n");
  await printer.write(`${translations.thank_you}\n`);
  await printer.write(`${translations.come_again}\n`);

  await printer.feed(6); // Alimentar papel
  await printer.cutter();
  await printer.drawer(Drawer.First);
}

/**
 * Diseño de ticket completo (full) para todos los sistemas operativos
 */
async function designFullTicket(printer, ticketData, translations) {
  // Encabezado del ticket
  await printer.setAlignment(Align.Center);
  await printer.write("\x1B\x21\x30"); // Texto en negrita o tamaño mayor
  await printer.write(`${translations.full_ticket}\n`);
  await printer.write("\x1B\x21\x00"); // Restablecer el estilo normal
  await printer.write("=".repeat(48) + "\n");

  // Información del local
  await printer.write(`${ticketData.local.nombre}\n`);
  await printer.write(`${ticketData.local.telefono}\n`);
  if (ticketData.local.nit) {
    await printer.write(`NIT: ${ticketData.local.nit}\n`);
  }
  if (ticketData.local.encabezado_ticket) {
    await printer.write(`${ticketData.local.encabezado_ticket}\n`);
  }
  await printer.write("=".repeat(48) + "\n");

  // Información del cliente y la venta
  await printer.setAlignment(Align.Left);
  if (ticketData.cuenta_venta.nombre_cliente_generico) {
    await printer.write(
      `${translations.client}: ${ticketData.cuenta_venta.nombre_cliente_generico}\n`
    );
  }
  await printer.write(`${translations.table}: ${ticketData.venta.mesa}\n`);
  await printer.write(
    `${translations.seller}: ${ticketData.usuario.nombre} ${ticketData.usuario.apellidos}\n`
  );
  await printer.write(
    `${translations.date}: ${new Date(
      ticketData.venta.fin_venta
    ).toLocaleString()}\n`
  );
  await printer.write("=".repeat(48) + "\n");

  // Encabezado de productos
  await printer.write(
    `${translations.qty}   ${translations.product}                 ${translations.unit_price}    ${translations.product_total}\n`
  );
  await printer.write("-".repeat(48) + "\n");

  // Lista de productos
  for (const pedido of ticketData.pedidos) {
    const cantidad = pedido.cantidad.toString().padEnd(5);
    const precioUnitario = `$${pedido.precio_unitario.toFixed(2)}`.padStart(6);
    const precioTotal = `$${pedido.precio_total.toFixed(2)}`.padStart(6);

    const producto = pedido.producto_presentacion.nombre;
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

    await printer.write(
      `${cantidad}${lineasProducto[0].padEnd(
        20
      )}     ${precioUnitario}    ${precioTotal}\n`
    );

    for (let i = 1; i < lineasProducto.length; i++) {
      await printer.write(`      ${lineasProducto[i]}\n`);
    }
  }

  await printer.write("-".repeat(48) + "\n");

  // Totales y descuentos
  await printer.setAlignment(Align.Right);
  await printer.write(
    `${translations.subtotal}: $${ticketData.cuenta_venta.subtotal.toFixed(
      2
    )}\n`
  );
  if (ticketData.cuenta_venta.descuento) {
    await printer.write(
      `${translations.discount}: $${ticketData.cuenta_venta.descuento.toFixed(
        2
      )}\n`
    );
  }
  await printer.write(
    `${translations.total}: $${ticketData.cuenta_venta.total.toFixed(2)}\n`
  );

  // Información de pagos
  if (ticketData.pagos && ticketData.pagos.length > 0) {
    await printer.write("=".repeat(48) + "\n");
    await printer.write(`${translations.payments}\n`);
    for (const pago of ticketData.pagos) {
      await printer.write(
        `${pago.tipo_venta}: $${pago.monto.toFixed(2)} ${
          pago.tarjeta ? `(${pago.tarjeta})` : ""
        }\n`
      );
    }
  }

  // Información de crédito (si existe)
  if (ticketData.credito) {
    await printer.write("=".repeat(48) + "\n");
    await printer.write(
      `${translations.credit}: $${ticketData.credito.total_credito.toFixed(
        2
      )}\n`
    );
    await printer.write(
      `${translations.num_installments}: ${ticketData.credito.num_cuotas}\n`
    );
  }

  // Pie de página del ticket
  await printer.setAlignment(Align.Center);
  await printer.write("=".repeat(48) + "\n");
  if (ticketData.local.pie_pagina_ticket) {
    await printer.write(`${ticketData.local.pie_pagina_ticket}\n`);
  }
  await printer.write(`${translations.thank_you}\n`);
  await printer.write(`${translations.come_again}\n`);

  await printer.feed(6); // Alimentar papel
  await printer.cutter();
  await printer.drawer(Drawer.First);
}

/**
 * Diseño de comanda para Unix (macOS/Linux)
 */
async function designOrderSlipUnix(printer, ticketData, translations) {
  await printer.setAlignment(Align.Center);
  await printer.write("\x1B\x21\x30"); // Cambia a texto en negrita o doble ancho, si está disponible
  await printer.write(`${translations.order_slip}\n`);
  await printer.write("\x1B\x21\x00"); // Restaura el estilo normal
  await printer.write("=".repeat(48) + "\n");
  await printer.write(`${translations.table}: ${ticketData.venta.mesa}\n`);
  await printer.write("=".repeat(48) + "\n");

  for (const pedido of ticketData.pedidos) {
    await printer.write(
      `${pedido.cantidad} x ${pedido.producto_presentacion.nombre}\n`
    );
  }

  await printer.feed(4);
  await printer.cutter();
}

/**
 * Diseño de comanda para Windows
 */
async function designOrderSlipWindows(printer, ticketData, translations) {
  await printer.setAlignment(Align.Center);
  await printer.write("\x1B\x21\x30"); // Cambia a texto en negrita o doble ancho, si está disponible
  await printer.write(`${translations.order_slip}\n`);
  await printer.write("\x1B\x21\x00"); //
  await printer.write("=".repeat(48) + "\n");
  await printer.write(`${translations.table}: ${ticketData.venta.mesa}\n`);
  await printer.write("=".repeat(48) + "\n");

  for (const pedido of ticketData.pedidos) {
    await printer.write(
      `${pedido.cantidad} x ${pedido.producto_presentacion.nombre}\n`
    );
  }

  await printer.feed(4);
  await printer.cutter();
}

module.exports = {
  printTicket,
};
