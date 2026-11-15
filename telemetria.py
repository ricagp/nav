import struct
import math

def analyze_telemetry(base_filename):
    filename = f"{base_filename}.bin"
    print(f"--- ANALIZANDO FICHERO DE TELEMETRÍA: {filename} ---\n")
    
    # Variables de control para estadísticas
    packet_count = 0
    
    # Velocidad
    max_speed = -1.0
    min_speed = float('inf')
    max_speed_time = "N/A"
    min_speed_time = "N/A"
    
    # Ubicación (Latitud / Longitud)
    min_lat = float('inf')
    max_lat = float('-inf')
    min_lat_time = "N/A"
    max_lat_time = "N/A"
    
    min_lon = float('inf')
    max_lon = float('-inf')
    min_lon_time = "N/A"
    max_lon_time = "N/A"
    
    # Distancia (Integración de velocidad por tiempo)
    total_distance_meters = 0.0
    last_timestamp = None
    
    try:
        with open(filename, "rb") as f:
            while True:
                type_byte = f.read(1)
                if not type_byte:
                    break
                
                packet_type = type_byte[0]
                
                if packet_type == 0x01:  # TYPE_CALIBRATION_ACCEL
                    f.read(15)
                elif packet_type == 0x02:  # TYPE_CALIBRATION_MAG
                    f.read(13)
                elif packet_type == 0x03:  # TYPE_IMU_RAW
                    f.read(16)
                elif packet_type == 0x04:  # TYPE_GPS_RMC
                    data = f.read(25)
                    if len(data) < 25: 
                        break
                    timestamp, gps_time, date, lat, lon, speed, course, valid = struct.unpack("<I I I i i H H B", data)
                    
                    # Convertir escalas
                    lat_deg = lat / 10000000.0
                    lon_deg = lon / 10000000.0
                    speed_knots = speed / 10.0
                    
                    # Formatear la hora UTC para mostrarla legible (HH:MM:SS)
                    time_str = f"{str(gps_time).zfill(6)[:2]}:{str(gps_time).zfill(6)[2:4]}:{str(gps_time).zfill(6)[4:]}"
                    
                    # 2) Evaluar velocidad máxima y mínima (solo si el fix es válido)
                    if valid == 1:
                        if speed_knots > max_speed:
                            max_speed = speed_knots
                            max_speed_time = time_str
                        if speed_knots < min_speed:
                            min_speed = speed_knots
                            min_speed_time = time_str
                            
                        # 3) Evaluar límites de latitud y longitud
                        if lat_deg < min_lat:
                            min_lat = lat_deg
                            min_lat_time = time_str
                        if lat_deg > max_lat:
                            max_lat = lat_deg
                            max_lat_time = time_str
                            
                        if lon_deg < min_lon:
                            min_lon = lon_deg
                            min_lon_time = time_str
                        if lon_deg > max_lon:
                            max_lon = lon_deg
                            max_lon_time = time_str
                            
                        # 4) Calcular distancia total integrando velocidad * tiempo
                        # Velocidad en nudos a metros por segundo: 1 nudo = 0.514444 m/s
                        if last_timestamp is not None:
                            delta_time_sec = (timestamp - last_timestamp) / 1000.0
                            if delta_time_sec > 0 and delta_time_sec < 10: # Filtrar saltos grandes de tiempo
                                speed_ms = speed_knots * 0.514444
                                total_distance_meters += speed_ms * delta_time_sec
                        last_timestamp = timestamp
                else:
                    pass
                    
                packet_count += 1
                
        # 5) Imprimir resultados por pantalla de forma organizada
        print("==================================================")
        print("          RESUMEN DE ESTADÍSTICAS DE TRAYECTO     ")
        print("==================================================")
        print(f" Paquetes totales procesados : {packet_count}")
        print(f" Distancia total estimada    : {total_distance_meters / 1000.0:.3f} km ({total_distance_meters:.1f} metros)")
        print("--------------------------------------------------")
        print(f" Velocidad MÁXIMA            : {max_speed:.1f} nudos (a las {max_speed_time} UTC)")
        print(f" Velocidad MÍNIMA            : {min_speed:.1f} nudos (a las {min_speed_time} UTC)")
        print("--------------------------------------------------")
        print(f" Latitud MÍNIMA              : {min_lat:.7f}° (a las {min_lat_time} UTC)")
        print(f" Latitud MÁXIMA              : {max_lat:.7f}° (a las {max_lat_time} UTC)")
        print(f" Longitud MÍNIMA             : {min_lon:.7f}° (a las {min_lon_time} UTC)")
        print(f" Longitud MÁXIMA             : {max_lon:.7f}° (a las {max_lon_time} UTC)")
        print("==================================================")

    except FileNotFoundError:
        print(f"[ERROR] No se pudo encontrar el archivo '{filename}'. Comprueba el nombre.")

if __name__ == "__main__":
    # Pasa el nombre del archivo SIN la extensión '.bin'
    analyze_telemetry("telemetria_11")