const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const os = require("os");
const { app } = require("electron");

// Obtener VendorID y ProductID para impresion ESC/POS
const { Printer, InMemory, Style, Align, Drawer } = require("escpos-buffer");

// Ruta segura para almacenar el archivo temporal
const outputDir = app.getPath("userData");
const outputPath = path.join(outputDir, "ticket_output.bin");

async function printTicketWithBuffer(ticketData, printerName) {
  if (os.platform() === "win32") {
    await printTicketWithPowerShell(ticketData, printerName);
  } else {
    await printTicketWithESCBuffer(ticketData, printerName);
  }
}

// Función para macOS/Linux con escpos-buffer
async function printTicketWithESCBuffer(ticketData, printerName) {
  try {
    const connection = new InMemory();
    const printer = await Printer.CONNECT("POS-80", connection);

    // Crear contenido del ticket
    await printer.setAlignment(Align.Center);
    await printer.write("\x1B\x21\x30"); // Cambia a texto en negrita o doble ancho, si está disponible
    await printer.write("PRECUENTA\n");
    await printer.write("\x1B\x21\x00"); // Restaura el estilo normal

    await printer.write("=".repeat(48) + "\n"); // Línea separadora debajo

    // Continuar con el resto del ticket
    await printer.setAlignment(Align.Center);
    await printer.write(`${ticketData.local.nombre}\n`);
    await printer.write(`${ticketData.local.telefono}\n`);
    await printer.write(`Mesa: ${ticketData.venta.mesa}\n`);
    await printer.write("=".repeat(48) + "\n"); // Separador de sección

    // Encabezado de tabla
    await printer.setAlignment(Align.Left);
    await printer.write("Cant   Producto                 P.U    Total\n");
    await printer.write("-".repeat(48) + "\n"); // Línea divisoria

    // Imprimir cada pedido
    for (const pedido of ticketData.pedidos) {
      const cantidad = pedido.cantidad.toString().padEnd(5); // "Cant" - 5 caracteres de ancho
      const precioUnitario = `$${pedido.precio_unitario.toFixed(2)}`.padStart(
        6
      ); // "P.U" - 6 caracteres de ancho
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
      `Subtotal: $${ticketData.cuenta_venta.subtotal.toFixed(2)}\n`
    );
    await printer.write(
      `Total: $${ticketData.cuenta_venta.total.toFixed(2)}\n`
    );

    await printer.setAlignment(Align.Center);
    await printer.write("=".repeat(48) + "\n"); // Línea inferior
    await printer.write("Gracias por su compra\n");
    await printer.write("¡Vuelva pronto!\n");

    await printer.feed(6); // Alimentar papel
    await printer.cutter();
    await printer.drawer(Drawer.First);

    // Generar el archivo binario y enviarlo a la impresora en macOS
    // const outputPath = "ticket_output.bin";
    console.log("Ruta del archivo ticket_output.bin:", outputPath);
    fs.writeFileSync(outputPath, connection.buffer());
    exec(`lp -d "${printerName.replace(/ /g, "_")}" "${outputPath}"`, (err) => {
      if (err) console.error("Error al imprimir en Unix:", err);
      else console.log("Impresión completada en Unix");
    });
  } catch (error) {
    console.error("Error al imprimir el ticket con buffer:", error);
  }
}

// Función para Windows con node-thermal-printer
async function printTicketWithPowerShell(ticketData, printerName) {
  try {
    const connection = new InMemory();
    const printer = await Printer.CONNECT("POS-80", connection);

    // Crear contenido del ticket
    await printer.setAlignment(Align.Center);
    await printer.write("\x1B\x21\x30"); // Cambia a texto en negrita o doble ancho, si está disponible
    await printer.write("PRECUENTA\n");
    await printer.write("\x1B\x21\x00"); // Restaura el estilo normal

    await printer.write("=".repeat(48) + "\n"); // Línea separadora debajo

    // Continuar con el resto del ticket
    await printer.setAlignment(Align.Center);
    await printer.write(`${ticketData.local.nombre}\n`);
    await printer.write(`${ticketData.local.telefono}\n`);
    await printer.write(`Mesa: ${ticketData.venta.mesa}\n`);
    await printer.write("=".repeat(48) + "\n"); // Separador de sección

    // Imprimir cada pedido
    for (const pedido of ticketData.pedidos) {
      const cantidad = pedido.cantidad.toString().padEnd(5); // "Cant" - 5 caracteres de ancho
      const precioUnitario = `$${pedido.precio_unitario.toFixed(2)}`.padStart(
        6
      ); // "P.U" - 6 caracteres de ancho
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
      `Subtotal: $${ticketData.cuenta_venta.subtotal.toFixed(2)}\n`
    );
    await printer.write(
      `Total: $${ticketData.cuenta_venta.total.toFixed(2)}\n`
    );
    await printer.setAlignment(Align.Center);
    await printer.write("=".repeat(48) + "\n");
    await printer.write("Gracias por su compra\n");
    await printer.write("¡Vuelva pronto!\n");

    await printer.feed(6); // Alimentar papel
    await printer.cutter();
    await printer.drawer(Drawer.First);

    // Guardar el contenido en un archivo binario .bin
    // const outputPath = path.join(__dirname, "ticket_output.bin");
    const outputPath = path.join(process.resourcesPath, "ticket_output.bin");
    console.log("Ruta del archivo ticket_output.bin:", outputPath);
    fs.writeFileSync(outputPath, connection.buffer());
    const formattedPrinterName = printerName.replace(/ /g, "_");
    // Comando para imprimir en Windows
    const printCommand = `cmd.exe /c "print /D:\\\\localhost\\${formattedPrinterName} ${outputPath}"`;

    exec(printCommand, (err, stdout, stderr) => {
      if (err) {
        console.error(
          "Error al imprimir en Windows con el comando print:",
          err
        );
        return;
      }
      console.log(
        "Impresión completada en Windows usando el comando print:",
        stdout
      );
    });
  } catch (error) {
    console.error("Error al imprimir el ticket con buffer:", error);
  }
}

module.exports = {
  // findPrinterByName,
  printTicketWithBuffer,
};
