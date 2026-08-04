import requests
from requests.auth import HTTPDigestAuth
import json

CAMERA_IP = "192.168.6.199"
USERNAME = "admin"
PASSWORD = "Rishi@2004"

def test_dahua_events():
    # Removing specific 'codes' usually subscribes to ALL events on Dahua/CP Plus cameras
    url = f"http://{CAMERA_IP}/cgi-bin/eventManager.cgi?action=attach"
    print(f"Connecting to {url} (Listening for ALL events)...")
    
    try:
        response = requests.get(
            url, 
            auth=HTTPDigestAuth(USERNAME, PASSWORD), 
            stream=True, 
            timeout=(5, None)
        )
        
        if response.status_code != 200:
            print(f"Failed to connect. Status code: {response.status_code}")
            return

        print("Connected! Listening for anything the camera says...")
        
        for line in response.iter_lines():
            if line:
                decoded = line.decode('utf-8').strip()
                if "Code=" in decoded or "{" in decoded:
                    print(f"\nRAW EVENT: {decoded}")
                    
    except KeyboardInterrupt:
        print("\nStopped.")

if __name__ == "__main__":
    test_dahua_events()
