#include <Arduino.h>
#include <Wire.h>
#include "SensorTypes.h"
#include "Lsm303Manager.h"
#include "Ssd1306Manager.h"

Lsm303Manager imu;
Ssd1306Manager oled;

unsigned long lastRefreshTime = 0;
const unsigned long REFRESH_INTERVAL = 200; // Refresco cada 200ms

void setup() {
    Serial.begin(115200);
    Wire.begin();
    Wire.setClock(400000);

    oled.begin();
    imu.begin();
}

void loop() {
    // 1. Actualizamos el sensor
    imu.update();

    // 2. Control de tiempos para el refresco de pantalla
    unsigned long currentTime = millis();
    if (currentTime - lastRefreshTime >= REFRESH_INTERVAL) {
        lastRefreshTime = currentTime;

        // Obtenemos los estados de la IMU
        Lsm303FloatData rawState  = imu.getRawDataFloat();
        Lsm303FloatData calState  = imu.getCalibratedDataFloat();
        Lsm303FloatData compState = imu.getCompensatedDataFloat();

        // Preparamos los textos para las 4 líneas de la pantalla
        char lineBuffer0[22];
        char lineBuffer1[22];
        char lineBuffer2[22];
        char lineBuffer3[22];

        // Línea 0: Heading crudo
        snprintf(lineBuffer0, sizeof(lineBuffer0), "RAW Hdg: %.0f o", rawState.heading);
        
        // Línea 1: Heading compensado (el bueno de navegación)
        snprintf(lineBuffer1, sizeof(lineBuffer1), "COM Hdg: %.0f o", compState.heading);
        
        // Línea 2: Roll y Pitch en crudo
        snprintf(lineBuffer2, sizeof(lineBuffer2), "R/P Raw: %.0f/%.0f", rawState.roll, rawState.pitch);
        
        // Línea 3: Roll y Pitch calibrados
        snprintf(lineBuffer3, sizeof(lineBuffer3), "R/P Cal: %.0f/%.0f", calState.roll, calState.pitch);

        // Inyectamos las líneas al manager de la pantalla
        oled.setLine(0, lineBuffer0);
        oled.setLine(1, lineBuffer1);
        oled.setLine(2, lineBuffer2);
        oled.setLine(3, lineBuffer3);
    }

    // 3. Ejecutamos el update de la pantalla (el sistema anti-flicker solo repinta si cambia el texto)
    oled.update();
}