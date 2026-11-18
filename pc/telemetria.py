import struct
import csv
import argparse
import math
import json
import os
from jinja2 import Environment, FileSystemLoader

HOURS_OFFSET = 1  # 1 para invierno, 2 para verano en Madrid

def haversine_distance(lat1, lon1, lat2, lon2):
    R = 6371000.0
    dLat = math.radians(lat2 - lat1)
    dLon = math.radians(lon2 - lon1)
    a = math.sin(dLat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dLon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def process_bearings(bearings):
    if not bearings:
        return 0.0, 0.0, 0.0
    
    unwrapped = [bearings[0]]
    for b in bearings[1:]:
        diff = b - unwrapped[-1]
        if diff > 180:
            unwrapped.append(b - 360)
        elif diff < -180:
            unwrapped.append(b + 360)
        else:
            unwrapped.append(b)
            
    max_b = max(unwrapped) % 360.0
    min_b = min(unwrapped) % 360.0
    
    sin_sum = sum(math.sin(math.radians(b)) for b in bearings)
    cos_sum = sum(math.cos(math.radians(b)) for b in bearings)
    mean_b = math.degrees(math.atan2(sin_sum, cos_sum)) % 360.0
    
    return max_b, min_b, mean_b

def process_block(block, current_total_nm, blocks_list):
    if not block:
        return current_total_nm
    
    init_lat = block[0]['lat']
    init_lon = block[0]['lon']
    final_lat = block[-1]['lat']
    final_lon = block[-1]['lon']
    
    speeds = [item['speed'] for item in block if item['speed'] < 30.0]
    if not speeds:
        speeds = [0.0]
        
    max_v = max(speeds)
    mean_v = sum(speeds) / len(speeds)
    
    duration_ms = block[-1]['timestamp'] - block[0]['timestamp']
    duration_hours = (duration_ms / 3600000.0) if duration_ms > 0 else (len(block) / 3600.0)
    
    dist_nm = mean_v * duration_hours
    current_total_nm += dist_nm
    
    bearings = [item['course'] for item in block]
    max_b, min_b, mean_b = process_bearings(bearings)
    
    full_time = block[0]['time_str']
    hora_sin_seg = full_time[:5] if full_time and len(full_time) >= 5 else "00:00"
    timestamp = block[0]['timestamp']

    blocks_list.append({
        "timestamp": timestamp,
        "hora": hora_sin_seg,
        "init_lat": round(init_lat, 7),
        "init_lon": round(init_lon, 7),
        "final_lat": round(final_lat, 7),
        "final_lon": round(final_lon, 7),
        "max_v": round(max_v, 1),
        "mean_v": round(mean_v, 1),
        "dist_nm": round(dist_nm, 4),
        "cum_nm": round(current_total_nm, 4),
        "max_b": round(max_b, 1),
        "min_b": round(min_b, 1),
        "mean_b": round(mean_b, 1)
    })

    return current_total_nm

def analyze_and_export_telemetry(base_filename):
    if base_filename.lower().endswith(".bin"):
        base_filename = base_filename[:-4]
        
    base_filename = os.path.basename(base_filename)
        
    dir_telemetria = "telemetria"
    dir_resultados = "resultados"
    dir_ghp = "ghp"
    dir_templates = "templates"

    for folder in [dir_telemetria, dir_resultados, dir_ghp, dir_templates]:
        os.makedirs(folder, exist_ok=True)

    filename         = os.path.join(dir_telemetria, f"{base_filename}.bin")
    calib_csv_name   = os.path.join(dir_resultados, f"{base_filename}_calib.csv")
    imu_csv_name     = os.path.join(dir_resultados, f"{base_filename}_imu.csv")
    gps_raw_csv_name = os.path.join(dir_resultados, f"{base_filename}_gps_raw.csv")
    gps_kml_name     = os.path.join(dir_resultados, f"{base_filename}_gps_clean.kml")
    gps_html_name    = os.path.join(dir_ghp, f"{base_filename}_mapa.html")
    
    print(f"--- ANALIZANDO Y GENERANDO TELEMETRÍA: {filename} ---\n")
    
    packet_count = 0
    calib_count = 0
    imu_count = 0
    gps_count = 0
    gps_clean_count = 0
    
    max_speed = -1.0
    min_speed = float('inf')
    max_speed_time = "N/A"
    min_speed_time = "N/A"
    
    min_lat = float('inf')
    max_lat = float('-inf')
    min_lon = float('inf')
    max_lon = float('-inf')
    
    total_distance_meters = 0.0
    last_timestamp = None
    first_timestamp = None
    last_timestamp_session = None
    
    first_valid_local = None
    last_valid_local = None

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
        blocks_for_html = []

        with open(filename, "rb") as f, \
             open(calib_csv_name, "w", newline="", encoding="utf-8") as f_calib, \
             open(imu_csv_name, "w", newline="", encoding="utf-8") as f_imu, \
             open(gps_raw_csv_name, "w", newline="", encoding="utf-8") as f_raw:
            
            writer_calib = csv.writer(f_calib)
            writer_calib.writerow(["Tipo", "Firmware", "Muestras", "Val1", "Val2", "Val3", "Val4", "Val5", "Val6"])
            
            writer_imu = csv.writer(f_imu)
            writer_imu.writerow(["Timestamp_ms", "Ax", "Ay", "Az", "Mx", "My", "Mz"])
            
            writer_raw = csv.writer(f_raw)
            writer_raw.writerow(["Timestamp_ms", "Hora_Local", "Latitud", "Longitud", "Velocidad_nudos", "Rumbo", "Valido"])
            
            gps_block = []
            cumulative_nm = 0.0
            
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
                    
                    writer_raw.writerow([timestamp, display_time, f"{lat_deg:.7f}", f"{lon_deg:.7f}", f"{speed_knots:.1f}", f"{course_deg:.1f}", valid])
                    gps_count += 1
                    
                    if valid == 1:
                        if time_str:
                            if first_valid_local is None: first_valid_local = time_str
                            last_valid_local = time_str
                        
                        if speed_knots < 30.0:
                            if speed_knots > max_speed: max_speed, max_speed_time = speed_knots, display_time
                            if speed_knots < min_speed: min_speed, min_speed_time = speed_knots, display_time
                            
                        if lat_deg < min_lat: min_lat = lat_deg
                        if lat_deg > max_lat: max_lat = lat_deg
                        if lon_deg < min_lon: min_lon = lon_deg
                        if lon_deg > max_lon: max_lon = lon_deg
                        
                        if last_timestamp is not None:
                            delta_time_sec = (timestamp - last_timestamp) / 1000.0
                            if 0 < delta_time_sec < 10 and speed_knots < 30.0:
                                total_distance_meters += (speed_knots * 0.514444) * delta_time_sec
                        last_timestamp = timestamp
                        
                        gps_block.append({
                            'timestamp': timestamp,
                            'time_str': display_time,
                            'lat': lat_deg,
                            'lon': lon_deg,
                            'speed': speed_knots,
                            'course': course_deg
                        })
                        
                        if len(gps_block) == 60:
                            cumulative_nm = process_block(gps_block, cumulative_nm, blocks_for_html)
                            gps_clean_count += 1
                            gps_block = []
                else:
                    pass
                packet_count += 1

            if len(gps_block) > 0:
                cumulative_nm = process_block(gps_block, cumulative_nm, blocks_for_html)
                gps_clean_count += 1

        # Cargar entorno de Jinja2
        env = Environment(loader=FileSystemLoader("templates"))

        # 1. Generar KML usando plantilla externa
        kml_template = env.get_template("kml_template.xml")
        rendered_kml = kml_template.render(
            base_filename=base_filename,
            blocks_data=blocks_for_html
        )
        with open(gps_kml_name, "w", encoding="utf-8") as f_kml:
            f_kml.write(rendered_kml)

        # 2. Generar Mapa HTML usando plantilla externa
        html_template = env.get_template("map_template.html")
        rendered_html = html_template.render(
            base_filename=base_filename,
            blocks_json=json.dumps(blocks_for_html)
        )
        with open(gps_html_name, "w", encoding="utf-8") as f_html:
            f_html.write(rendered_html)

        # Calcular tiempo transcurrido
        elapsed_str = "00:00:00"
        if first_timestamp is not None and last_timestamp_session is not None:
            total_sec = max(0.0, (last_timestamp_session - first_timestamp) / 1000.0)
            elapsed_str = f"{int(total_sec // 3600):02d}:{int((total_sec % 3600) // 60):02d}:{int(total_sec % 60):02d}"

        # 3. Generar Informe Final de Consola usando plantilla externa
        report_template = env.get_template("report_template.txt")
        resumen = report_template.render(
            packet_count=packet_count,
            first_valid_local=first_valid_local or 'N/A',
            last_valid_local=last_valid_local or 'N/A',
            elapsed_str=elapsed_str,
            total_distance_km=total_distance_meters / 1000.0,
            total_distance_meters=total_distance_meters,
            max_speed=max_speed,
            max_speed_time=max_speed_time,
            min_speed=min_speed,
            min_speed_time=min_speed_time,
            calib_csv_name=calib_csv_name,
            calib_count=calib_count,
            imu_csv_name=imu_csv_name,
            imu_count=imu_count,
            gps_raw_csv_name=gps_raw_csv_name,
            gps_count=gps_count,
            gps_kml_name=gps_kml_name,
            gps_clean_count=gps_clean_count,
            gps_html_name=gps_html_name
        )
        print(resumen)

    except FileNotFoundError:
        print(f"[ERROR] No se pudo encontrar el fichero binario en '{filename}'.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Analizador y exportador de telemetría marina con Jinja2.")
    parser.add_argument("fichero", help="Nombre base del fichero binario (ej: telemetria_17)")
    args = parser.parse_args()
    analyze_and_export_telemetry(args.fichero)