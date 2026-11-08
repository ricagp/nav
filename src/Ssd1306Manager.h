#ifndef SSD1306_MANAGER_H
#define SSD1306_MANAGER_H

#include "IUpdatable.h"
#include <SSD1306Ascii.h>
#include <SSD1306AsciiWire.h>
#include <string.h>

class Ssd1306Manager : public IUpdatable {
private:
    SSD1306AsciiWire oled;
    uint8_t i2cAddress;
    char lines[4][22];     // Búfer para lo que queremos mostrar
    char lastLines[4][22]; // Búfer para evitar parpadeos

public:
    Ssd1306Manager(uint8_t addr = 0x3C) {
        i2cAddress = addr;
    }

    void begin() override {
        // Inicialización usando tipografía estándar de ASCII
        oled.begin(&Adafruit128x64, i2cAddress);
        oled.setFont(System5x7);
        clear();
        for (int i = 0; i < 4; i++) {
            lastLines[i][0] = '\0';
        }
    }

    void clear() {
        for (int i = 0; i < 4; i++) {
            lines[i][0] = '\0';
        }
    }

    void setLine(uint8_t row, const char* text) {
        if (row < 4) {
            snprintf(lines[row], sizeof(lines[row]), "%s", text);
        }
    }

    // El update inteligente evita parpadeos reescribiendo solo lo que cambia
    void update() override {
        for (uint8_t i = 0; i < 4; i++) {
            if (strcmp(lines[i], lastLines[i]) != 0) {
                // SSD1306Ascii usa filas lógicas de texto (0 a 3 o 7 según fuente)
                oled.setCursor(0, i * 2); 
                oled.print(F("                    ")); // Limpia la línea con espacios
                oled.setCursor(0, i * 2); 
                oled.print(lines[i]);
                strcpy(lastLines[i], lines[i]);
            }
        }
    }
};

#endif