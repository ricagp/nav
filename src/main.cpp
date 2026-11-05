#include <Arduino.h>
#include <Wire.h>
#include <math.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET    -1
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

#define ACCEL_ADDR 0x18
#define MAG_ADDR   0x1E

float accel_offset_x = 0;
float accel_offset_y = 0;
float accel_offset_z = 0;

float mag_offset_x = 0;
float mag_offset_y = 0;

void setup() {
  Serial.begin(115200);
  Wire.begin(21, 22);
  delay(100);

  if(!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    for(;;);
  }

  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println(F("CALIBRACION PLANA"));
  display.setCursor(0, 15);
  display.println(F("Gira la placa 360"));
  display.setCursor(0, 27);
  display.println(F("en horizontal (5s)..."));
  display.display();

  // 1. Configurar Acelerómetro y Magnetómetro
  Wire.beginTransmission(ACCEL_ADDR); Wire.write(0x20); Wire.write(0x27); Wire.endTransmission();
  Wire.beginTransmission(MAG_ADDR);   Wire.write(0x02); Wire.write(0x00); Wire.endTransmission();
  delay(500);

  // Calibración plana de 5 segundos (Mínimos y Máximos X e Y)
  float mag_min_x = 32767.0, mag_max_x = -32767.0;
  float mag_min_y = 32767.0, mag_max_y = -32767.0;

  unsigned long startTime = millis();
  while (millis() - startTime < 5000) {
    Wire.beginTransmission(MAG_ADDR); Wire.write(0x03); Wire.endTransmission();
    Wire.requestFrom(MAG_ADDR, 6);
    if (Wire.available() >= 6) {
      uint8_t xH = Wire.read(), xL = Wire.read();
      uint8_t zH = Wire.read(), zL = Wire.read(); // Se leen para vaciar el buffer I2C
      uint8_t yH = Wire.read(), yL = Wire.read();
      
      float mx = -(float)((int16_t)(((uint16_t)xH << 8) | xL));
      float my =  (float)((int16_t)(((uint16_t)yH << 8) | yL));

      if (mx < mag_min_x) mag_min_x = mx; if (mx > mag_max_x) mag_max_x = mx;
      if (my < mag_min_y) mag_min_y = my; if (my > mag_max_y) mag_max_y = my;
    }
    delay(30);
  }

  mag_offset_x = (mag_max_x + mag_min_x) / 2.0;
  mag_offset_y = (mag_max_y + mag_min_y) / 2.0;

  // Calibración estática rápida del acelerómetro en plano
  int32_t suma_ax = 0, suma_ay = 0, suma_az = 0;
  for (int i = 0; i < 20; i++) {
    Wire.beginTransmission(ACCEL_ADDR); Wire.write(0x28 | 0x80); Wire.endTransmission();
    Wire.requestFrom(ACCEL_ADDR, 6);
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

  display.clearDisplay();
  display.setCursor(0, 20);
  display.println(F("¡Listo! Mide plano"));
  display.display();
  delay(1000);
}

void loop() {
  // Leer Acelerómetro
  Wire.beginTransmission(ACCEL_ADDR); Wire.write(0x28 | 0x80); Wire.endTransmission();
  Wire.requestFrom(ACCEL_ADDR, 6);
  float ax = 0, ay = 0, az = 0;
  if (Wire.available() >= 6) {
    uint8_t xL = Wire.read(), xH = Wire.read();
    uint8_t yL = Wire.read(), yH = Wire.read();
    uint8_t zL = Wire.read(), zH = Wire.read();
    ax = (float)(((int16_t)(((uint16_t)xH << 8) | xL)) >> 4) - accel_offset_x;
    ay = (float)(((int16_t)(((uint16_t)yH << 8) | yL)) >> 4) - accel_offset_y;
    az = (float)(((int16_t)(((uint16_t)zH << 8) | zL)) >> 4) - accel_offset_z;
  }

  // Leer Magnetómetro
  Wire.beginTransmission(MAG_ADDR); Wire.write(0x03); Wire.endTransmission();
  Wire.requestFrom(MAG_ADDR, 6);
  float mx = 0, my = 0, mz = 0;
  if (Wire.available() >= 6) {
    uint8_t xH = Wire.read(), xL = Wire.read();
    uint8_t zH = Wire.read(), zL = Wire.read();
    uint8_t yH = Wire.read(), yL = Wire.read();
    mx = -(float)((int16_t)(((uint16_t)xH << 8) | xL));
    mz =  (float)((int16_t)(((uint16_t)zH << 8) | zL));
    my =  (float)((int16_t)(((uint16_t)yH << 8) | yL));
  }

  // 1. RUMBO SIN CALIBRAR (Crudo directo con mx, my sin offsets)
  float heading_raw = atan2(my, mx) * (180.0 / PI);
  if (heading_raw < 0) heading_raw += 360.0;

  // Offsets Hard-Iron 2D
  float mx_cal = mx - mag_offset_x;
  float my_cal = my - mag_offset_y;

  // 2. RUMBO CALIBRADO (Plano 2D con offsets Hard-Iron)
  float heading_cal = atan2(my_cal, mx_cal) * (180.0 / PI);
  if (heading_cal < 0) heading_cal += 360.0;

  // 3. RUMBO CON COMPENSACIÓN DE INCLINACIÓN
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

  float heading_comp = atan2(Yh, Xh) * (180.0 / PI);
  if (heading_comp < 0) heading_comp += 360.0;

  // --- RENDERIZAR EN PANTALLA OLED ---
  display.clearDisplay();
  
  // Etiqueta superior
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print(F("RUMBO SIN CALIBRAR"));
  
  // Valor GRANDE sin calibrar (Principal)
  display.setTextSize(2);
  display.setCursor(0, 14);
  display.print(heading_raw, 1);
  display.print(F(" o"));

  // Línea divisoria
  display.drawLine(0, 38, 127, 38, SSD1306_WHITE);

  // Línea inferior: Rumbo calibrado y Rumbo compensado en pequeño
  display.setTextSize(1);
  display.setCursor(0, 48);
  display.print(F("Cal:"));
  display.print(heading_cal, 1);
  display.print(F(" Comp:"));
  display.print(heading_comp, 1);

  display.display();

  delay(150);
}