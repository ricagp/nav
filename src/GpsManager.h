#ifndef GPS_MANAGER_H
#define GPS_MANAGER_H

#include <Arduino.h>
#include "SensorTypes.h"

class GpsManager {
public:
    GpsManager() {
        _gpsRxPin = 16;
        _gpsTxPin = 17;
        _baudRate = 9600;
        _nmeaIndex = 0;
        memset(_nmeaBuffer, 0, sizeof(_nmeaBuffer));
    }

    void begin(int rxPin = 16, int txPin = 17, unsigned long baudRate = 9600) {
        _gpsRxPin = rxPin;
        _gpsTxPin = txPin;
        _baudRate = baudRate;

        // Inicializamos Serial2 para el GPS
        Serial2.begin(_baudRate, SERIAL_8N1, _gpsRxPin, _gpsTxPin);
        delay(500);

        Serial.println("[GPS] Inicializando puerto serie 2 y configurando módulo...");

        // Configuramos el GPS por comandos de texto (PMTK314) para dejar SOLO RMC activo
        Serial2.print("$PMTK314,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0*29\r\n");
    }

    // Método que debe llamarse de forma continua en el loop() principal
    bool update(GpsRmcPacket &packet) {
        while (Serial2.available() > 0) {
            char c = Serial2.read();

            if (c == '\n' || c == '\r') {
                if (_nmeaIndex > 0) {
                    _nmeaBuffer[_nmeaIndex] = '\0';
                    
                    // --- DEPURACIÓN: Imprime absolutamente todo lo que llega del GPS ---
                    Serial.printf("[GPS RAW] %s\n", _nmeaBuffer);

                    bool success = false;
                    if (strncmp(_nmeaBuffer, "$GPRMC", 6) == 0 || strncmp(_nmeaBuffer, "$GNRMC", 6) == 0) {
                        success = parseRMC(_nmeaBuffer, packet);
                        if (success) {
                            Serial.println("[GPS] -> ¡Trama RMC procesada con FIX VÁLIDO (A)! Coordenadas y fecha capturadas.");
                        } else {
                            Serial.println("[GPS] -> Trama RMC recibida pero sin cobertura (Estado 'V' - Void).");
                        }
                    }

                    _nmeaIndex = 0; // Reiniciamos el buffer para la siguiente trama
                    if (success) {
                        return true; // Paquete GPS listo para guardar en la SD
                    }
                }
            } else if (_nmeaIndex < MAX_NMEA_LINE - 1) {
                if (c >= 32) { // Ignorar caracteres de control invisibles
                    _nmeaBuffer[_nmeaIndex++] = c;
                }
            }
        }
        return false;
    }

private:
    static const int MAX_NMEA_LINE = 128;
    char _nmeaBuffer[MAX_NMEA_LINE];
    int _nmeaIndex;
    int _gpsRxPin;
    int _gpsTxPin;
    unsigned long _baudRate;

    // Conversión de coordenadas NMEA a entero con factor 10^7
    int32_t convertCoordToFixed(double coord, char dir) {
        int g = (int)(coord / 100);
        double m = coord - (g * 100);
        double d = g + (m / 60.0);
        if (dir == 'S' || dir == 'W') {
            d = -d;
        }
        return (int32_t)round(d * 10000000.0);
    }

    // Parser interno de la trama RMC
    bool parseRMC(char* line, GpsRmcPacket &packet) {
        char charBuf[128];
        strncpy(charBuf, line, sizeof(charBuf));

        char* tokens[15];
        int tokenCount = 0;

        char* token = strtok(charBuf, ",");
        while (token != NULL && tokenCount < 15) {
            tokens[tokenCount++] = token;
            token = strtok(NULL, ",");
        }

        // Validar que tenemos suficientes tokens y que el campo de estado es 'A' (Active / Fix válido)
        if (tokenCount > 9 && tokens[2][0] == 'A') {
            double utc      = atof(tokens[1]);
            double latNmea  = atof(tokens[3]);
            char ns         = tokens[4][0];
            double lonNmea  = atof(tokens[5]);
            char ew         = tokens[6][0];
            double speedKnots = atof(tokens[7]);
            double courseDeg  = atof(tokens[8]);
            unsigned long dateInt = atol(tokens[9]);

            // Rellenar la estructura empaquetada
            packet.timestamp = millis();
            
            // Hora UTC en formato centésimas (hhmmsscc)
            uint32_t hhmmss_int = (uint32_t)utc;
            int horas   = hhmmss_int / 10000;
            int minutos = (hhmmss_int / 100) % 100;
            int segundos= hhmmss_int % 100;
            int centesimas = (int)(round((utc - hhmmss_int) * 100));
            packet.gpsTime = (horas * 360000UL) + (minutos * 6000UL) + (segundos * 100UL) + centesimas;

            packet.date   = (uint32_t)dateInt;
            packet.lat    = convertCoordToFixed(latNmea, ns);
            packet.lon    = convertCoordToFixed(lonNmea, ew);
            packet.speed  = (uint16_t)round(speedKnots * 10.0); // Velocidad en nudos * 10
            packet.course = (uint16_t)round(courseDeg * 10.0);   // Rumbo en grados * 10
            packet.valid  = 1;                                  // Válido (A)

            return true;
        } else {
            packet.valid = 0;
        }

        return false;
    }
};

#endif // GPS_MANAGER_H