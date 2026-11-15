#include <Arduino.h>
#include "SensorTypes.h"
#include "MicroSdManager.h"
#include "Lsm303Manager.h"
#include "GpsManager.h"
#include "Ssd1306Manager.h"

// --- Instancias de los gestores del sistema ---
MicroSdManager sd(5);          // Pin CS de la Tarjeta SD (ajustar según tu hardware)
Lsm303Manager lsm303Manager;
GpsManager gpsManager;
Ssd1306Manager oled(0x3C);     // Pantalla OLED I2C (dirección 0x3C por defecto)

// --- Estructuras de datos para telemetría ---
GpsRmcPacket gpsPacket;

// --- Control de tiempos para actualización de pantalla (ej. cada 250 ms) ---
unsigned long lastDisplayMillis = 0;
const unsigned long DISPLAY_INTERVAL_MS = 250;

void setup() {
    // 1. Puerto serie para depuración por consola
    Serial.begin(115200);
    Wire.begin(); // O Wire.begin(SDA_PIN, SCL_PIN);
    delay(1000);
    Serial.println("\n--- INICIANDO SISTEMA DE TELEMETRÍA MARINA ESP32 ---");

    // 2. Inicializar la pantalla OLED e indicar arranque
    oled.begin();
    oled.setLine(0, "Iniciando sistema...");
    oled.setLine(1, "Espere por favor...");
    oled.update();

    // 3. Inicializar la Tarjeta SD y abrir el siguiente fichero de log automático
    if (!sd.begin()) {
        Serial.println("[ERROR] No se pudo inicializar la Tarjeta SD.");
    } else {
        if (sd.openNextLog("/telemetria")) {
            Serial.println("[SD] Fichero de registro preparado para escritura.");
        } else {
            Serial.println("[ERROR] No se pudo abrir el archivo de log en la SD.");
        }
    }

    // 4. Inicializar la IMU (LSM303) y guardar calibración inicial
    if (!lsm303Manager.begin()) {
        Serial.println("[ERROR] No se pudo detectar el sensor LSM303.");
    } else {
        Serial.println("[IMU] Sensor LSM303 inicializado y calibrado correctamente.");
        
        // Guardamos el paquete de calibración estática al principio del fichero binario
        sd.writePacket(lsm303Manager.getCalibrationInt());
        sd.flush();
    }

    // 5. Inicializar el GPS (Pines RX=16, TX=17, 9600 baudios)
    gpsManager.begin(16, 17, 9600);
    Serial.println("[GPS] GpsManager iniciado. Esperando cobertura de satélites...");

    oled.setLine(0, "Sistema Listo");
    oled.setLine(1, "Buscando GPS...");
    oled.update();

    Serial.println("--- SISTEMA LISTO Y EN BUCLE DE ADQUISICIÓN ---\n");
}

void loop() {
    unsigned long currentMillis = millis();

    // =========================================================================
    // A. ACTUALIZACIÓN CONTINUA DE LA IMU (Lectura interna en RAM)
    // =========================================================================
    lsm303Manager.update();

    // =========================================================================
    // B. LECTURA Y REGISTRO CONDICIONAL POR CADA FIX VÁLIDO DEL GPS
    // =========================================================================
    if (gpsManager.update(gpsPacket)) {
        // 1. Guardar el paquete de datos del GPS en la SD
        sd.writePacket(gpsPacket);

        // 2. Guardar los valores en crudo del compás y acelerómetro asociados a este instante
        sd.writePacket(lsm303Manager.getRawData());

        // 3. Forzar el vaciado del búfer de la SD para asegurar persistencia
        sd.flush();

        // 4. Mensaje de control en consola serie
        Serial.printf("[LOG] GPS Válido | Hora: %u | Lat: %d | Lon: %d | Vel: %.1f | Rumbo: %.1f\n", 
                    gpsPacket.gpsTime, 
                    gpsPacket.lat, 
                    gpsPacket.lon, 
                    gpsPacket.speed / 10.0f, 
                    gpsPacket.course / 10.0f);
    }

    // =========================================================================
    // C. ACTUALIZACIÓN DE LA PANTALLA OLED (Tasa de refresco controlada)
    // =========================================================================
    if (currentMillis - lastDisplayMillis >= DISPLAY_INTERVAL_MS) {
        lastDisplayMillis = currentMillis;

        char buf[22];
        const Lsm303RawData& raw = lsm303Manager.getRawData();
        Lsm303FloatData floatData = lsm303Manager.getRawDataFloat();

        // Línea 0: Posición GPS (Lat / Lon resumidas) o aviso de sin cobertura
        if (gpsPacket.valid == 1) {
            float latDeg = (float)gpsPacket.lat / 10000000.0f;
            float lonDeg = (float)gpsPacket.lon / 10000000.0f;
            snprintf(buf, sizeof(buf), "Lat:%.3f Lon:%.3f", latDeg, lonDeg);
        } else {
            snprintf(buf, sizeof(buf), "GPS: Sin Fix (Void)");
        }
        oled.setLine(0, buf);

        // Línea 1: Rumbo y velocidad del GPS
        float gpsHeading = (float)gpsPacket.course / 10.0f;
        float gpsSpeed = (float)gpsPacket.speed / 10.0f;
        snprintf(buf, sizeof(buf), "Rumbo:%.1f Vel:%.1f", gpsHeading, gpsSpeed);
        oled.setLine(1, buf);

        // Línea 2: Rumbo sin compensar y rumbo compensado (en grados)
        float uncompHeading = lsm303Manager.getRawDataFloat().heading;
        float compHeading = lsm303Manager.getCompensatedDataFloat().heading;
        snprintf(buf, sizeof(buf), "Unc:%.1f Comp:%.1f", uncompHeading, compHeading);
        oled.setLine(2, buf);

        // Línea 3: Alabeo (Roll) y Cabeceo (Pitch)
        snprintf(buf, sizeof(buf), "Roll:%.1f P:%.1f", floatData.roll, floatData.pitch);
        oled.setLine(3, buf);

        // Refrescar pantalla mediante la actualización inteligente (anti-parpadeo)
        oled.update();
    }
}