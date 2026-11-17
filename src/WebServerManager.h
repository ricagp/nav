#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <LittleFS.h>
#include "IUpdatable.h"

class WebServerManager : public IUpdatable {
private:
    WebServer server;
    WebSocketsServer webSocket;
    
    char ssid[33];
    char password[64];
    int txPower;
    IPAddress localIp;
    IPAddress gateway;
    IPAddress subnet;

    bool loadConfiguration();
    void setupWebServer();
    static void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length);
    void trim(char* str);

public:
    WebServerManager();

    bool begin() override; // Cambiado a bool para coincidir con IUpdatable
    void update() override;
    void stop();

    void broadcast(const char* payload);
};