#ifndef SENSOR_TYPES_H
#define SENSOR_TYPES_H

#include <Arduino.h>

// 1. Datos crudos en enteros (para guardar en la SD sin pérdida)
struct Lsm303RawData {
    int16_t ax, ay, az;
    int16_t mx, my, mz;
};

// 2. Calibración entera (para guardar la traza exacta en la SD)
struct Lsm303CalibrationInt {
    int32_t sum_ax, sum_ay, sum_az;
    int32_t mx, my;
    uint16_t samples;
};

// 3. Estructura unificada en Float con nomenclatura de hardware
struct Lsm303FloatData {
    float ax, ay, az;
    float mx, my, mz;
    float roll;
    float pitch;
    float heading;
};

#endif