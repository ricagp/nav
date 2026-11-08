#include <Arduino.h>
#include <Wire.h>
#include <SPI.h>
#include <SD.h>
#include "SensorTypes.h"
#include "Lsm303Manager.h"
#include "Ssd1306Manager.h"
#include "MicroSdManager.h"

// --- INSTANCIAS DE LOS MANAGERS ---
Lsm303Manager imu;
Ssd1306Manager oled;
MicroSdManager sd(5); // Pin CS de la MicroSD en el ESP32 (ajústalo a tu hardware si es diferente)

// --- CONTROL DE TIEMPOS E INTERVALOS ---
unsigned long lastRefreshTime = 0;
const unsigned long REFRESH_INTERVAL = 200; // Refresco de pantalla OLED cada 200ms

unsigned long lastLogTime = 0;
const unsigned long LOG_INTERVAL = 20;     // Registro en SD a 50 Hz (cada 20ms)

const char* logFileName = "/telemetria.bin";

void setup() {
    Serial.begin(115200);
    while (!Serial) { delay(10); }

    Serial.println(F("\n[SISTEMA] Arrancando central de telemetría ESP32..."));

    // 1. Inicializar Bus I2C a alta velocidad (400kHz)
    Wire.begin();
    Wire.setClock(400000);

    // 2. Inicializar Pantalla OLED y Sensor IMU
    oled.begin();
    imu.begin();

    // 3. Inicializar Tarjeta MicroSD y abrir archivo persistente único
    if (sd.begin()) {
        if (sd.openLog(logFileName)) {
            Serial.println(F("[SISTEMA] Archivo de log abierto en SD. Grabando cabecera de calibración..."));
            
            // Volcamos el paquete de calibración del acelerómetro al inicio del fichero binario
            sd.writePacket(imu.getCalibrationInt());
            sd.flush(); // Aseguramos que se guarde físicamente en la tarjeta
        } else {
            Serial.println(F("[ERROR SD] No se pudo abrir o crear el archivo de registro."));
        }
    } else {
        Serial.println(F("[ADVERTENCIA] Tarjeta SD no disponible. El sistema continuará sin registro."));
    }

    Serial.println(F("[SISTEMA] Setup completado. Entrando en bucle principal.\n"));
}

void loop() {
    unsigned long currentTime = millis();

    // -------------------------------------------------------------------------
    // 1. ADQUISICIÓN: Actualizamos el sensor (captura timestamp y lecturas físicas)
    // -------------------------------------------------------------------------
    imu.update();

    // -------------------------------------------------------------------------
    // 2. REGISTRO EN SD: Volcado binario a alta frecuencia (50 Hz / cada 20 ms)
    // -------------------------------------------------------------------------
    if (sd.isInitialized() && (currentTime - lastLogTime >= LOG_INTERVAL)) {
        lastLogTime = currentTime;

        // Obtenemos la estructura empaquetada cruda (incluye type y timestamp de 4 bytes)
        const Lsm303RawData& rawRecord = imu.getRawData();
        
        // Escritura binaria directa al archivo persistente abierto
        sd.writePacket(rawRecord);

        // Opcional: si quieres asegurar escrituras físicas periódicas ante un reinicio imprevisto
        // sd.flush();
    }

    // -------------------------------------------------------------------------
    // 3. PANTALLA OLED: Refresco a baja frecuencia para no saturar al usuario
    // -------------------------------------------------------------------------
    if (currentTime - lastRefreshTime >= REFRESH_INTERVAL) {
        lastRefreshTime = currentTime;

        // Obtenemos los estados procesados en float para visualización
        Lsm303FloatData rawState  = imu.getRawDataFloat();
        Lsm303FloatData compState = imu.getCompensatedDataFloat();

        // Buffers estáticos para formatear las líneas sin fragmentar la memoria heap
        char lineBuffer0[22];
        char lineBuffer1[22];
        char lineBuffer2[22];
        char lineBuffer3[22];

        snprintf(lineBuffer0, sizeof(lineBuffer0), "RAW Hdg: %.0f o", rawState.heading);
        snprintf(lineBuffer1, sizeof(lineBuffer1), "COM Hdg: %.0f o", compState.heading);
        snprintf(lineBuffer2, sizeof(lineBuffer2), "R/P: %.0f/%.0f", rawState.roll, rawState.pitch);
        snprintf(lineBuffer3, sizeof(lineBuffer3), "SD: %s", sd.isInitialized() ? "Grabando" : "Error/No SD");

        oled.setLine(0, lineBuffer0);
        oled.setLine(1, lineBuffer1);
        oled.setLine(2, lineBuffer2);
        oled.setLine(3, lineBuffer3);
    }

    // 4. Renderizado inteligente de la pantalla (el sistema anti-flicker solo repinta cambios)
    oled.update();
}