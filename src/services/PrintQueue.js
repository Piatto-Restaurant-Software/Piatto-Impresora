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

    console.log(`Trabajo agregado a la cola. Prioridad: ${priority}`);
    console.log(`Estado actual de la cola:`, this.queue.map((item) => item.priority));

    this.processQueue();
  }

  /**
   * Procesa la cola de manera secuencial
   */
  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      console.log("Cola vacía o ya en proceso.");
      return;
    }

    this.isProcessing = true;

    const { job, priority } = this.queue.shift(); // Toma el primer trabajo de la cola
    console.log(`Procesando trabajo con prioridad: ${priority}`);
    console.log(`Estado actual de la cola:`, this.queue.map((item) => item.priority));

    try {
      await job();
      console.log(`Trabajo con prioridad ${priority} completado.`);
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
