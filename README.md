
# Impresoras Piatto

**Impresoras Piatto** es una aplicación de escritorio multiplataforma desarrollada con [Electron](https://www.electronjs.org/) para facilitar la gestión de impresoras en sistemas POS. La aplicación permite la comunicación con impresoras térmicas tanto en **Windows** como en **macOS**, soportando conexiones **USB** y, en el futuro, **Wi-Fi/LAN**. 

## Características

- **Gestión de Impresoras**: Detección y comunicación con impresoras USB y, a futuro, Wi-Fi.
- **Soporte Multilenguaje**: Cambia entre diferentes idiomas directamente en la aplicación.
- **Compatible con ESC/POS**: Soporte para comandos ESC/POS y opciones de impresión en PDF.
- **Interfaz de Usuario en Bandeja del Sistema**: Disponible en segundo plano con acceso desde el área de notificaciones.
- **Herramientas de Configuración y Pruebas**: Realiza pruebas de impresión y verifica conectividad de las impresoras.

## Requisitos del Sistema

- **Node.js**: Versión 14 o superior.
- **Electron**: Instalado mediante `npm install electron`.
- **Sistemas Operativos**:
  - **Windows** 10 o superior.
  - **macOS** Mojave o superior.

## Instalación

### Clonar el Repositorio
```bash
git clone https://github.com/usuario/impresoras-piatto.git
cd impresoras-piatto
```


### Instalación de Dependencias
```bash
npm install
```

### Ejecutar la Aplicación en Desarrollo
```bash
npm start
```

### Construir la Aplicación para Producción
Para **Windows**:
```bash
npm run dist:win
```

Para **macOS**:
```bash
npm run dist:mac
```

## Uso

1. **Abrir la Aplicación**: Una vez iniciada, la aplicación se ejecuta en segundo plano y se muestra en la bandeja del sistema.
2. **Cambiar el Idioma**: Usa el menú desplegable en la esquina superior derecha para seleccionar el idioma de la interfaz.
3. **Configurar Impresoras**: Configura tus impresoras USB o Wi-Fi, seleccionando el tipo de conexión y realizando pruebas de impresión.
4. **Pruebas de Impresión**: Usa el botón “Probar” en la interfaz para verificar la conectividad de la impresora.

## Idiomas Soportados

- Español (es)
- Inglés (en)

## Tecnologías Utilizadas

- **Electron**: Para la creación de aplicaciones de escritorio multiplataforma.
- **Express** y **Axios**: Para gestionar la comunicación HTTP.
- **escpos-buffer** y **node-thermal-printer**: Para soportar comandos de impresión ESC/POS y controlar impresoras térmicas.
- **puppeteer**: Para generar impresiones en PDF.
- **WebSocket**: Para comunicación en tiempo real con las impresoras.

## Estructura del Proyecto

```plaintext
impresoras-piatto/
├── src/
│   ├── assets/               # Íconos y otros recursos visuales
│   ├── i18n/                 # Archivos JSON de traducción
│   ├── main.js               # Entrada principal de Electron
│   ├── preload.js            # Manejo de contexto de la ventana
│   ├── UIService.js          # Gestión de la interfaz en la bandeja
│   └── views/                # Vistas HTML de la interfaz
├── package.json
└── README.md
```
