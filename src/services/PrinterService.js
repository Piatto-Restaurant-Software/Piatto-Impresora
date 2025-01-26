const usb = require("usb");
const { exec } = require("child_process");
const os = require("os");

class PrinterService {
  // Detecta estado de impresora WINDOWS
  async isPrinterConnectedWindows(printerName) {
    console.log("Comando de comprobacion -> ", `powershell -Command "Get-Printer | Where-Object { $_.Name -eq '${printerName}' }"`)
    return new Promise((resolve) => {
      exec(
        `powershell -Command "Get-Printer | Where-Object { $_.Name -eq '${printerName}' }"`,
        (error, stdout) => {
          if (error || !stdout.trim()) {
            resolve(false); // Impresora no encontrada o no conectada
          } else {
            resolve(true); // Impresora conectada
          }
        }
      );
    });
  }

  // Detecta estado de impresora MACOS
  async isPrinterConnectedUnix(printerName) {
    return new Promise((resolve) => {
      exec(`lpstat -p ${printerName}`, (error, stdout) => {
        if (error || stdout.includes("inactiva")) {
          resolve(false); // Impresora no conectada o inactiva
        } else {
          resolve(true); // Impresora conectada y activa
        }
      });
    });
  }

  // Detecta estado de impresora WINDOWS o MACOS
  async testPrinterConnection(printerName) {
    try {
      const isConnected =
        os.platform() === "win32"
          ? await this.isPrinterConnectedWindows(printerName)
          : await this.isPrinterConnectedUnix(printerName);
  
      if (!isConnected) {
        throw new Error("La impresora no está conectada o activa.");
      }
  
      console.log("Conexión con la impresora verificada.");
      return true;
    } catch (error) {
      console.error("Error al verificar la conexión de la impresora:", error);
      return false;
    }
  }
  

  static findPrinterByName(printerName) {
    return new Promise((resolve, reject) => {
      const devices = usb.getDeviceList();
      let foundDevice = null;

      devices.forEach((device) => {
        const deviceDesc = device.deviceDescriptor;
        if (deviceDesc.idVendor === 0x0416 && deviceDesc.idProduct === 0x5011) {
          foundDevice = {
            vendorId: deviceDesc.idVendor,
            productId: deviceDesc.idProduct,
            manufacturer: "Winbond Electronics Corp.",
            product: printerName,
          };
        }
      });

      if (foundDevice) {
        resolve(foundDevice);
      } else {
        reject(new Error("Printer not found"));
      }
    });
  }

  static getNamePrinter(target) {
    return new Promise((resolve, reject) => {
      if (os.platform() === "win32") {
        resolve(target ? target : null);
      } else if (os.platform() === "darwin") {
        exec("lpstat -l -p", async (error, stdout, stderr) => {
          if (error) {
            console.error("Error al ejecutar lpstat:", error);
            return reject(
              `Error al obtener impresoras en macOS: ${error.message}`
            );
          }

          const printers = stdout
            .split("\n\n")
            .filter((block) => block.includes("impresora"))
            .map((block) => {
              const nameMatch = block.match(/impresora\s+(\S+)/);
              const descriptionMatch = block.match(/Descripción:\s+(.+)/);
              const name = nameMatch ? nameMatch[1] : "Desconocido";
              const description = descriptionMatch
                ? descriptionMatch[1]
                : "Sin descripción";

              return {
                name: name,
                description: description,
              };
            });

          const matchingPrinter = printers.find(
            (printer) => printer.description === target
          );

          resolve(matchingPrinter ? matchingPrinter.name : null);
        });
      } else {
        reject("Plataforma no soportada");
      }
    });
  }

  static getAllConnectedPrinters() {
    return new Promise((resolve, reject) => {
      if (os.platform() === "win32") {
        exec(
          'powershell -Command "Get-Printer | Format-Table Name, PortName, Default -AutoSize | Out-String"',
          async (error, stdout, stderr) => {
            if (error) {
              console.error("Error al ejecutar PowerShell:", error);
              return reject(
                `Error al obtener impresoras en Windows: ${error.message}`
              );
            }

            const usbDevices = usb.getDeviceList();

            const printers = await Promise.all(
              stdout
                .split("\n")
                .slice(3) // Omitir encabezados y líneas vacías
                .map((line) => line.trim())
                .filter((line) => line) // Filtrar líneas vacías
                .map(async (line) => {
                  // Verificar cada línea
                  const parts = line.match(/^(.+?)\s{2,}(.+?)\s{2,}(.+)$/); // Captura columnas con separadores

                  if (!parts) return null; // Si no se pueden capturar, descartar la línea

                  const printerName = parts[1].trim();
                  const portName = parts[2].trim();
                  const isDefault = parts[3].trim() === "True";

                  const isPhysicallyConnected = usbDevices.some((device) => {
                    const desc = device.deviceDescriptor;
                    return portName.startsWith("USB");
                  });

                  const isPrinting = await this.checkPrintJobWindows(
                    printerName
                  );

                  let finalStatus;
                  if (isPrinting) {
                    finalStatus = "Imprimiendo";
                  } else if (isPhysicallyConnected) {
                    finalStatus = "Conectada";
                  } else {
                    finalStatus = "Desconectada";
                  }

                  return {
                    name: printerName,
                    status: finalStatus,
                    default: isDefault,
                    physicallyConnected: isPhysicallyConnected,
                    port: portName,
                  };
                })
            );

            resolve(printers.filter(Boolean));
          }
        );
      } else if (os.platform() === "darwin") {
        exec("lpstat -l -p", async (error, stdout, stderr) => {
          if (error) {
            console.error("Error al ejecutar lpstat:", error);
            return reject(
              `Error al obtener impresoras en macOS: ${error.message}`
            );
          }

          // Procesar las impresoras listadas por `lpstat`
          const printers = stdout
            .split("\n\n") // Dividir por bloques de impresoras
            .filter((block) => block.includes("impresora")) // Asegurarse de que sea un bloque válido
            .map((block) => {
              const nameMatch = block.match(/impresora\s+(\S+)/); // Capturar el nombre técnico
              const descriptionMatch = block.match(/Descripción:\s+(.+)/); // Capturar la descripción
              const name = nameMatch ? nameMatch[1] : "Desconocido";
              const description = descriptionMatch
                ? descriptionMatch[1]
                : "Sin descripción";

              const status = block.includes("inactiva")
                ? "Inactiva"
                : "Conectada";
              const isDefault = stdout.includes(
                `destino por omisión del sistema: ${name}`
              );

              return {
                name: name,
                description: description,
                status: status,
                default: isDefault,
              };
            });

          resolve(printers.filter(Boolean)); // Retornar solo impresoras válidas
        });
      } else {
        reject("Plataforma no soportada");
      }
    });
  }

  static parseWindowsStatus(statusCode) {
    switch (statusCode) {
      case "3":
        return "Conectada";
      case "4":
        return "Inactiva";
      case "5":
        return "Error";
      default:
        return "Desconocido";
    }
  }

  static checkPrintJobWindows(printerName) {
    return new Promise((resolve) => {
      exec(
        `powershell -Command "Get-PrintJob -PrinterName '${printerName}'"`,
        (error, stdout) => {
          resolve(stdout.trim().length > 0);
        }
      );
    });
  }

  static checkPrintJobMac(printerName) {
    return new Promise((resolve) => {
      exec(`lpstat -o ${printerName}`, (error, stdout) => {
        resolve(stdout.trim().length > 0);
      });
    });
  }
}

module.exports = PrinterService;
