#ifndef MICRO_SD_MANAGER_H
#define MICRO_SD_MANAGER_H

#include <Arduino.h>
#include <SPI.h>
#include <SD.h>
#include "SensorTypes.h" // Incluimos las estructuras de telemetría unificadas

class MicroSdManager {
private:
    uint8_t csPin;
    bool initialized;
    File activeFile; // Descriptor del archivo abierto de forma persistente

public:
    // Constructor: recibe el pin Chip Select (por defecto el pin 5 en muchos ESP32)
    MicroSdManager(uint8_t chipSelectPin = 5) {
        csPin = chipSelectPin;
        initialized = false;
    }

    // Inicializa la interfaz SPI y verifica la presencia de la tarjeta
    bool begin() {
        if (!SD.begin(csPin)) {
            Serial.println(F("[ERROR SD] No se pudo inicializar la tarjeta MicroSD. Comprueba el cableado."));
            initialized = false;
            return false;
        }

        uint8_t cardType = SD.cardType();
        if (cardType == CARD_NONE) {
            Serial.println(F("[ERROR SD] Ninguna tarjeta MicroSD detectada."));
            initialized = false;
            return false;
        }

        Serial.println(F("[SD] Tarjeta MicroSD inicializada correctamente."));
        initialized = true;
        return true;
    }

    // Comprueba si el gestor está listo
    bool isInitialized() const {
        return initialized;
    }

    // Abre el archivo de registro una sola vez al inicio en modo escritura/añadir
    bool openLog(const char* path) {
        if (!initialized) {
            Serial.println(F("[ERROR SD] Intentando abrir log sin inicializar la SD."));
            return false;
        }
        
        // Abrimos el fichero en modo escritura (crea el archivo si no existe)
        activeFile = SD.open(path, FILE_WRITE);
        if (!activeFile) {
            Serial.println(F("[ERROR SD] No se pudo abrir o crear el archivo de registro en la SD."));
            return false;
        }

        Serial.print(F("[SD] Archivo abierto para escritura persistente: "));
        Serial.println(path);
        return true;
    }

    // Escribe cualquier bloque de bytes de forma directa y ultrarrápida (sin cerrar el archivo)
    bool writeBinary(const uint8_t* data, size_t length) {
        if (!activeFile) {
            return false;
        }
        
        size_t written = activeFile.write(data, length);
        return (written == length);
    }

    // Método plantilla opcional para volcar directamente cualquier struct empaquetada
    template <typename T>
    bool writePacket(const T& packet) {
        return writeBinary(reinterpret_cast<const uint8_t*>(&packet), sizeof(T));
    }

    // Fuerza la bajada de datos de la caché interna de la SD a los sectores físicos (sin cerrar)
    void flush() {
        if (activeFile) {
            activeFile.flush();
        }
    }

    // Cierra formalmente el archivo (ideal llamarlo al detener el registro de forma controlada)
    void closeLog() {
        if (activeFile) {
            activeFile.close();
            Serial.println(F("[SD] Archivo de registro cerrado correctamente."));
        }
    }
};

#endif