# Athena Surveillance System (Project X)

Welcome to the Athena Surveillance System repository. This project consists of a Python/Flask backend for RTSP stream processing with YOLO object detection/tracking, and a React (Vite) frontend for a unified dashboard experience.

## Prerequisites

- **Python 3.8+** (for the backend)
- **Node.js 18+** & **npm** (for the frontend)

## Project Structure

- `Cam.py`: The main Flask backend application.
- `backend/`: Core stream processing, object tracking, and PTZ control logic.
- `frontend/`: The React-based user interface.
- `requirements.txt`: Python dependencies.

## 1. Backend Setup

The backend handles RTSP streams, YOLOv11 tracking, and camera PTZ controls.

### Installation

1. Open a terminal and navigate to the root directory of the project:
  

2. **Activate your Python Virtual Environment** (if you have one set up). 
   For Windows Command Prompt:
   ```cmd
   venv\Scripts\activate.bat
   ```
   For Windows PowerShell:
   ```powershell
   .\venv\Scripts\Activate.ps1
   ```

3. **Install the dependencies**:
   ```cmd
   pip install -r requirements.txt
   ```

### Running the Backend

Start the main Flask application by running:
```cmd
python Cam.py
```
The backend server will start on `http://0.0.0.0:5000`.

*(Note: The system requires the `yolo11s.pt` model file which is already in the root directory).*

---

## 2. Frontend Setup

The frontend is a React application built with Vite and TailwindCSS.

### Installation

1. Open a **new terminal** and navigate to the `frontend` folder:

2. **Install Node.js dependencies**:
   ```cmd
   npm install
   ```

### Running the Frontend

Start the Vite development server by running:
```cmd
npm run dev
```
This will launch the application, usually accessible at `http://localhost:5173` (check the terminal output for the exact local link).

---

## Testing / Utilities

There are several standalone scripts you can use for troubleshooting:

- **`findcam.py`**: A simple OpenCV script to verify RTSP stream connectivity for both cameras without running the full server. Run with `python findcam.py`.
- **`f.py`**: A minimal script for testing CP Plus standard RTSP paths.
- **`dahua_edge_test.py`**: Test script for extracting Edge AI metadata directly from Dahua cameras.
