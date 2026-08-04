import cv2

# Target IP found via your ARP table map
CAMERA_IP = "192.168.17.57"

# Constructing standard CP Plus RTSP path
# Default credentials for local stream setup are admin:admin
rtsp_url = f"rtsp://admin:admin@{CAMERA_IP}:554/cam/realmonitor?channel=1&subtype=0"

print(f"Connecting to CP Plus Z45Q at {CAMERA_IP}...")
cap = cv2.VideoCapture(rtsp_url)

if not cap.isOpened():
    print("\n[ERROR] Connection failed.")
    print("If it times out, verify that 'PC View' or 'ONVIF Switch' is turned ON inside your Ezykam+ mobile app settings.")
    exit()

print("\n[SUCCESS] Stream connected! Playing live feed...")
print("Click inside the video window and press 'q' to exit safely.")

while True:
    ret, frame = cap.read()
    if not ret:
        print("[WARNING] Frame dropped or stream interrupted.")
        break
        
    # Render the video frame
    cv2.imshow("CP Plus Z45Q Live View", frame)
    
    # Check for 'q' key press to break out
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

# Release the hardware components
cap.release()
cv2.destroyAllWindows()
print("Capture engine terminated.")