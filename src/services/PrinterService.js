const { exec } = require("child_process");
const os = require("os");

class PrinterService {
  // Detecta estado de impresora WINDOWS usando Get-WmiObject
  async isPrinterConnectedWindows(printerName) {
    return new Promise((resolve) => {
      exec(
        `powershell -Command "$printer = Get-WmiObject -Query \\"SELECT * FROM Win32_Printer WHERE Name = '${printerName.replace(
          /'/g,
          "''"
        )}'\\"; if ($printer) { $port = Get-PrinterPort -Name $printer.PortName; $usbDevice = Get-PnpDevice -PresentOnly | Where-Object { $_.DeviceID -match $port.Name.Replace('COM','USB') -or $_.Name -match $printer.DriverName }; if (($port.Name -match 'USB' -or $usbDevice) -and !$printer.WorkOffline) { exit 0 } else { exit 1 } } else { exit 2 }"`,
        (error) => {
          resolve(error === null);
        }
      );
    });
  }

  // Detecta estado de impresora MACOS
  async isPrinterConnectedUnix(printerName) {
    return new Promise((resolve) => {
      exec(`lpstat -p ${printerName}`, (error, stdout) => {
        resolve(!error && !stdout.includes("inactiva"));
      });
    });
  }

  // Detecta estado de impresora WINDOWS o MACOS
  async testPrinterConnection(printerName) {
    console.log("Verificando conexión de la impresora:", printerName);
    try {
      if (os.platform() === "win32") {
        return await this.isPrinterConnectedWindows(printerName);
      } else {
        return await this.isPrinterConnectedUnix(printerName);
      }
    } catch (error) {
      console.error("Error al verificar la impresora:", error);
      return false;
    }
  }

  static findPrinterByName(printerName) {
    return new Promise((resolve) => {
      // En Windows, no necesitamos depender de USB Vendor/Product IDs
      if (os.platform() === "win32") {
        resolve({
          name: printerName,
          port: "AUTO", // Valor genérico para que printTicket use el nombre
          type: "WINDOWS_PRINTER",
        });
      }
      // En macOS, usar lpstat para obtener información
      else if (os.platform() === "darwin") {
        exec(`lpstat -p ${printerName}`, (error, stdout) => {
          if (error) {
            resolve({
              name: printerName,
              port: "AUTO",
              type: "MAC_PRINTER",
              error: "Printer info not available",
            });
          } else {
            resolve({
              name: printerName,
              port: stdout.match(/device for \S+:\s*(\S+)/)?.[1] || "AUTO",
              type: "MAC_PRINTER",
            });
          }
        });
      }
      // Otros sistemas (Linux)
      else {
        resolve({
          name: printerName,
          port: "AUTO",
          type: "GENERIC_PRINTER",
        });
      }
    });
  }

  static getNamePrinter(printerName) {
    return new Promise((resolve) => {
      // En sistemas modernos, el nombre es suficiente
      resolve(printerName);
    });
  }


  static async getAllConnectedPrinters() {
    return new Promise((resolve, reject) => {
      if (os.platform() === "win32") {
        exec(
          `powershell -Command "$printers = Get-Printer | Select-Object Name, PortName, DriverName, Shared, Published; $defaultPrinter = (Get-CimInstance -ClassName Win32_Printer | Where-Object { $_.Default }).Name; [PSCustomObject]@{ Printers = $printers; DefaultPrinter = $defaultPrinter } | ConvertTo-Json -Depth 5"`,
          async (error, stdout, stderr) => {
            if (error) {
              console.error("Error al ejecutar PowerShell:", error);
              return reject(`Error al obtener impresoras: ${error.message}`);
            }

            try {
              const result = JSON.parse(stdout);
              const printers = result.Printers || [];
              const defaultPrinter = result.DefaultPrinter || null;

              const printerList = await Promise.all(
                printers.map(async (printer) => {
                  const isPrinting = await this.isPrinterPrinting(printer.Name);
                  const isConnected =
                    await this.isPrinterPhysicallyConnectedWindows(
                      printer.Name
                    );

                  return {
                    name: printer.Name,
                    description: printer.DriverName,
                    status: isPrinting
                      ? "Imprimiendo"
                      : isConnected
                      ? "Conectada"
                      : "Desconectada",
                    default: printer.Name === defaultPrinter,
                    port: printer.PortName,
                    shared: printer.Shared,
                    published: printer.Published,
                  };
                })
              );

              resolve(printerList.filter(Boolean));
            } catch (parseError) {
              console.error("Error al parsear resultado:", parseError);
              reject("Error al procesar datos de impresoras");
            }
          }
        );
      }
      // Resto de implementaciones para macOS...
    });
  }

  static async isPrinterPrinting(printerName) {
    return new Promise((resolve) => {
      exec(
        `powershell -Command "[bool](Get-PrintJob -PrinterName '${printerName}' -ErrorAction SilentlyContinue)"`,
        (error, stdout) => {
          resolve(!error && stdout.trim() === "True");
        }
      );
    });
  }

  static async isPrinterPhysicallyConnectedWindows(printerName) {
    return new Promise((resolve) => {
      const sanitizedName = printerName.replace(/'/g, "''");

      const psCommand = `
      $printer = Get-WmiObject -Query "SELECT * FROM Win32_Printer WHERE Name = '${sanitizedName}'";
      if ($printer) {
        $port = Get-PrinterPort -Name $printer.PortName;
        $usbDevice = Get-PnpDevice -PresentOnly | Where-Object {
          $_.DeviceID -match $port.Name.Replace('COM','USB') -or $_.Name -match $printer.DriverName
        };
        if (($port.Name -match 'USB' -or $usbDevice) -and -not $printer.WorkOffline) {
          exit 0
        } else {
          exit 1
        }
      } else {
        exit 2
      }
    `
        .replace(/\n/g, "")
        .replace(/"/g, '\\"');

      const fullCommand = `powershell -Command "${psCommand}"`;

      exec(fullCommand, (error) => {
        // error === null → exit 0 → conectada
        // error !== null → exit 1 o 2 → no conectada o no existe
        resolve(error === null);
      });
    });
  }

  // Función auxiliar para obtener impresoras con trabajos activos
  static async getPrintingPrinters() {
    return new Promise((resolve) => {
      exec(
        'powershell -Command "Get-Printer | Where-Object { (Get-PrintJob -PrinterName $_.Name -ErrorAction SilentlyContinue) } | Select-Object -ExpandProperty Name"',
        (error, stdout) => {
          resolve(
            error
              ? []
              : stdout
                  .trim()
                  .split("\r\n")
                  .filter((name) => name)
          );
        }
      );
    });
  }

  static async checkPhysicalConnection(portName) {
    return new Promise((resolve) => {
      // Verificación mejorada para USB, red y puertos locales
      exec(
        `powershell -Command "$port = Get-PrinterPort -Name '${portName}' -ErrorAction SilentlyContinue; 
      if ($port -and $port.Description -match 'USB') { 
        $usbDevice = Get-PnpDevice -PresentOnly | Where-Object { $_.DeviceID -match $port.Name.Replace('COM','USB') };
        exit ($usbDevice ? 0 : 1)
      } 
      elseif ($port -and $port.Description -match 'TCP') {
        exit ((Test-NetConnection -ComputerName $port.PrinterHostAddress -Port $port.PortNumber).TcpTestSucceeded ? 0 : 1)
      }
      else {
        exit 0 # Asumir conectado para puertos locales (FILE, LPT, etc.)
      }"`,
        (error) => resolve(error === null)
      );
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
