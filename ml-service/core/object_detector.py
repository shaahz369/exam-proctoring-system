# ml-service/core/object_detector.py
from ultralytics import YOLO

class ObjectDetector:
    def __init__(self, model_path=None):
        print(f"📦 Loading Object Detector (yolov8n pretrained)...")
        self.model = YOLO("yolov8n.pt")

        self.class_names = self.model.names
        print(f"✅ Classes loaded: {self.class_names}")

        # Higher person threshold reduces false "multiple persons" detections
        # Increased to 0.75 to be stricter about what counts as a person
        self.PERSON_CONF = 0.75
        
        # Phone threshold increased to 0.60 to heavily penalize false phone 
        # detections. It now requires high confidence to register as a phone.
        self.PHONE_CONF  = 0.65

    def predict(self, frame):
        """
        Runs inference on a single frame using a low base threshold,
        then filters per class using per-class thresholds.
        """
        results = self.model.predict(frame, conf=0.20, verbose=False)

        person_count = 0
        phone_detected = False

        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0])
                label = self.class_names[cls_id]
                confidence = float(box.conf[0])

                if label == 'person':
                    if confidence >= self.PERSON_CONF:
                        person_count += 1

                elif label in ['cell phone', 'phone', 'mobile']:
                    if confidence >= self.PHONE_CONF:
                        phone_detected = True

        return {
            "person_count": person_count,
            "phone_detected": phone_detected
        }