#ifndef LSM303_MANAGER_H
#define LSM303_MANAGER_H

#include "IUpdatable.h"
#include <Arduino.h>
#include <Wire.h>
#include <math.h>

class Lsm303Manager : public IUpdatable {
private:
    const uint8_t ACCEL_ADDR = 0x18;
    const uint8_t MAG_ADDR   = 0x1E;

    float accel_offset_x = 0;
    float accel_offset_y = 0;
    float accel_offset_z = 0;

    float mag_offset_x = 0;
    float mag_offset_y = 0;

    float heading_raw = 0;
    float heading_cal = 0;
    float heading_comp = 0;

public:
    void begin() override {
        // 1. Configurar registros del LSM303DLHC
        Wire.beginTransmission(ACCEL_ADDR); Wire.write(0x20); Wire.write(0x27); Wire.endTransmission();
        Wire.beginTransmission(MAG_ADDR);   Wire.write(0x02); Wire.write(0x00); Wire.endTransmission();
        delay(500);

        // 2. Calibración estática rápida del acelerómetro
        int32_t suma_ax = 0, suma_ay = 0, suma_az = 0;
        for (int i = 0; i < 20; i++) {
            Wire.beginTransmission(ACCEL_ADDR); Wire.write(0x28 | 0x80); Wire.endTransmission();
            Wire.requestFrom((uint8_t)ACCEL_ADDR, (uint8_t)6);
            if (Wire.available() >= 6) {
                uint8_t xL = Wire.read(), xH = Wire.read();
                uint8_t yL = Wire.read(), yH = Wire.read();
                uint8_t zL = Wire.read(), zH = Wire.read();
                suma_ax += ((int16_t)(((uint16_t)xH << 8) | xL)) >> 4;
                suma_ay += ((int16_t)(((uint16_t)yH << 8) | yL)) >> 4;
                suma_az += ((int16_t)(((uint16_t)zH << 8) | zL)) >> 4;
            }
            delay(10);
        }
        accel_offset_x = (float)suma_ax / 20.0;
        accel_offset_y = (float)suma_ay / 20.0;
        accel_offset_z = ((float)suma_az / 20.0) - 1000.0;
    }

    void update() override {
        // --- Leer Acelerómetro ---
        Wire.beginTransmission(ACCEL_ADDR); Wire.write(0x28 | 0x80); Wire.endTransmission();
        Wire.requestFrom((uint8_t)ACCEL_ADDR, (uint8_t)6);
        float ax = 0, ay = 0, az = 0;
        if (Wire.available() >= 6) {
            uint8_t xL = Wire.read(), xH = Wire.read();
            uint8_t yL = Wire.read(), yH = Wire.read();
            uint8_t zL = Wire.read(), zH = Wire.read();
            ax = (float)(((int16_t)(((uint16_t)xH << 8) | xL)) >> 4) - accel_offset_x;
            ay = (float)(((int16_t)(((uint16_t)yH << 8) | yL)) >> 4) - accel_offset_y;
            az = (float)(((int16_t)(((uint16_t)zH << 8) | zL)) >> 4) - accel_offset_z;
        }

        // --- Leer Magnetómetro ---
        Wire.beginTransmission(MAG_ADDR); Wire.write(0x03); Wire.endTransmission();
        Wire.requestFrom((uint8_t)MAG_ADDR, (uint8_t)6);
        float mx = 0, my = 0, mz = 0;
        if (Wire.available() >= 6) {
            uint8_t xH = Wire.read(), xL = Wire.read();
            uint8_t zH = Wire.read(), zL = Wire.read();
            uint8_t yH = Wire.read(), yL = Wire.read();
            mx = -(float)((int16_t)(((uint16_t)xH << 8) | xL));
            mz =  (float)((int16_t)(((uint16_t)zH << 8) | zL));
            my =  (float)((int16_t)(((uint16_t)yH << 8) | yL));
        }

        // 1. Rumbo Sin Calibrar
        heading_raw = atan2(my, mx) * (180.0 / PI);
        if (heading_raw < 0) heading_raw += 360.0;

        // Offsets Hard-Iron 2D
        float mx_cal = mx - mag_offset_x;
        float my_cal = my - mag_offset_y;

        // 2. Rumbo Calibrado
        heading_cal = atan2(my_cal, mx_cal) * (180.0 / PI);
        if (heading_cal < 0) heading_cal += 360.0;

        // 3. Rumbo con Compensación de Inclinación
        float roll  = atan2(ay, az) * (180.0 / PI);
        float pitch = atan2(-ax, sqrt(ay * ay + az * az)) * (180.0 / PI);
        float roll_rad  = roll * (PI / 180.0);
        float pitch_rad = pitch * (PI / 180.0);

        float cosPitch = cos(pitch_rad);
        float sinPitch = sin(pitch_rad);
        float cosRoll  = cos(roll_rad);
        float sinRoll  = sin(roll_rad);

        float Xh = mx_cal * cosPitch + mz * sinPitch;
        float Yh = mx_cal * sinRoll * sinPitch - my_cal * cosRoll + mz * cosPitch * sinRoll;

        heading_comp = atan2(Yh, Xh) * (180.0 / PI);
        if (heading_comp < 0) heading_comp += 360.0;
    }

    // Getters limpios para extraer los datos
    float getRaw() const { return heading_raw; }
    float getCal() const { return heading_cal; }
    float getComp() const { return heading_comp; }
};

#endif