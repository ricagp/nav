#ifndef SENSOR_TYPES_H
#define SENSOR_TYPES_H

#include <Arduino.h>

#pragma pack(push, 1)

// Definición de tipos o tags identificadores ampliados
enum PacketType : uint8_t {
    TYPE_CALIBRATION_ACCEL = 0x01,
    TYPE_CALIBRATION_MAG   = 0x02,
    TYPE_IMU_RAW           = 0x03,
    TYPE_GPS               = 0x04
};

// 1. Estructura de calibración exclusiva para el Acelerómetro
struct Lsm303AccelCalibration {
    uint8_t  type = TYPE_CALIBRATION_ACCEL;
    uint8_t  firmwareVersion = 1;
    uint16_t samples;
    int32_t  sum_ax, sum_ay, sum_az;
};

// 2. Estructura de calibración exclusiva para el Magnetómetro (Hard Iron Min/Max)
struct Lsm303MagCalibration {
    uint8_t  type = TYPE_CALIBRATION_MAG;
    uint8_t  firmwareVersion = 1;
    int16_t  magMinX, magMaxX;
    int16_t  magMinY, magMaxY;
    int16_t  magMinZ, magMaxZ;
};

// 3. Datos crudos de la IMU (Acelerómetro + Magnetómetro en tiempo real)
struct Lsm303RawData {
    uint8_t  type = TYPE_IMU_RAW;
    uint32_t timestamp; // Momento exacto de la lectura física
    int16_t  ax, ay, az;
    int16_t  mx, my, mz;
};

// 4. Datos de GPS
struct GpsData {
    uint8_t  type = TYPE_GPS;
    uint32_t timestamp;
    float    latitude;
    float    longitude;
    float    altitude;
};

#pragma pack(pop)

// Estructura en Float exclusivamente para cálculos internos en RAM
struct Lsm303FloatData {
    float ax, ay, az;
    float mx, my, mz;
    float roll;
    float pitch;
    float heading;
};

#endif