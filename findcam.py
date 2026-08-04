import cv2
import threading
import os

# Force RTSP to use TCP instead of UDP to prevent timeout errors
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

# Replace with your actual credentials for the CP Plus cameras
USERNAME = "admin"
PASSWORD = "password"  # Update with your password
IP_CAM_1 = "192.168.1.58"
IP_CAM_2 = "192.168.1.158"

# Standard RTSP URL format for CP Plus cameras
# subtype=0 for main stream, subtype=1 for sub stream
RTSP_URL_1 = f"rtsp://{USERNAME}:{PASSWORD}@{IP_CAM_1}:554/cam/realmonitor?channel=1&subtype=1"
RTSP_URL_2 = f"rtsp://{USERNAME}:{PASSWORD}@{IP_CAM_2}:554/cam/realmonitor?channel=1&subtype=1"

class RTSPStream:
    def __init__(self, name, url):
        self.name = name
        self.url = url
        self.cap = cv2.VideoCapture(self.url)
        self.frame = None
        self.running = True
        
        if not self.cap.isOpened():
            print(f"Failed to open stream: {self.name} ({self.url})")
            
        self.thread = threading.Thread(target=self._update, daemon=True)
        self.thread.start()

    def _update(self):
        while self.running:
            if self.cap.isOpened():
                ret, frame = self.cap.read()
                if ret:
                    self.frame = frame
                else:
                    # Try to reconnect if stream drops
                    print(f"Stream dropped: {self.name}. Reconnecting...")
                    self.cap.release()
                    self.cap = cv2.VideoCapture(self.url)
                    cv2.waitKey(1000)

    def read(self):
        return self.frame

    def stop(self):
        self.running = False
        self.thread.join()
        if self.cap.isOpened():
            self.cap.release()

def main():
    print(f"Connecting to Camera 1: {IP_CAM_1}")
    print(f"Connecting to Camera 2: {IP_CAM_2}")
    
    stream1 = RTSPStream("Camera 1", RTSP_URL_1)
    stream2 = RTSPStream("Camera 2", RTSP_URL_2)

    print("Press 'q' to quit.")

    while True:
        frame1 = stream1.read()
        frame2 = stream2.read()

        if frame1 is not None:
            # Resize if needed to fit the screen
            frame1_resized = cv2.resize(frame1, (640, 360))
            cv2.imshow("Camera 1 - 192.168.1.58", frame1_resized)
            
        if frame2 is not None:
            frame2_resized = cv2.resize(frame2, (640, 360))
            cv2.imshow("Camera 2 - 192.168.1.158", frame2_resized)

        # Press 'q' to exit
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    stream1.stop()
    stream2.stop()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()
