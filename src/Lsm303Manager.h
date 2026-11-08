#ifndef LSM303_MANAGER_H
#define LSM303_MANAGER_H

#include "IUpdatable.h"
#include "SensorTypes.h"
#include <Arduino.h>
#include <Wire.h>
#include <math.h>
#include <string.h>

class Lsm303Manager : public IUpdatable {
private:
    const uint8_t ACCEL_ADDR = 0x18;
    const uint8_t MAG_ADDR   = 0x1E;
    
    static constexpr uint16_t CALIBRATION_SAMPLES = 20;

    Lsm303CalibrationInt calibInt;
    Lsm303FloatData calibFloat = {0};

    Lsm303RawData rawData;

    bool readAccelRaw(int16_t &ax, int16_t &ay, int16_t &az) {
        Wire.beginTransmission(ACCEL_ADDR); 
        Wire.write(0x28 | 0x80); 
        Wire.endTransmission();
        
        Wire.requestFrom((uint8_t)ACCEL_ADDR, (uint8_t)6);
        if (Wire.available() >= 6) {
            uint8_t xL = Wire.read(), xH = Wire.read();
            uint8_t yL = Wire.read(), yH = Wire.read();
            uint8_t zL = Wire.read(), zH = Wire.read();
            ax = ((int16_t)(((uint16_t)xH << 8) | xL)) >> 4;
            ay = ((int16_t)(((uint16_t)yH << 8) | yL)) >> 4;
            az = ((int16_t)(((uint16_t)zH << 8) | zL)) >> 4;
            return true;
        }
        return false;
    }

    bool readMagRaw(int16_t &mx, int16_t &my, int16_t &mz) {
        Wire.beginTransmission(MAG_ADDR); 
        Wire.write(0x03); 
        Wire.endTransmission();
        
        Wire.requestFrom((uint8_t)MAG_ADDR, (uint8_t)6);
        if (Wire.available() >= 6) {
            uint8_t xH = Wire.read(), xL = Wire.read();
            uint8_t zH = Wire.read(), zL = Wire.read();
            uint8_t yH = Wire.read(), yL = Wire.read();
            mx = (int16_t)(((uint16_t)xH << 8) | xL);
            mz = (int16_t)(((uint16_t)zH << 8) | zL);
            my = (int16_t)(((uint16_t)yH << 8) | yL);
            return true;
        }
        return false;
    }

    float calculateHeading(float x, float y) const {
        float heading = atan2(y, x) * (180.0 / PI);
        if (heading < 0) heading += 360.0;
        return heading;
    }

public:
    void begin() override {
        Wire.beginTransmission(ACCEL_ADDR); Wire.write(0x20); Wire.write(0x27); Wire.endTransmission();
        Wire.beginTransmission(MAG_ADDR);   Wire.write(0x02); Wire.write(0x00); Wire.endTransmission();
        delay(500);

        memset(&calibInt, 0, sizeof(calibInt));
        calibInt.samples = CALIBRATION_SAMPLES;

        int16_t temp_ax, temp_ay, temp_az;

        for (uint16_t i = 0; i < calibInt.samples; i++) {
            if (readAccelRaw(temp_ax, temp_ay, temp_az)) {
                calibInt.sum_ax += temp_ax;
                calibInt.sum_ay += temp_ay;
                calibInt.sum_az += temp_az;
            }
            delay(10);
        }

        float f_samples = (float)calibInt.samples;
        calibFloat.ax = (float)calibInt.sum_ax / f_samples;
        calibFloat.ay = (float)calibInt.sum_ay / f_samples;
        calibFloat.az = ((float)calibInt.sum_az / f_samples) - 1000.0f;
    }

    void update() override {
        readAccelRaw(rawData.ax, rawData.ay, rawData.az);
        readMagRaw(rawData.mx, rawData.my, rawData.mz);
    }

    // --- Getters de Datos Crudos y Calibración ---
    const Lsm303RawData& getRawData() const { return rawData; }
    const Lsm303CalibrationInt& getCalibrationInt() const { return calibInt; }
    const Lsm303FloatData& getCalibrationFloat() const { return calibFloat; }

    // --- Getters en Cascada devolviendo Lsm303FloatData por valor ---

    Lsm303FloatData getRawDataFloat() const {
        Lsm303FloatData data;
        data.ax = (float)rawData.ax;
        data.ay = (float)rawData.ay;
        data.az = (float)rawData.az;
        data.mx = -(float)rawData.mx;
        data.my =  (float)rawData.my;
        data.mz =  (float)rawData.mz;

        data.roll  = atan2(data.ay, data.az) * (180.0 / PI);
        data.pitch = atan2(-data.ax, sqrt(data.ay * data.ay + data.az * data.az)) * (180.0 / PI);
        data.heading = calculateHeading(data.my, data.mx);
        return data;
    }

    Lsm303FloatData getCalibratedDataFloat() const {
        Lsm303FloatData data = getRawDataFloat();
        
        data.ax -= calibFloat.ax;
        data.ay -= calibFloat.ay;
        data.az -= calibFloat.az;
        data.mx -= calibFloat.mx;
        data.my -= calibFloat.my;

        data.roll  = atan2(data.ay, data.az) * (180.0 / PI);
        data.pitch = atan2(-data.ax, sqrt(data.ay * data.ay + data.az * data.az)) * (180.0 / PI);
        data.heading = calculateHeading(data.my, data.mx);
        return data;
    }

    Lsm303FloatData getCompensatedDataFloat() const {
        Lsm303FloatData data = getCalibratedDataFloat();

        float roll_rad  = data.roll * (PI / 180.0);
        float pitch_rad = data.pitch * (PI / 180.0);
        float mz        = (float)rawData.mz;

        float Xh = data.mx * cos(pitch_rad) + mz * sin(pitch_rad);
        float Yh = data.mx * sin(roll_rad) * sin(pitch_rad) - data.my * cos(roll_rad) + mz * cos(pitch_rad) * sin(roll_rad);

        data.heading = calculateHeading(Yh, Xh);
        return data;
    }
};

#endif