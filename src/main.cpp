#include <Arduino.h>
#include "SensorTypes.h"
#include "MicroSdManager.h"
#include "Lsm303Manager.h"
#include "GpsManager.h"
#include "Ssd1306Manager.h"
#include "WebServerManager.h"

// --- Constante de refresco simbólica (configurable desde platformio.ini con build_flags) ---
#ifndef DISPLAY_INTERVAL_MS
#define DISPLAY_INTERVAL_MS 250
#endif
const unsigned long REFRESH_INTERVAL_MS = DISPLAY_INTERVAL_MS;

// --- Instancias de los gestores del sistema ---
MicroSdManager sd(5);              // Pin CS de la Tarjeta SD
Lsm303Manager lsm303Manager;
GpsManager gpsManager;
Ssd1306Manager oled(0x3C);         // Pantalla OLED I2C (dirección 0x3C por defecto)
WebServerManager webServerManager; // Gestor de red Wi-Fi, LittleFS y WebSockets

// --- Estructuras de datos para telemetría ---
GpsRmcPacket gpsPacket;

// --- Control de tiempos ---
unsigned long lastDisplayMillis = 0;

void setup() {
    // 1. Puerto serie para depuración por consola
    Serial.begin(115200);
    Wire.begin(); // Inicializar bus I2C
    delay(1000);
    Serial.println("\n--- INICIANDO SISTEMA DE TELEMETRÍA MARINA ESP32 ---");

    // 2. Inicializar la pantalla OLED e indicar arranque
    oled.begin();
    oled.setLine(0, "Iniciando sistema...");
    oled.setLine(1, "Espere por favor...");
    oled.update();

    // 3. Inicializar la Tarjeta SD y abrir el siguiente fichero de log automático
    if (!sd.begin()) {
        Serial.println("[SD] Error: No se pudo inicializar la tarjeta SD (Comprobar inserción).");
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
        
        // Guardamos el paquete de calibración estática al principio del fichero binario (si la SD está activa)
        sd.writePacket(lsm303Manager.getCalibrationInt());
        sd.flush();
    }

    // 5. Inicializar el servidor web, LittleFS y red Wi-Fi (lee config.ini)
    if (!webServerManager.begin()) {
        Serial.println("[ERROR] Fallo al iniciar WebServerManager / LittleFS.");
    }

    // 6. Inicializar el GPS (Pines RX=16, TX=17, 9600 baudios)
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
    // A. ACTUALIZACIÓN DE RED Y WEBSOCKETS (Atención fluida a clientes web)
    // =========================================================================
    webServerManager.update();

    // =========================================================================
    // B. ACTUALIZACIÓN CONTINUA DE LA IMU (Lectura interna en RAM)
    // =========================================================================
    lsm303Manager.update();

    // =========================================================================
    // C. LECTURA Y REGISTRO CONDICIONAL POR CADA FIX VÁLIDO DEL GPS
    // =========================================================================
    if (gpsManager.update(gpsPacket)) {
        // Guardar datos en la tarjeta SD
        sd.writePacket(gpsPacket);
        sd.writePacket(lsm303Manager.getRawData());
        sd.flush();

        Serial.printf("[LOG] GPS Trama recibida | Hora: %u | Estado: %c\n", 
                    gpsPacket.gpsTime, gpsPacket.valid ? 'A' : 'V');
    }

    // =========================================================================
    // D. ACTUALIZACIÓN UNIFICADA (OLED + WEBSOCKET cada REFRESH_INTERVAL_MS)
    // =========================================================================
    if (currentMillis - lastDisplayMillis >= REFRESH_INTERVAL_MS) {
        lastDisplayMillis = currentMillis;

        // 1. Obtener datos flotantes actuales de la IMU
        Lsm303FloatData floatData = lsm303Manager.getRawDataFloat();

        // 2. Transmitir por WebSocket al móvil (JSON plano adaptado al nuevo sistema táctico)
        char jsonBuffer[256];
        snprintf(jsonBuffer, sizeof(jsonBuffer),
            "{\"spd\":%.1f,\"vmg\":%.1f,\"cog\":%.1f,\"lat\":%.7f,\"lon\":%.7f,\"roll\":%.1f,\"pitch\":%.1f}",
            gpsPacket.speed / 10.0f,          // SOG en nudos
            0.0f,                             // VMG (Sustituir por variable real de VMG si se calcula en firmware)
            gpsPacket.course / 10.0f,         // COG del GPS
            gpsPacket.lat / 10000000.0,       // Latitud
            gpsPacket.lon / 10000000.0,       // Longitud
            floatData.roll,                   // Escora (Roll / Heel)
            floatData.pitch                   // Asiento (Pitch / Trim)
        );
        webServerManager.broadcast(jsonBuffer);

        // 3. Actualizar la pantalla OLED de forma sincronizada (mantiene tu lógica actual)
        char buf[22];
        if (gpsPacket.valid == 1) {
            float latDeg = (float)gpsPacket.lat / 10000000.0f;
            float lonDeg = (float)gpsPacket.lon / 10000000.0f;
            snprintf(buf, sizeof(buf), "Lat:%.3f Lon:%.3f", latDeg, lonDeg);
        } else {
            snprintf(buf, sizeof(buf), "GPS: Buscando Fix...");
        }
        oled.setLine(0, buf);

        float gpsHeading = (float)gpsPacket.course / 10.0f;
        float gpsSpeed = (float)gpsPacket.speed / 10.0f;
        snprintf(buf, sizeof(buf), "Rumbo:%.1f Vel:%.1f", gpsHeading, gpsSpeed);
        oled.setLine(1, buf);

        float uncompHeading = lsm303Manager.getRawDataFloat().heading;
        float compHeading = lsm303Manager.getCompensatedDataFloat().heading;
        snprintf(buf, sizeof(buf), "Unc:%.1f Comp:%.1f", uncompHeading, compHeading);
        oled.setLine(2, buf);

        snprintf(buf, sizeof(buf), "Roll:%.1f P:%.1f", floatData.roll, floatData.pitch);
        oled.setLine(3, buf);

        // Refrescar pantalla mediante la actualización inteligente (anti-parpadeo)
        oled.update();
    }
}