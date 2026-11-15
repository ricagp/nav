#ifndef MICRO_SD_MANAGER_H
#define MICRO_SD_MANAGER_H

#include <Arduino.h>
#include <SPI.h>
#include <SD.h>

class MicroSdManager {
private:
    uint8_t _csPin;
    File _logFile;
    bool _isInitialized;

public:
    MicroSdManager(uint8_t csPin) : _csPin(csPin), _isInitialized(false) {}

    bool begin() {
        if (!SD.begin(_csPin)) {
            Serial.println(F("[SD] Error: No se pudo inicializar la tarjeta SD."));
            return false;
        }
        
        if (SD.cardType() == CARD_NONE) {
            Serial.println(F("[SD] Error: Ninguna tarjeta SD detectada."));
            return false;
        }
        
        _isInitialized = true;
        Serial.println(F("[SD] Tarjeta SD inicializada correctamente."));
        return true;
    }

    // Método encapsulado: busca automáticamente el siguiente archivo libre y lo abre
    bool openNextLog(const char* prefix = "/telemetria") {
        if (!_isInitialized) {
            Serial.println(F("[SD] Error: SD no inicializada."));
            return false;
        }

        char filename[32];
        int fileIndex = 1;

        do {
            snprintf(filename, sizeof(filename), "%s_%02d.bin", prefix, fileIndex);
            fileIndex++;
        } while (SD.exists(filename));

        _logFile = SD.open(filename, FILE_WRITE);
        if (!_logFile) {
            Serial.printf("[SD] Error al abrir/crear el archivo: %s\n", filename);
            return false;
        }

        Serial.printf("[SD] Fichero de sesión abierto: %s\n", filename);
        return true;
    }

    // Nuevo método público para verificar si el archivo está abierto y listo para grabar
    bool isReady() const {
        return _isInitialized && _logFile;
    }

    template <typename T>
    size_t writePacket(const T& packet) {
        if (!_logFile) return 0;
        return _logFile.write((uint8_t*)&packet, sizeof(T));
    }

    void flush() {
        if (_logFile) {
            _logFile.flush();
        }
    }

    void close() {
        if (_logFile) {
            _logFile.close();
            Serial.println(F("[SD] Fichero cerrado correctamente."));
        }
    }

    ~MicroSdManager() {
    close();
}
};

#endif