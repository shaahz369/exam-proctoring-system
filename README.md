# exam-proctoring-system

Scalable full-stack exam proctoring platform utilizing React, Node.js, and deep learning models (YOLO/ResNet) for real-time face monitoring and cheating detection.

## Modules
- Backend: Node.js / Express
- Frontend: React
- ML Service: Python (YOLO, ResNet18)

## Features
- Face detection
- Cheating detection
- Live monitoring

## How to Run

### Backend
cd exam-proctoring-backend
npm install
npm run dev

### ML Service
cd ml-service
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

### Frontend
cd online-exam-frontend
npm install
npm run dev


