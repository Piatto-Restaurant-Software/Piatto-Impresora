class PrintQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
  }

  /**
   * Agrega un trabajo a la cola según su prioridad
   * @param {Function} job - Función que realiza el trabajo de impresión
   * @param {string} priority - Prioridad del trabajo (Comanda, Ticket, Precuenta, Cierre)
   */
  addJob(job, priority) {
    const priorityMap = {
      Comanda: 1,
      Ticket: 2,
      Precuenta: 3,
      Cierre: 4,
    };

    this.queue.push({ job, priority: priorityMap[priority] || 5 });

    // Ordenar la cola por prioridad
    this.queue.sort((a, b) => a.priority - b.priority);

    this.processQueue();
  }

  /**
   * Procesa la cola de manera secuencial
   */
  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    const { job, priority } = this.queue.shift(); // Toma el primer trabajo de la cola

    try {
      await job();
    } catch (error) {
      console.error("Error al procesar el trabajo de impresión:", error);
    }

    // Espera 2 segundos antes de procesar el siguiente trabajo
    setTimeout(() => {
      this.isProcessing = false;
      this.processQueue(); // Procesa el siguiente trabajo
    }, 2000);
  }
}

module.exports = new PrintQueue();
