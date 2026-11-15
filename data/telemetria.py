import struct
import csv
import argparse
import math

HOURS_OFFSET = 1  # 1 para invierno, 2 para verano en Madrid

def haversine_distance(lat1, lon1, lat2, lon2):
    """Calcula la distancia en metros entre dos puntos geográficos (Haversine)."""
    R = 6371000.0  # Radio de la Tierra en metros
    dLat = math.radians(lat2 - lat1)
    dLon = math.radians(lon2 - lon1)
    a = math.sin(dLat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dLon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def analyze_and_export_telemetry(base_filename):
    if base_filename.lower().endswith(".bin"):
        base_filename = base_filename[:-4]
        
    filename = f"{base_filename}.bin"
    print(f"--- ANALIZANDO Y FILTRANDO FICHERO DE TELEMETRÍA: {filename} ---\n")
    
    # Ficheros de salida
    calib_csv_name   = f"{base_filename}_calib.csv"
    imu_csv_name     = f"{base_filename}_imu.csv"
    gps_raw_csv_name = f"{base_filename}_gps_raw.csv"
    gps_clean_csv_name = f"{base_filename}_gps_clean.csv" # Fichero filtrado
    
    packet_count = 0
    calib_count = 0
    imu_count = 0
    gps_count = 0
    gps_clean_count = 0
    
    # Contadores estadísticos
    max_speed = -1.0
    min_speed = float('inf')
    max_speed_time = "N/A"
    min_speed_time = "N/A"
    
    min_lat = float('inf')
    max_lat = float('-inf')
    min_lat_time = "N/A"
    max_lat_time = "N/A"
    
    min_lon = float('inf')
    max_lon = float('-inf')
    min_lon_time = "N/A"
    max_lon_time = "N/A"
    
    total_distance_meters = 0.0
    last_timestamp = None
    first_timestamp = None
    last_timestamp_session = None
    
    first_valid_local = None
    last_valid_local = None
    
    # Umbral del filtro de distancia (en metros)
    DISTANCIA_UMBRAL = 5.0

    def parse_local_time(gps_time_val):
        try:
            total_centiseconds = int(gps_time_val)
            if total_centiseconds <= 0:
                return None
            total_seconds = (total_centiseconds // 100) + (HOURS_OFFSET * 3600)
            total_seconds %= 86400
            h = total_seconds // 3600
            m = (total_seconds % 3600) // 60
            sec = total_seconds % 60
            return f"{h:02d}:{m:02d}:{sec:02d}"
        except:
            return None

    try:
        with open(filename, "rb") as f, \
             open(calib_csv_name, "w", newline="", encoding="utf-8") as f_calib, \
             open(imu_csv_name, "w", newline="", encoding="utf-8") as f_imu, \
             open(gps_raw_csv_name, "w", newline="", encoding="utf-8") as f_raw, \
             open(gps_clean_csv_name, "w", newline="", encoding="utf-8") as f_clean:
            
            writer_calib = csv.writer(f_calib)
            writer_calib.writerow(["Tipo", "Firmware", "Muestras", "Val1", "Val2", "Val3", "Val4", "Val5", "Val6"])
            
            writer_imu = csv.writer(f_imu)
            writer_imu.writerow(["Timestamp_ms", "Ax", "Ay", "Az", "Mx", "My", "Mz"])
            
            writer_raw = csv.writer(f_raw)
            writer_raw.writerow(["Timestamp_ms", "Hora_Local", "Latitud", "Longitud", "Velocidad_nudos", "Rumbo", "Valido"])
            
            writer_clean = csv.writer(f_clean) # CSV optimizado y suavizado
            writer_clean.writerow(["Timestamp_ms", "Hora_Local", "Latitud_Media", "Longitud_Media", "Dist_Desde_Anterior_m"])
            
            # Variables de estado para el filtro de acumulación espacial
            last_accepted_lat = 0.0
            last_accepted_lon = 0.0
            sum_lat = 0.0
            sum_lon = 0.0
            points_in_average = 0
            
            while True:
                type_byte = f.read(1)
                if not type_byte:
                    break
                
                packet_type = type_byte[0]
                
                if packet_type == 0x01:
                    data = f.read(15)
                    if len(data) < 15: break
                    fw, samples, s_ax, s_ay, s_az = struct.unpack("<B H i i i", data)
                    writer_calib.writerow(["ACCEL", fw, samples, s_ax, s_ay, s_az, "", "", ""])
                    calib_count += 1
                    
                elif packet_type == 0x02:
                    data = f.read(13)
                    if len(data) < 13: break
                    fw, minx, maxx, miny, maxy, minz, maxz = struct.unpack("<B h h h h h h", data)
                    writer_calib.writerow(["MAG", fw, "", minx, maxx, miny, maxy, minz, maxz])
                    calib_count += 1
                    
                elif packet_type == 0x03:
                    data = f.read(16)
                    if len(data) < 16: break
                    timestamp, ax, ay, az, mx, my, mz = struct.unpack("<I h h h h h h", data)
                    writer_imu.writerow([timestamp, ax, ay, az, mx, my, mz])
                    imu_count += 1
                    
                elif packet_type == 0x04:
                    data = f.read(25)
                    if len(data) < 25: break
                    timestamp, gps_time, date, lat, lon, speed, course, valid = struct.unpack("<I I I i i H H B", data)
                    
                    if first_timestamp is None: first_timestamp = timestamp
                    last_timestamp_session = timestamp
                    
                    lat_deg = lat / 10000000.0
                    lon_deg = lon / 10000000.0
                    speed_knots = speed / 10.0
                    course_deg = course / 10.0
                    
                    time_str = parse_local_time(gps_time)
                    display_time = time_str if time_str else "N/A"
                    
                    # Guardar siempre en el RAW completo
                    writer_raw.writerow([timestamp, display_time, f"{lat_deg:.7f}", f"{lon_deg:.7f}", f"{speed_knots:.1f}", f"{course_deg:.1f}", valid])
                    gps_count += 1
                    
                    # --- APLICACIÓN DEL FILTRO DE DISTANCIA (FSM / Acumulación) ---
                    if valid == 1:
                        if time_str:
                            if first_valid_local is None: first_valid_local = time_str
                            last_valid_local = time_str
                        
                        # Estadísticas globales
                        if speed_knots > max_speed: max_speed, max_speed_time = speed_knots, display_time
                        if speed_knots < min_speed: min_speed, min_speed_time = speed_knots, display_time
                        if lat_deg < min_lat: min_lat, min_lat_time = lat_deg, display_time
                        if lat_deg > max_lat: max_lat, max_lat_time = lat_deg, display_time
                        if lon_deg < min_lon: min_lon, min_lon_time = lon_deg, display_time
                        if lon_deg > max_lon: max_lon, max_lon_time = lon_deg, display_time
                        
                        # Distancia estimada general
                        if last_timestamp is not None:
                            delta_time_sec = (timestamp - last_timestamp) / 1000.0
                            if 0 < delta_time_sec < 10:
                                total_distance_meters += (speed_knots * 0.514444) * delta_time_sec
                        last_timestamp = timestamp
                        
                        # Lógica del filtro espacial de 5 metros
                        if points_in_average == 0:
                            sum_lat = lat_deg
                            sum_lon = lon_deg
                            points_in_average = 1
                            last_accepted_lat = lat_deg
                            last_accepted_lon = lon_deg
                        else:
                            current_mean_lat = sum_lat / points_in_average
                            current_mean_lon = sum_lon / points_in_average
                            dist_to_mean = haversine_distance(lat_deg, lon_deg, current_mean_lat, current_mean_lon)
                            
                            if dist_to_mean >= DISTANCIA_UMBRAL:
                                # Se superó el umbral: calculamos la media del tramo y la guardamos
                                final_lat = sum_lat / points_in_average
                                final_lon = sum_lon / points_in_average
                                
                                dist_from_previous = haversine_distance(final_lat, final_lon, last_accepted_lat, last_accepted_lon)
                                
                                writer_clean.writerow([
                                    timestamp,
                                    display_time,
                                    f"{final_lat:.7f}",
                                    f"{final_lon:.7f}",
                                    f"{dist_from_previous:.2f}"
                                ])
                                gps_clean_count += 1
                                
                                last_accepted_lat = final_lat
                                last_accepted_lon = final_lon
                                sum_lat = lat_deg
                                sum_lon = lon_deg
                                points_in_average = 1
                            else:
                                sum_lat += lat_deg
                                sum_lon += lon_deg
                                points_in_average += 1
                else:
                    pass
                packet_count += 1

        elapsed_str = "00:00:00"
        if first_timestamp is not None and last_timestamp_session is not None:
            total_sec = max(0.0, (last_timestamp_session - first_timestamp) / 1000.0)
            elapsed_str = f"{int(total_sec // 3600):02d}:{int((total_sec % 3600) // 60):02d}:{int(total_sec % 60):02d}"

        print("==================================================")
        print("          RESUMEN DE ESTADÍSTICAS DE TRAYECTO     ")
        print("==================================================")
        print(f" Paquetes totales procesados : {packet_count}")
        print(f" Primera hora local válida   : {first_valid_local or 'N/A'}")
        print(f" Última hora local válida    : {last_valid_local or 'N/A'}")
        print(f" Tiempo transcurrido         : {elapsed_str}")
        print(f" Distancia total estimada    : {total_distance_meters / 1000.0:.3f} km ({total_distance_meters:.1f} metros)")
        print("--------------------------------------------------")
        print(f" Velocidad MÁXIMA            : {max_speed:.1f} nudos (a las {max_speed_time} Local)")
        print(f" Velocidad MÍNIMA            : {min_speed:.1f} nudos (a las {min_speed_time} Local)")
        print("==================================================")
        print(" FICHEROS CSV GENERADOS:")
        print(f"  -> {calib_csv_name} ({calib_count} registros)")
        print(f"  -> {imu_csv_name} ({imu_count} registros)")
        print(f"  -> {gps_raw_csv_name} ({gps_count} registros - completo)")
        print(f"  -> {gps_clean_csv_name} ({gps_clean_count} registros - filtrado >5m)")
        print("==================================================")

    except FileNotFoundError:
        print(f"[ERROR] No se pudo encontrar el fichero '{filename}'.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Analizador y filtrador espacial de telemetría marina.")
    parser.add_argument("fichero", help="Nombre base del fichero binario (ej: telemetria_17)")
    args = parser.parse_args()
    analyze_and_export_telemetry(args.fichero)