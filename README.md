
# nav

## Entorno

.venv\Scripts\activate.bat
pip install Jinja2    
cd pc
python telemetria.py telemetria_17.bin


# Hardware

* ESP32: NodeMCU Development Board de 30 pines (basada en el módulo ESP-WROOM-32 y serigrafiada como HW-394). PlatformIO: Espressif ESP32 Dev Module (ID técnico: esp32dev)
* Display: Display OLED de 0.96 pulgadas con interfaz I2C y una resolución de 128x64 píxeles. El controlador estándar que suelen llevar estos módulos, funciona perfectamente con el chip SSD1306
* Compas: GY-51 LSM303
* Tarjeta SD: Micro SD Card Module

# Conexiones

- GND: ESP32, 

## 26oct26

1. Prueba de salida por puerto serie


## 5Nov26

1. Paso desde Ubuntu a Windows10

# Pruebas y datos

* telemetria_17.bin: Isha, salida del domingo 15
* telemetria_20.bin: prueba duración batería: 18:39 a 04:29 (9h 50m), con pantalla y wifi activas


# 15Nov


## 

## SensorTypes.h (Definiciones y Estructuras de Datos)

Define el modelo de datos y las estructuras empaquetadas binarias del sistema (garantizando alineación de 1 byte mediante directivas de empaquetamiento) para estandarizar el almacenamiento en tarjeta SD y la transmisión de los paquetes de telemetría de la IMU, el magnetómetro y el GPS.

* enum PacketType : uint8_t: Enumeración que agrupa los identificadores o etiquetas de tipo de paquete (TYPE_CALIBRATION_ACCEL, TYPE_CALIBRATION_MAG, TYPE_IMU_RAW, TYPE_GPS_RMC) para la deserialización y control de flujo binario.
* struct Lsm303AccelCalibration: Estructura empaquetada que almacena la metainformación y los acumuladores de las muestras estáticas para la calibración del acelerómetro.
* struct Lsm303MagCalibration: Estructura empaquetada para la calibración por extremos (Hard Iron Min/Max) de los tres ejes del magnetómetro.
* struct Lsm303RawData: Estructura empaquetada que registra la marca de tiempo junto con los valores axiales crudos en tiempo real de la IMU (acelerómetro y magnetómetro).
* struct GpsRmcPacket: Estructura empaquetada que consolida los datos de navegación extraídos de las tramas NMEA del GPS (coordenadas escaladas por $10^7$, hora UTC, fecha, velocidad, rumbo y estado de validez del fix).
* struct Lsm303FloatData: Estructura auxiliar no empaquetada utilizada exclusivamente en la memoria RAM para albergar vectores en coma flotante y los ángulos de orientación espacial calculados (roll, pitch, heading).


## IUpdatable.h (Clase IUpdatable)

Define una interfaz base abstracta que estandariza el ciclo de vida de los componentes del sistema, obligando a las clases derivadas a implementar rutinas de inicialización y actualización continua bajo un diseño polimorfo seguro.

* virtual ~IUpdatable() = default;: Destructor virtual que garantiza la correcta liberación de memoria en objetos derivados destruidos mediante punteros a la interfaz.
* virtual void begin() = 0;: Método virtual puro encargado de la inicialización y configuración inicial del componente.
* virtual void update() = 0;: Método virtual puro que ejecuta la lógica o el refresco periódico del componente en cada ciclo del programa.

## GpsManager.h (Clase GpsManager)

Gestiona la comunicación serie con el módulo GPS, configurándolo para optimizar las tramas NMEA y procesando en tiempo real las sentencias RMC ($GPRMC o $GNRMC) para extraer y empaquetar de forma precisa las coordenadas geográficas, la hora UTC, la velocidad y el rumbo de navegación.

* GpsManager(): Constructor por defecto que inicializa los pines de comunicación serial (RX/TX), la velocidad en baudios y limpia el búfer interno de lectura.
* void begin(int rxPin = 16, int txPin = 17, unsigned long baudRate = 9600);: Inicializa el puerto Serie 2 del microcontrolador y envía el comando de configuración NMEA (PMTK314) para aislar exclusivamente las tramas de navegación RMC.
* bool update(GpsRmcPacket &packet);: Lee de forma continua los caracteres disponibles en el puerto serie, ensambla la línea NMEA, la valida y, si es correcta, deserializa la información actualizando el paquete de datos del GPS.
* int32_t convertCoordToFixed(double coord, char dir);: Convierte el formato de coordenadas nativo NMEA (grados y minutos) a un valor entero escalado por un factor de $10^7$ aplicando la polaridad cardinal correspondiente.
* bool parseRMC(char* line, GpsRmcPacket &packet);: Analiza mediante des टोकens una línea RMC completa, verifica el estado de cobertura del fix y calcula los parámetros temporales, cinemáticos y de posición para rellenar la estructura binaria.


## Lsm303Manager.h (Clase Lsm303Manager)

Administra la comunicación I2C con el sensor LSM303 (acelerómetro y magnetómetro), ejecutando rutinas automáticas de calibración estática y cálculo vectorial en coma flotante para estimar la orientación espacial, el ángulo de inclinación y el rumbo magnético compensado.

* bool readAccelRaw(int16_t &ax, int16_t &ay, int16_t &az);: Lee directamente los registros de aceleración crudos del bus I2C y aplica el desplazamiento de bits necesario según la resolución del dispositivo.
* bool readMagRaw(int16_t &mx, int16_t &my, int16_t &mz);: Obtiene los valores sin procesar del campo magnético triaxial desde las direcciones de memoria del magnetómetro.
* float calculateHeading(float x, float y) const;: Calcula el ángulo de rumbo en grados (0 a 360) a partir de los ejes magnéticos normalizados mediante la función arcotangente.
* void begin() override;: Inicializa los registros de configuración del acelerómetro y magnetómetro por I2C, realiza el muestreo estático inicial y calcula los factores de calibración de sesgo.
* void update() override;: Actualiza la marca de tiempo y refresca de forma continua los datos crudos de aceleración y campo magnético en cada ciclo.
* const Lsm303RawData& getRawData() const;: Retorna una referencia constante a la estructura con los últimos datos binarios crudos capturados por la IMU.
* const Lsm303AccelCalibration& getCalibrationInt() const;: Devuelve la estructura interna de calibración entera con los acumuladores y metadatos de las muestras.
* const Lsm303FloatData& getCalibrationFloat() const;: Proporciona los valores promediados de compensación expresados en formato de coma flotante.
* Lsm303FloatData getRawDataFloat() const;: Transforma los datos brutos a unidades flotantes y calcula de manera preliminar los ángulos de balanceo, cabeceo y rumbo.
* Lsm303FloatData getCalibratedDataFloat() const;: Aplica los factores de corrección de calibración sobre los vectores flotantes y recalcula la orientación geométrica básica.
* Lsm303FloatData getCompensatedDataFloat() const;: Realiza la compensación de inclinación completa utilizando los ángulos de alabeo y cabeceo para corregir el rumbo magnético ante superficies no niveladas.

## Ssd1306Manager.h (Clase Ssd1306Manager)

Controla la visualización de información en pantallas OLED basadas en el controlador SSD1306 mediante I2C, implementando un búfer de texto por líneas con actualización inteligente condicional para evitar el parpadeo visual en pantalla.

* Ssd1306Manager(uint8_t addr = 0x3C);: Constructor de la clase que asigna la dirección I2C del dispositivo OLED (por defecto 0x3C).
* void begin() override;: Inicializa la pantalla OLED utilizando la configuración por defecto de Adafruit de 128x64 píxeles, establece la fuente tipográfica y limpia los búferes internos.
* void clear();: Restablece el búfer de texto lógico vaciando todas las líneas de almacenamiento temporal.
* void setLine(uint8_t row, const char* text);: Almacena de forma segura una cadena de texto en la fila especificada (de 0 a 3) utilizando formateo seguro.
* void update() override;: Compara las líneas actuales con las mostradas previamente y actualiza únicamente la pantalla en aquellas filas donde el texto haya cambiado, limpiando los caracteres antiguos con espacios.

## MicroSdManager.h (Clase MicroSdManager)

Gestiona la comunicación SPI y el almacenamiento persistente en tarjetas MicroSD, automatizando la inicialización del hardware, la numeración secuencial de ficheros de registro y la escritura genérica eficiente de bloques binarios.

*  MicroSdManager(uint8_t csPin);: Constructor de la clase que recibe y configura el pin de selección de chip (CS) para la interfaz SPI.
*  bool begin();: Inicializa la conexión con la tarjeta SD a través de la librería estándar, comprobando la presencia física del medio de almacenamiento.
*  bool openNextLog(const char* prefix = "/telemetria");: Busca de forma automática el siguiente nombre de archivo disponible utilizando un índice numérico consecutivo e inicia un nuevo fichero de registro en modo de escritura (FILE_WRITE).
*  bool isReady() const;: Verifica de forma rápida si la tarjeta SD se encuentra inicializada y el archivo de log está abierto y operativo.
*  size_t writePacket(const T& packet);: Método de plantilla genérico que escribe de forma directa cualquier estructura de datos binaria directamente en el fichero de log abierto.
*  void flush();: Fuerza el vaciado físico del búfer de escritura de la tarjeta para asegurar la persistencia inmediata de los datos almacenados.
*  void close();: Cierra de manera segura el archivo de registro activo notificando el estado por el puerto serie.
*  ~MicroSdManager();: Destructor de la clase que invoca automáticamente el cierre del archivo activo para evitar fugas de recursos o corrupción de datos.

## WebServerManager.h / WebServerManager.cpp (Clase WebServerManager)

Gestiona el punto de acceso Wi-Fi del sistema, el sistema de ficheros interno (LittleFS para cargar la configuración desde config.ini y servir la interfaz estática desde index.html), un servidor HTTP integrado en el puerto 80 y un servidor de WebSockets en el puerto 81 para la transmisión de telemetría en tiempo real a los clientes conectados.

* WebServerManager(): Constructor por defecto que inicializa el servidor web en el puerto 80, el servicio de WebSockets en el puerto 81, la potencia de transmisión de radio por defecto ($78$) y establece los valores iniciales por defecto para el SSID (ISHA_Boat_AP) y la contraseña.
* bool begin() override;: Monta el sistema de ficheros LittleFS, carga la configuración de red y credenciales desde el archivo /config.ini, configura el microcontrolador en modo de Punto de Acceso (AP) aplicando los parámetros de red e inicia de forma simultánea el servidor HTTP y el de WebSockets.
* void update() override;: Atiende de forma periódica las peticiones de los clientes HTTP entrantes (server.handleClient()) y mantiene operativo el bucle de eventos de los WebSockets (webSocket.loop()).
* void stop();: Detiene el servidor web, apaga la interfaz Wi-Fi para ahorro de energía y desmonta el sistema de ficheros LittleFS de manera segura.
* void broadcast(const char* payload);: Transmite de forma masiva (broadcast) una cadena de texto o paquete de datos a todos los clientes conectados a través del canal de WebSockets.bool 
* loadConfiguration();: Analiza e interpreta el archivo de configuración estructurado en formato INI ubicado en la memoria flash (/config.ini), extrayendo parámetros de red como el SSID, la contraseña, la potencia de transmisión (tx_power), la dirección IP local, la puerta de enlace (gateway) y la máscara de subred (subnet).
* void setupWebServer();: Configura las rutas del servidor HTTP (como la ruta raíz /), encargándose de buscar y transmitir de manera eficiente el archivo index.html alojado en LittleFS o emitir un error 404 en caso de ausencia.
* static void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length);: Gestiona los eventos de conexión, desconexión y recepción de tramas de los clientes a través del canal bidireccional de WebSockets.
* void trim(char* str);: Función auxiliar de limpieza encargada de eliminar espacios en blanco, tabulaciones y saltos de carro sobrantes en el procesamiento e interpretación de líneas de texto del archivo de configuración.


## telemetria.py (Analizador y Exportador de Telemetría Marina)

Script de procesamiento en Python estructurado bajo una arquitectura modular y de plantillas (mediante Jinja2), diseñado para deserializar los paquetes binarios de almacenamiento persistente (.bin), corregir trayectorias, calcular variables cinemáticas y náuticas avanzadas, y generar de forma automatizada informes de consola, archivos de intercambio (.csv, .kml) y mapas web interactivos autocontenidos.

* haversine_distance(lat1, lon1, lat2, lon2): Calcula la distancia en línea recta sobre la superficie terrestre entre dos puntos geográficos asumiendo un modelo esférico (radio medio de $6371\text{ m}$).
* process_bearings(bearings): Resuelve los saltos angulares en los cruces del norte magnético ($0^\circ/360^\circ$) aplicando un algoritmo de desenvolutura (unwrapping) y una media circular basada en trigonometría vectorial (senos y cosenos) para obtener rumbos mínimos, máximos y medios estables.
* generate_interactive_html(html_filename, base_filename, blocks_data): Carga la plantilla de diseño externa map_template.html mediante Jinja2 para generar de forma automatizada un mapa web interactivo en la subcarpeta ghp/ basado en Leaflet.js, integrando capas base de Esri, balizamiento náutico de OpenSeaMap, rutas codificadas por color según rangos de velocidad y marcadores de posición interactivos con rumbos orientados.
* analyze_and_export_telemetry(base_filename): Función principal de orquestación que gestiona la creación automática de subcarpetas del proyecto (telemetria/, resultados/, ghp/, templates/), lee y deserializa byte a byte el flujo binario según las etiquetas de paquete (0x01, 0x02, 0x03, 0x04), filtra datos anómalos y procesa bloques de navegación.
* templates/map_template.html: Plantilla HTML/JS para la representación visual interactiva de la ruta y los metadatos de los tramos de navegación.
* templates/kml_template.xml: Plantilla XML para la exportación de puntos de interés y metadatos estructurados compatibles con Google Earth en la carpeta de resultados.
* templates/report_template.txt: Plantilla de texto plano con formato de tipo printf para la emisión estructurada del resumen ejecutivo de la sesión por la consola de comandos.

# UI

chrome://flags/#unsafely-treat-insecure-origin-as-secure
http://192.168.4.1
Habilitar y reiniciar

+--------------------------+-------------------------------------------------------------+
| [ MENÚ TÁCTICO ]         | [ PANTALLA ACTIVA: Navegación Libre ]                       |
|                          |                                                             |
| > 1. Navegación libre    | +-----------------------------+-----------------------------+
|   2. Salida (Pre-Start)  | | 2) SOG                      | 2) VMG                      |
|   3. VMG & Rendimiento   | |    6.4 nudos                |    5.2 nudos                |
|   4. Waypoints / Balizas | +-----------------------------+-----------------------------+
|   5. Mapa y Laylines     | | 3) Lat                      | 3) Long                     |
|                          | |    36° 43.245' N            |    004° 24.112' W           |
|                          | +-----------------------------+-----------------------------+
|                          | | 4) COG                      | 4) Compass                  |
|                          | |    215°                     |    212° (MAG)               |
|                          | +-----------------------------+-----------------------------+
|                          | | 5) Marcación                | 5) Delta                    |
|                          | |    045°                     |    -2° / min                |
|                          | +-----------------------------+-----------------------------+
|                          | | 6) Roll                     | 6) Pitch                    |
|                          | |    +14.2° (Babor)           |    -1.5°                    |
|                          | +-----------------------------+-----------------------------+
+--------------------------+-------------------------------------------------------------+

+--------------------------+-------------------------------------------------------------+
| [ MENÚ TÁCTICO ]         | [ PANTALLA ACTIVA: Navegación Libre ]                       |
|                          |                                                             |
| > 1. Navegación libre    | +-----------------------------+-----------------------------+
|   2. Salida (Pre-Start)  | | 2) SOG                      | 2) VMG                      |
|   3. VMG & Rendimiento   | |    6.4 nudos                |    5.2 nudos                |
|   4. Waypoints / Balizas | +-----------------------------+-----------------------------+
|   5. Mapa y Laylines     | | 3) Lat                      | 3) Long                     |
|                          | |    36° 43.245' N            |    004° 24.112' W           |
|                          | +-----------------------------+-----------------------------+
|                          | | 4) Cog     Brg (Marcación Fijada)   | 4) Delta (COG vs Brg)       |
|                          | |    ---° (Absoluta)          |    ----                     |
|                          | +-----------------------------+-----------------------------+
|                          | | 5) Compass (Móvil)          | 5) Acción                   |
|                          | |    ---° MAG                 |    [ Fija Marcación ]       |
|                          | +-----------------------------+-----------------------------+
|                          | | 6) Roll                     | 6) Pitch                    |
|                          | |    +14.2° (Babor)           |    -1.5°                    |
|                          | +-----------------------------+-----------------------------+
+--------------------------+-------------------------------------------------------------+

+--------------------------+-------------------------------------------------------------+
| [ TACTICAL MENU ]        | [ ACTIVE SCREEN: Free Navigation ]                          |
|                          |                                                             |
| > 1. Free Navigation     | +-----------------------------+-----------------------------+
|   2. Pre-Start Line      | | 2) SOG (Speed)              | 2) VMG (Effective)          |
|   3. VMG & Performance   | |    6.4 knots                |    5.2 knots                |
|   4. Waypoints / Marks   | +-----------------------------+-----------------------------+
|   5. Map & Laylines      | | 3) GPS Latitude             | 3) GPS Longitude            |
|                          | |    36° 43.245' N            |    004° 24.112' W           |
|  [ ☀️ Day Mode ]         | +-----------------------------+-----------------------------+
|  [ 🌙 Night Mode ]       | | 4) COG (GPS Course)         | 4) Brg (Locked & Delta)     |
|  [ 💻 Dark Mode ]        | |    215.0° Abs               |    045° (-3°)               |
|                          | +-----------------------------+-----------------------------+
|                          | | 5) Mobile Compass (Alidade) | 5) Action                   |
|                          | |    212° MAG                 |    [ Lock Bearing ]         |
|                          | +-----------------------------+-----------------------------+
|                          | | 6) Roll (Heel)              | 6) Pitch (Trim)             |
|                          | |    -5.4° (Stbd) [Fondo 🟩]  |    -1.5° (Bow Down)         |
|                          | +-----------------------------+-----------------------------+
+--------------------------+-------------------------------------------------------------+