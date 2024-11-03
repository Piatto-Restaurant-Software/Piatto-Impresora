const usb = require("usb");
const { exec } = require("child_process");
const os = require("os");

class PrinterService {
  static findPrinterByName(printerName) {
    return new Promise((resolve, reject) => {
      const devices = usb.getDeviceList();
      let foundDevice = null;

      devices.forEach((device) => {
        const deviceDesc = device.deviceDescriptor;
        if (deviceDesc.idVendor === 0x0416 && deviceDesc.idProduct === 0x5011) {
          // Adjust for other printers as needed
          foundDevice = {
            vendorId: deviceDesc.idVendor,
            productId: deviceDesc.idProduct,
            manufacturer: "Winbond Electronics Corp.",
            product: printerName,
          };
        }
      });

      if (foundDevice) {
        console.log("Impresora encontrada:", foundDevice);
        resolve(foundDevice);
      } else {
        console.log("Impresora no encontradas", foundDevice);
        reject(new Error("Printer not found"));
      }
    });
  }

  // Obtener todas las impresoras conectadas y sus estados usando comandos del sistema
  static getAllConnectedPrinters() {
    return new Promise((resolve, reject) => {
      if (os.platform() === "win32") {
        exec(
          'wmic printer get Name, PrinterStatus, PortName, Default',
          (error, stdout, stderr) => {
            if (error) {
              console.error("Error al ejecutar wmic:", error);
              return reject(
                `Error al obtener impresoras en Windows: ${error.message}`
              );
            }
            console.log("Salida de wmic:", stdout);

            const usbDevices = usb.getDeviceList();

            const printers = stdout
              .split("\n")
              .slice(1)
              .map(line => line.trim())
              .filter(line => line) // Eliminar líneas vacías
              .map(line => {
                // Dividir usando una expresión regular para extraer cada columna de forma precisa
                const parts = line.match(/(TRUE|FALSE)\s+(.+?)\s+([\S]+)\s+(\d+)/);

                if (!parts) return null; // Ignorar líneas que no coinciden con el patrón

                const isDefault = parts[1] === "TRUE";
                const printerName = parts[2].trim();
                const portName = parts[3].trim();
                const wmicStatus = this.parseWindowsStatus(parts[4]);

                // Verificar si el dispositivo está físicamente conectado al puerto USB esperado
                const isPhysicallyConnected = usbDevices.some(device => {
                  const desc = device.deviceDescriptor;
                  return portName.startsWith("USB"); // Verificar si está en un puerto USB
                });

                let finalStatus;
                if (wmicStatus === "Conectada" && isPhysicallyConnected) {
                  finalStatus = "Conectada";
                } else if (wmicStatus === "Inactiva" && isPhysicallyConnected) {
                  finalStatus = "Conectada pero inactiva";
                } else {
                  finalStatus = "Desconectada";
                }

                return {
                  name: printerName,
                  status: finalStatus,
                  default: isDefault,
                  physicallyConnected: isPhysicallyConnected,
                  port: portName
                };
              })
              .filter(Boolean); // Eliminar cualquier null resultante de líneas no coincidentes

            resolve(printers);
          }
        );
      } else if (os.platform() === "darwin") {
        exec("lpstat -p -d", (error, stdout, stderr) => {
          if (error) {
            console.error("Error al ejecutar lpstat:", error);
            return reject(
              `Error al obtener impresoras en macOS: ${error.message}`
            );
          }
          console.log("Salida de lpstat:", stdout);

          const printers = stdout
            .split("\n")
            .filter((line) => line.includes("impresora")) // Buscar líneas que describen impresoras
            .map((line) => {
              const nameMatch = line.match(/impresora\s+(\S+)/); // Capturar el nombre después de "impresora "
              const name = nameMatch ? nameMatch[1] : "Desconocido";
              const status = line.includes("inactiva")
                ? "Inactiva"
                : "Conectada";
              const isDefault = stdout.includes(
                `destino por omisión del sistema: ${name}`
              );

              return {
                name: name,
                status: status,
                default: isDefault,
              };
            });

          resolve(printers);
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
}

module.exports = PrinterService;
