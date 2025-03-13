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
 * @param {String} ticketType - Tipo de ticket ("full", "Precuenta", "Comanda")
 */
async function printTicket(
  ticketData,
  printerName,
  translations,
  ticketType
  // ticketType = "Precuenta"
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
    } else if (ticketType === "Precuenta") {
      await designPreBillUnix(printer, ticketData, translations);
    } else if (ticketType === "Comanda") {
      await designOrderSlipUnix(printer, ticketData, translations);
    } else {
      await designTestTicket(printer, ticketData, translations);
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

/** Imprime test de prueba como ticket */
async function designTestTicket(printer, testData, translations) {

  // Encabezado del ticket
  await printer.feed(1);
  await printer.setAlignment(Align.Center);
  await printer.write("\x1B\x21\x30"); // Texto en negrita o tamaño mayor
  await printer.write("TICKET DE PRUEBA\n");
  await printer.write("\x1B\x21\x00"); // Restablecer el estilo normal
  await printer.write("=".repeat(48) + "\n");

  // Información del local
  await printer.write(`${testData.local.nombre}\n`);
  await printer.write(`${testData.local.telefono}\n`);
  await printer.write("=".repeat(48) + "\n");

  // Información de la venta
  await printer.setAlignment(Align.Left);
  await printer.write(`${translations.table}: ${testData.venta.mesa}\n`);
  await printer.write("=".repeat(48) + "\n");

  // Encabezado de productos
  await printer.write(
    `${translations.qty}   ${translations.product}                 ${translations.unit_price}    ${translations.product_total}\n`
  );
  await printer.write("-".repeat(48) + "\n");

  // Lista de productos
  for (const pedido of testData.pedidos) {
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

  // Totales
  await printer.setAlignment(Align.Right);
  await printer.write(
    `${translations.subtotal}: $${testData.cuenta_venta.subtotal.toFixed(2)}\n`
  );
  await printer.write(
    `${translations.total}: $${testData.cuenta_venta.total.toFixed(2)}\n`
  );

  // Pie de página
  await printer.setAlignment(Align.Center);
  await printer.write("=".repeat(48) + "\n");
  await printer.write(`${translations.thank_you}\n`);
  await printer.write(`${translations.come_again}\n`);

  await printer.feed(6); // Alimentar papel
  await printer.cutter();
}

/**
 * Impreme Ticket de cierre de caja Resumido Windows
 */
async function designTicketCierreWindows(printer, data, translations) {
  const SEPARATOR = "=".repeat(48);
  const LINE_SEPARATOR = "-".repeat(48);

  console.log('DATA CIERRE: ', data);

  // Helper para dividir texto largo
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
  await printer.write("CIERRE DE CAJA\n");
  await printer.write(`${SEPARATOR}\n`);

  // Información principal del cierre
  await printer.setAlignment(Align.Left);
  await printer.write(`Caja: ${data.nombre_caja_aperturada}\n`);
  await printer.write(`Usuario Apertura: ${data.usuario_apertura}\n`);
  await printer.write(`Usuario Cierre: ${data.usuario_cierre}\n`);
  await printer.write(`Fecha Apertura: ${data.fecha_apertura}\n`);
  await printer.write(`Fecha Cierre: ${data.fecha_cierre}\n`);
  await printer.write(`${SEPARATOR}\n`);

  // Totales en columnas
  async function printRow(label, value) {
    await printer.write(`${label.padEnd(30)}${value.padStart(18)}\n`);
    
  }

  await printer.setAlignment(Align.Center);
  await printer.write("RESUMEN DE CAJA\n");
  await printer.write(`${SEPARATOR}\n`);

  await printRow("Total Apertura:", data.total_apertura);
  await printRow("Total efectivo:", data.total_venta_efectivo);
  await printRow("Total tarjeta:", data.total_venta_tarjeta);
  await printRow("Total en Caja (efectivo):", data.total_caja_efectivo);
  await printRow("Total en Caja (general):", data.total_caja_general);
  await printer.write(`${SEPARATOR}\n`);

  // Ingresos y egresos
  await printer.setAlignment(Align.Center);
    await printer.write("INGRESOS Y EGRESOS EN CAJA\n");
  await printer.write(`${SEPARATOR}\n`);

  await printRow("Ingresos:", data.total_ingresos);
  await printRow("Egresos:", data.total_gastos);
  await printRow("Propinas con efectivo:", data.total_propina_predeterminada_efectivo);
  await printRow("Propinas con tarjeta:", data.total_propina_predeterminada_tarjeta);
  await printRow("Créditos cobrados efectivo:", data.total_creditos_cobrados_efectivo);
  await printRow("Créditos cobrados tarjeta:", data.total_creditos_cobrados_tarjeta);
  await printer.write(`${SEPARATOR}\n`);

  // Descuentos
  await printer.setAlignment(Align.Center);
    await printer.write("DESCUENTOS APLICADOS\n");
  await printer.write(`${SEPARATOR}\n`);

  await printRow("Descuentos a pedidos:", data.total_descuento_pedido);
  await printRow("Descuentos al consumo:", data.total_descuento_consumo);
  await printRow("Descuentos a la venta:", data.total_descuento_venta);
  await printer.write(`${SEPARATOR}\n`);

  // Pedidos vendidos
  if (data.pedidos && data.pedidos.length > 0) {
    await printer.setAlignment(Align.Center);
    await printer.write("PRODUCTOS VENDIDOS\n");
    await printer.write(`${LINE_SEPARATOR}\n`);

    // Encabezado de la tabla
    await printer.setAlignment(Align.Left);
    await printer.write(
      `Cant  Producto              P.Unit    Importe\n`
    );
    await printer.write(`${LINE_SEPARATOR}\n`);

    // Detalles de pedidos
    for (const pedido of data.pedidos) {
      const cantidad = pedido.cantidad.toString().padEnd(6);
      const precioUnitario = pedido.precio_unitario.padStart(8);
      const precioTotal = pedido.total.padStart(8);
      const lineasProducto = splitText(pedido.nombre || "-", 20);

      // Primera línea del producto
      await printer.write(`${cantidad}${lineasProducto[0].padEnd(20)}${precioUnitario}${precioTotal}\n`);

      // Líneas adicionales del producto
      for (let i = 1; i < lineasProducto.length; i++) {
        await printer.write(`      ${lineasProducto[i]}\n`);
      }
    }

    await printer.write(`${LINE_SEPARATOR}\n`);
  }

  // Actividad
  await printer.write(`${SEPARATOR}\n`);
  await printer.setAlignment(Align.Center);
  await printer.write("ACTIVIDAD\n");
  await printer.write(`${SEPARATOR}\n`);

  await printRow("Subtotales:", data.subtotales);
  await printRow("Totales:", data.totales);
  await printer.write(`${SEPARATOR}\n`);


  // Alimentar papel y cortar
  await printer.feed(6);
  await printer.cutter();
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

    console.log('DATA RECIBIDA DESDE FUNCIÓN PRINCIPAL');
    console.log(ticketData);

    if (ticketType === "full") {
      await designFullTicket(printer, ticketData, translations);
    } else if (ticketType === "Precuenta") {
      await designPreBillWindows(printer, ticketData, translations);
    } else if (ticketType === "Comanda") {
      await designOrderSlipWindows(printer, ticketData, translations);
    } else if (ticketType === "Cierre") {
      await designTicketCierreWindows(printer, ticketData, translations);
    } else {

      await designTestTicket(printer, ticketData, translations);
    }

    fs.writeFileSync(outputPath, connection.buffer());
    const formattedPrinterName = printerName.replace(/ /g, "_");
    const printCommand = `cmd.exe /c "print /D:\\\\localhost\\"${printerName}" ${outputPath}"`;
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
  await printer.write(`${translations.table}: ${ticketData.mesa}\n`);
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
    `${translations.subtotal}: $${ticketData.subtotal.toFixed(
      2
    )}\n`
  );
  await printer.write(
    `${translations.total}: $${ticketData.total.toFixed(2)}\n`
  );

  await printer.setAlignment(Align.Center);
  await printer.write("=".repeat(48) + "\n"); // Línea inferior
  await printer.write(`${ticketData.encabezado_ticket}\n`);
  await printer.write(`${ticketData.pie_pagina_ticket}\n`);

  await printer.feed(6); // Alimentar papel
  await printer.cutter();
}

/**
 * Diseño de precuenta para Windows
 */
async function designPreBillWindows(printer, ticketData, translations) {
  const SEPARATOR = "=".repeat(48);
  const LINE_SEPARATOR = "-".repeat(48);

  // Helper para dividir texto
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

  // Encabezado
  await printer.feed(1);
  await printer.setAlignment(Align.Center);
  await printer.write("\x1B\x21\x30"); // Texto grande/negrita
  await printer.write(`${translations.pre_bill}\n`);
  await printer.write("\x1B\x21\x00"); // Texto normal
  await printer.write(`${SEPARATOR}\n`);

  // Información del local
  await printer.write(`${ticketData.local.nombre}\n`);
  await printer.write(`${ticketData.local.telefono}\n`);
  await printer.write(`${translations.table}: ${ticketData.mesa}\n`);
  await printer.write(`${ticketData.fecha_actual}\n`);
  await printer.write(`${SEPARATOR}\n`);

  // Encabezado de tabla
  await printer.setAlignment(Align.Left);
  await printer.write("Cant  Producto                  P.U.    Total\n");
  await printer.write(`${LINE_SEPARATOR}\n`);

  // Detalles de pedidos
  for (const pedido of ticketData.pedidos) {
    const cantidad = pedido.cantidad.toString().padEnd(5);
    const precioUnitario = `${ticketData.simbolo_moneda}${pedido.precio_unitario.toFixed(2)}`.padStart(8);
    const precioTotal = `${ticketData.simbolo_moneda}${pedido.precio_total.toFixed(2)}`.padStart(8);
    const producto = pedido.producto_presentacion.nombre;

    const lineasProducto = splitText(producto, 26);

    // Primera línea con cantidad y precios
    await printer.write(
      `${cantidad}${lineasProducto[0].padEnd(26)}${precioUnitario}${precioTotal}\n`
    );

    // Líneas adicionales del producto
    for (let i = 1; i < lineasProducto.length; i++) {
      await printer.write(`      ${lineasProducto[i]}\n`);
    }
  }

  // Subtotales y totales
  await printer.write(`${LINE_SEPARATOR}\n`);
  await printer.setAlignment(Align.Right);
  await printer.write(`${translations.subtotal}: ${ticketData.simbolo_moneda}${ticketData.subtotal.toFixed(2)}\n`);
  if (ticketData.impuestos.length > 0) {
    for (const impuesto of ticketData.impuestos) {
      await printer.write(
        `  ${impuesto.impuesto}: ${ticketData.simbolo_moneda}${impuesto.total}\n`
      );
    }
  }
  await printer.write(`${translations.tip}: ${ticketData.simbolo_moneda}${ticketData.propina_predeterminada.toFixed(2)}\n`);
  await printer.write("\x1B\x21\x30"); // Texto grande
  await printer.write(`${translations.total}: ${ticketData.simbolo_moneda}${ticketData.total.toFixed(2)}\n`);
  await printer.write("\x1B\x21\x00"); // Texto normal

  // Pie del ticket
  await printer.setAlignment(Align.Center);
  await printer.write(`${SEPARATOR}\n`);
  await printer.write(`${ticketData.encabezado_ticket}\n`);
  await printer.write(`${ticketData.pie_pagina_ticket}\n`);

  // Alimentar papel y cortar
  await printer.feed(6);
  await printer.cutter();
}

/**
 * Diseño de ticket completo (full) para todos los sistemas operativos
 */
async function designFullTicket(printer, ticketData, translations) {
  const SEPARATOR = "=".repeat(48);
  const LINE_SEPARATOR = "-".repeat(48);

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
  await printer.write(`${translations.full_ticket}\n`);
  await printer.write("\x1B\x21\x00"); // Texto normal
  await printer.write(`${SEPARATOR}\n`);

  // Información del local
  await printer.write(`${ticketData.local.nombre}\n`);
  await printer.write(`${ticketData.local.telefono}\n`);
  if (ticketData.local.nit) {
    await printer.write(`NIT: ${ticketData.local.nit}\n`);
  }
  await printer.write(`Numero: ${ticketData.numero_comprobante}\n`);
  await printer.write(`${SEPARATOR}\n`);

  // Información del cliente y venta
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
    `${translations.date}: ${ticketData.venta.fin_venta}\n`
  );
  await printer.write(`${SEPARATOR}\n`);

  // Encabezado de productos
  await printer.write(
    `${translations.qty.padEnd(6)}${translations.product.padEnd(22)}${translations.unit_price.padStart(10)}${translations.product_total.padStart(10)}\n`
  );
  await printer.write(`${LINE_SEPARATOR}\n`);

  // Lista de productos
  for (const pedido of ticketData.pedidos) {
    const cantidad = pedido.cantidad.toString().padEnd(6);
    const precioUnitario = `${ticketData.simbolo_moneda}${pedido.precio_unitario.toFixed(2)}`.padStart(10);
    const precioTotal = `${ticketData.simbolo_moneda}${pedido.precio_total.toFixed(2)}`.padStart(10);
    const producto = pedido.producto_presentacion.nombre;

    // Se divide el nombre del producto si es muy largo
    const lineasProducto = splitText(producto, 22);

    // Primera línea con cantidad, producto, precios
    await printer.write(
      `${cantidad}${lineasProducto[0].padEnd(22)}${precioUnitario}${precioTotal}\n`
    );

    // Si el nombre del producto es largo, se imprimen las siguientes líneas debajo
    for (let i = 1; i < lineasProducto.length; i++) {
      await printer.write(`      ${lineasProducto[i]}\n`); // Indentación para mantener formato
    }
  }

  await printer.write(`${LINE_SEPARATOR}\n`);

  // Totales
  await printer.setAlignment(Align.Right);
  await printer.write(
    `${translations.subtotal}: ${ticketData.simbolo_moneda}${ticketData.cuenta_venta.subtotal.toFixed(2)}\n`
  );
  if (ticketData.cuenta_venta.descuento > 0) {
    await printer.write(
      `${translations.discount}: ${ticketData.simbolo_moneda}${ticketData.cuenta_venta.descuento.toFixed(2)}\n`
    );
  }
  
  // Mostrar los impuestos detalladamente
  if (ticketData.cuenta_venta.impuestos.length > 0) {
    for (const impuesto of ticketData.cuenta_venta.impuestos) {
      await printer.write(
        `  ${impuesto.impuesto}: ${ticketData.simbolo_moneda}${impuesto.total}\n`
      );
    }
  }
  await printer.write(
    `${translations.tip}: ${ticketData.simbolo_moneda}${ticketData.cuenta_venta.propina_predeterminada.toFixed(2)}\n`
  );
  // await printer.write(
  //   `Impuesto: ${ticketData.simbolo_moneda}${ticketData.cuenta_venta.propina_predeterminada.toFixed(2)}\n`
  // );
  await printer.write("\x1B\x21\x30"); // Texto grande
  await printer.write(
    `${translations.total}: ${ticketData.simbolo_moneda}${ticketData.cuenta_venta.total.toFixed(2)}\n`
  );
  await printer.write("\x1B\x21\x00"); // Texto normal

  // Pagos
  if (ticketData.pagos && ticketData.pagos.length > 0) {
    await printer.write(`${SEPARATOR}\n`);
    await printer.write(`${translations.payments}\n`);
    for (const pago of ticketData.pagos) {
      await printer.write(
        `${pago.tipo_pago.nombre}: ${ticketData.simbolo_moneda}${pago.monto.toFixed(2)}${pago.tarjeta ? ` (${pago.tarjeta})` : ""
        }\n`
      );
    }
  }

  // Crédito
  if (ticketData.credito) {
    await printer.write(`${SEPARATOR}\n`);
    await printer.write(
      `${translations.credit}: ${ticketData.simbolo_moneda}${ticketData.credito.total_credito.toFixed(2)}\n`
    );
    await printer.write(
      `${translations.num_installments}: ${ticketData.credito.num_cuotas}\n`
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

  // Alimentar y cortar papel
  await printer.feed(6);
  await printer.cutter();

  // Abrir gaveta si hay pagos en efectivo
  if (ticketData.pagos.some((pago) => pago.tipo_pago.id === 1)) {
    await printer.drawer(Drawer.First);
  }
}


/**
 * Diseño de comanda para Unix (macOS/Linux)
 */
async function designOrderSlipUnix(printer, ticketData, translations) {
  // Encabezado del ticket
  await printer.setAlignment(Align.Center);
  await printer.write("*".repeat(48) + "\n");
  await printer.write("\x1B\x21\x30"); // Texto en negrita y doble ancho
  await printer.write(`${translations.order_slip}\n`);
  await printer.write("\x1B\x21\x00"); // Texto normal
  await printer.write(".".repeat(48) + "\n");
  await printer.setAlignment(Align.Left);

  // Información general
  await printer.write(`${translations.area}: ${ticketData.area}\n`);
  await printer.write(`${translations.table}: ${ticketData.mesa}\n`);
  await printer.write(`${translations.waiter}: ${ticketData.mesero}\n`);
  await printer.write(`${translations.date}: ${ticketData.fecha}\n`);
  await printer.write("*".repeat(48) + "\n");
  await printer.feed(1);

  // Encabezados de la tabla con columnas alineadas
  await printer.setAlignment(Align.Left);
  await printer.write(
    `${translations.qty.padEnd(8)}${translations.product.padEnd(32)}\n`
  );
  await printer.write("-".repeat(48) + "\n");

  // Iterar sobre los pedidos y formatear cada fila
  for (const pedido of ticketData.pedidos) {
    const cantidad = String(pedido.cantidad).padEnd(8);
    const producto = (pedido.presentacion ?? pedido.producto).padEnd(32);
    await printer.write(`${cantidad}${producto}\n`);

    // Iterar sobre los modificadores
    for (const modificador of pedido.modificadores) {
      const espacio = String('').padEnd(8);
      const modTexto = `  * ${modificador.cantidad}x ${modificador.nombre}`.padEnd(32);
      await printer.write(`${espacio}${modTexto}\n`);
    }
    if (pedido.notaPedido !== null && pedido.notaPedido !== undefined) {
      const espacio = String('').padEnd(8);
      const notTexto = `  - ${modificador.notaPedido}`.padEnd(32);
      await printer.write(`${espacio}${notTexto}\n`);
    }
  }

  // Final del ticket
  await printer.feed(2);
  await printer.write("*".repeat(48) + "\n");
  await printer.feed(4);
  await printer.cutter();
}



/**
 * Diseño de comanda para Windows
 */
async function designOrderSlipWindows(printer, ticketData, translations) {

  console.log('DATA COMANDA: ', ticketData);

  const SEPARATOR = "=".repeat(48);
  const LINE_SEPARATOR = "-".repeat(48);
  const STAR_SEPARATOR = "*".repeat(48);

  // Helper para manejar texto largo
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

  // Encabezado de la comanda
  await printer.feed(1);
  await printer.setAlignment(Align.Center);
  await printer.write(`${STAR_SEPARATOR}\n`);
  await printer.write("\x1B\x21\x30"); // Texto grande/negrita
  await printer.write(`${translations.order_slip}\n`);
  await printer.write("\x1B\x21\x00"); // Restablecer texto normal
  await printer.write(`${SEPARATOR}\n`);

  // Información del área y la mesa
  await printer.setAlignment(Align.Left);
  await printer.write("\x1B\x21\x30");
  await printer.write(`N: ${ticketData.numero_comanda} \n`);
  await printer.write("\x1B\x21\x00");
  await printer.write(`${translations.area}: ${ticketData.area}\n`);
  await printer.write(`${translations.table}: ${ticketData.mesa || translations.unassigned}\n`);
  await printer.write(`${'Mesero'}: ${ticketData.mesero}\n`);
  await printer.write(`${'Fecha'}: ${ticketData.fecha}\n`);
  await printer.write(`${SEPARATOR}\n`);

  // Encabezado de productos
  await printer.write(`${translations.qty.padEnd(8)}${translations.product}\n`);
  await printer.write(`${LINE_SEPARATOR}\n`);

  // Detalle de pedidos
  for (const pedido of ticketData.pedidos) {
    const cantidad = `${pedido.cantidad}`.padEnd(8);
    const presentacion = pedido.presentacion || pedido.producto;
    const lineasProducto = splitText(presentacion, 45);

    // Primera línea del producto con cantidad
    await printer.write(`${cantidad}${lineasProducto[0]}\n`);

    // Líneas adicionales del nombre del producto
    for (let i = 1; i < lineasProducto.length; i++) {
      await printer.write(`        ${lineasProducto[i]}\n`);
    }

    // Modificadores
    if (pedido.modificadores && pedido.modificadores.length > 0) {
      for (const modificador of pedido.modificadores) {
        const modCantidad = `${modificador.cantidad}x `.padStart(15);
        const modNombre = splitText(modificador.nombre, 40);

        // Primera línea del modificador
        await printer.write(` ${modCantidad}${modNombre[0].padEnd(5)}*\n`);

        // Líneas adicionales del modificador
        for (let i = 1; i < modNombre.length; i++) {
          await printer.write(`      ${modNombre[i]}\n`);
        }
      }
    }

    // Nota del pedido
    if (pedido.notaPedido) {
      const lineasNota = splitText(pedido.notaPedido, 40);
      await printer.write(`  - ${translations.note}:\n`);
      for (const linea of lineasNota) {
        await printer.write(`    ${linea}\n`);
      }
    }
  }

  // Separador final
  await printer.write(`${STAR_SEPARATOR}\n`);

  // Alimentar y cortar papel
  await printer.feed(6);
  await printer.cutter();
}

module.exports = {
  printTicket,
};
