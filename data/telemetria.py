import struct

def decode_telemetry(filename):
    print(f"--- ANALIZANDO FICHERO DE TELEMETRÍA: {filename} ---")
    
    with open(filename, "rb") as f:
        packet_count = 0
        while True:
            # Leer el byte identificador del tipo de paquete
            type_byte = f.read(1)
            if not type_byte:
                break
            
            packet_type = type_byte[0]
            
            if packet_type == 0x01:  # TYPE_CALIBRATION_ACCEL
                data = f.read(15)
                if len(data) < 15: 
                    break
                fw, samples, sum_ax, sum_ay, sum_az = struct.unpack("<B H i i i", data)
                print(f"[CALIB ACCEL] Firmware: {fw} | Muestras: {samples} | Sumas: X={sum_ax}, Y={sum_ay}, Z={sum_az}")
                
            elif packet_type == 0x02:  # TYPE_CALIBRATION_MAG
                data = f.read(13)
                if len(data) < 13: 
                    break
                fw, minx, maxx, miny, maxy, minz, maxz = struct.unpack("<B h h h h h h", data)
                print(f"[CALIB MAG] Firmware: {fw} | X:[{minx}, {maxx}] Y:[{miny}, {maxy}] Z:[{minz}, {maxz}]")
                
            elif packet_type == 0x03:  # TYPE_IMU_RAW
                data = f.read(16)
                if len(data) < 16: 
                    break
                timestamp, ax, ay, az, mx, my, mz = struct.unpack("<I h h h h h h", data)
                print(f"[IMU RAW] Tiempo: {timestamp} ms | Acel(Ax,Ay,Az): {ax}, {ay}, {az} | Mag(Mx,My,Mz): {mx}, {my}, {mz}")
                
            elif packet_type == 0x04:  # TYPE_GPS_RMC
                data = f.read(25)
                if len(data) < 25: 
                    break
                timestamp, gps_time, date, lat, lon, speed, course, valid = struct.unpack("<I I I i i H H B", data)
                
                # Deshacer factores de escala definidos en el firmware
                lat_deg = lat / 10000000.0
                lon_deg = lon / 10000000.0
                speed_knots = speed / 10.0
                course_deg = course / 10.0
                
                print(f"[GPS RMC] Tiempo ESP32: {timestamp}ms | Hora UTC: {gps_time} | Fecha: {date} | "
                      f"Lat: {lat_deg:.7f}° | Lon: {lon_deg:.7f}° | Vel: {speed_knots} nudos | Rumbo: {course_deg}° | Válido: {valid}")
            else:
                # Si se encuentra un byte desconocido, se avanza 1 byte para reintentar sincronización
                pass
                
            packet_count += 1
            
        print(f"\n--- ANÁLISIS FINALIZADO. Total de paquetes leídos: {packet_count} ---")

if __name__ == "__main__":
    # Reemplaza 'telemetria_11.bin' por la ruta de tu fichero si es necesario
    decode_telemetry("telemetria_11.bin")