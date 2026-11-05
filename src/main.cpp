#include <Arduino.h>
#include <Wire.h>
#include "Ssd1306Manager.h"
#include "Lsm303Manager.h"

// Instanciamos usando los nombres basados en hardware
Ssd1306Manager display(0x3C);
Lsm303Manager imu;

void setup() {
    Serial.begin(115200);

    // Inicialización centralizada del bus I2C compartido
    Wire.begin(21, 22);
    Wire.setClock(400000L);
    delay(100);

    display.begin();
    imu.begin();

    display.setLine(0, "--- BRUJULA ESP32 ---");
    display.update();
}

void loop() {
    imu.update();

    char buffer[25];

    snprintf(buffer, sizeof(buffer), "Raw : %.1f o", imu.getRaw());
    display.setLine(1, buffer);

    snprintf(buffer, sizeof(buffer), "Cal : %.1f o", imu.getCal());
    display.setLine(2, buffer);

    snprintf(buffer, sizeof(buffer), "Comp: %.1f o", imu.getComp());
    display.setLine(3, buffer);

    display.update();

    delay(150);
}