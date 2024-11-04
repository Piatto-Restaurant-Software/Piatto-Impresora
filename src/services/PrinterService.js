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
        console.log("Impresora no encontrada", foundDevice);
        reject(new Error("Printer not found"));
      }
    });
  }

  static getAllConnectedPrinters() {
    return new Promise((resolve, reject) => {
      if (os.platform() === "win32") {
        exec(
          'wmic printer get Name, PrinterStatus, PortName, Default',
          async (error, stdout, stderr) => {
            if (error) {
              console.error("Error al ejecutar wmic:", error);
              return reject(
                `Error al obtener impresoras en Windows: ${error.message}`
              );
            }
            console.log("Salida de wmic:", stdout);

            const usbDevices = usb.getDeviceList();

            const printers = await Promise.all(
              stdout
                .split("\n")
                .slice(1)
                .map((line) => line.trim())
                .filter((line) => line)
                .map(async (line) => {
                  const parts = line.match(/(TRUE|FALSE)\s+(.+?)\s+([\S]+)\s+(\d+)/);

                  if (!parts) return null;

                  const isDefault = parts[1] === "TRUE";
                  const printerName = parts[2].trim();
                  const portName = parts[3].trim();
                  const wmicStatus = this.parseWindowsStatus(parts[4]);

                  const isPhysicallyConnected = usbDevices.some((device) => {
                    const desc = device.deviceDescriptor;
                    return portName.startsWith("USB");
                  });

                  const isPrinting = await this.checkPrintJobWindows(printerName);

                  let finalStatus;
                  if (isPrinting) {
                    finalStatus = "Imprimiendo";
                  } else if (wmicStatus === "Error") {
                    finalStatus = "Error";
                  } else if (wmicStatus === "Conectada" && isPhysicallyConnected) {
                    finalStatus = "Conectada";
                  } else if (wmicStatus === "Inactiva" && isPhysicallyConnected) {
                    finalStatus = "Inactiva";
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
        exec("lpstat -p -d", async (error, stdout, stderr) => {
          if (error) {
            console.error("Error al ejecutar lpstat:", error);
            return reject(
              `Error al obtener impresoras en macOS: ${error.message}`
            );
          }
          // console.log("Salida de lpstat:", stdout);

          const usbDevices = usb.getDeviceList();

          const printers = await Promise.all(
            stdout
              .split("\n")
              .filter((line) => line.includes("impresora"))
              .map(async (line) => {
                const nameMatch = line.match(/impresora\s+(\S+)/);
                const name = nameMatch ? nameMatch[1] : "Desconocido";
                const status = line.includes("inactiva") ? "Inactiva" : "Conectada";
                const isDefault = stdout.includes(
                  `destino por omisión del sistema: ${name}`
                );

                const isPhysicallyConnected = usbDevices.some((device) => {
                  const desc = device.deviceDescriptor;
                  return device.portNumbers && device.portNumbers.includes(1);
                });

                const isPrinting = await this.checkPrintJobMac(name);

                let finalStatus;
                if (isPrinting) {
                  finalStatus = "Imprimiendo";
                } else if (status === "Conectada" && isPhysicallyConnected) {
                  finalStatus = "Conectada";
                } else if (status === "Inactiva" && isPhysicallyConnected) {
                  finalStatus = "Inactiva";
                } else {
                  finalStatus = "Desconectada";
                }

                return {
                  name: name,
                  status: finalStatus,
                  default: isDefault,
                  physicallyConnected: isPhysicallyConnected,
                };
              })
          );

          resolve(printers.filter(Boolean));
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
