#include "WebServerManager.h"

static WebSocketsServer* globalWsPtr = nullptr;

WebServerManager::WebServerManager() 
    : server(80), webSocket(81), txPower(78) {
    globalWsPtr = &webSocket;
    memset(ssid, 0, sizeof(ssid));
    memset(password, 0, sizeof(password));
    strcpy(ssid, "ISHA_Boat_AP");
    strcpy(password, "");
}

bool WebServerManager::begin() {
    if (!LittleFS.begin(true)) {
        Serial.println("[WebServer] Error al montar LittleFS");
        return false;
    }

    if (!loadConfiguration()) {
        Serial.println("[WebServer] Usando valores por defecto ante fallo de lectura de config.ini");
    }

    WiFi.mode(WIFI_AP);
    
    if (localIp != IPAddress(0, 0, 0, 0)) {
        WiFi.softAPConfig(localIp, gateway, subnet);
    }

    WiFi.softAP(ssid, password);
    WiFi.setTxPower((wifi_power_t)txPower);

    Serial.print("[WiFi] AP Iniciado. IP del barco: ");
    Serial.println(WiFi.softAPIP());

    setupWebServer();
    server.begin();
    webSocket.begin();
    webSocket.onEvent(webSocketEvent);
    
    Serial.println("[WebServer] Servidor HTTP y WebSockets listos.");
    return true;
}

void WebServerManager::update() {
    server.handleClient();
    webSocket.loop();
}

void WebServerManager::stop() {
    server.stop();
    WiFi.mode(WIFI_OFF); // Al apagar el WiFi se cierran automáticamente todos los sockets
    LittleFS.end();
    Serial.println("[WebServer] Wi-Fi y servidor detenidos (Ahorro de energía).");
}

void WebServerManager::trim(char* str) {
    if (!str) return;
    char* start = str;
    while (*start == ' ' || *start == '\t' || *start == '\r' || *start == '\n') start++;
    if (start != str) {
        memmove(str, start, strlen(start) + 1);
    }
    int len = strlen(str);
    while (len > 0 && (str[len - 1] == ' ' || str[len - 1] == '\t' || str[len - 1] == '\r' || str[len - 1] == '\n')) {
        str[len - 1] = '\0';
        len--;
    }
}

bool WebServerManager::loadConfiguration() {
    File file = LittleFS.open("/config.ini", "r");
    if (!file) {
        Serial.println("[WebServer] No se pudo abrir /config.ini");
        return false;
    }

    char lineBuffer[128];
    while (file.available()) {
        int len = file.readBytesUntil('\n', lineBuffer, sizeof(lineBuffer) - 1);
        lineBuffer[len] = '\0';
        if (len > 0 && lineBuffer[len - 1] == '\r') lineBuffer[len - 1] = '\0';

        trim(lineBuffer);
        if (lineBuffer[0] == '\0' || lineBuffer[0] == '#' || lineBuffer[0] == ';') continue;

        char* eq = strchr(lineBuffer, '=');
        if (eq != nullptr) {
            *eq = '\0';
            char* key = lineBuffer;
            char* val = eq + 1;
            trim(key);
            trim(val);

            if (strcmp(key, "ssid") == 0) {
                strncpy(ssid, val, sizeof(ssid) - 1);
                ssid[sizeof(ssid) - 1] = '\0';
            } else if (strcmp(key, "password") == 0) {
                strncpy(password, val, sizeof(password) - 1);
                password[sizeof(password) - 1] = '\0';
            } else if (strcmp(key, "tx_power") == 0) {
                txPower = atoi(val);
            } else if (strcmp(key, "ip") == 0) {
                localIp.fromString(val);
            } else if (strcmp(key, "gateway") == 0) {
                gateway.fromString(val);
            } else if (strcmp(key, "subnet") == 0) {
                subnet.fromString(val);
            }
        }
    }
    file.close();
    return true;
}

void WebServerManager::setupWebServer() {
    server.on("/", HTTP_GET, [this]() {
        if (LittleFS.exists("/index.html")) {
            File file = LittleFS.open("/index.html", "r");
            server.streamFile(file, "text/html");
            file.close();
        } else {
            server.send(404, "text/plain", "Error: index.html no encontrado en LittleFS");
        }
    });
}

void WebServerManager::webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
    switch (type) {
        case WStype_DISCONNECTED:
            Serial.printf("[%u] Cliente WebSocket desconectado\n", num);
            break;
        case WStype_CONNECTED: {
            IPAddress ip = globalWsPtr->remoteIP(num);
            Serial.printf("[%u] Cliente conectado desde %s\n", num, ip.toString().c_str());
            break;
        }
        default:
            break;
    }
}

void WebServerManager::broadcast(const char* payload) {
    if (payload != nullptr) {
        webSocket.broadcastTXT(payload);
    }
}