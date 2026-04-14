import os
import torch
import torch.nn as nn
import numpy as np
import librosa
import sounddevice as sd
import warnings

# Suppress librosa warnings for a clean terminal
warnings.filterwarnings('ignore')

class AudioCNN(nn.Module):
    def __init__(self):
        super(AudioCNN, self).__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(1, 32, 3, padding=1), nn.BatchNorm2d(32), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(32, 64, 3, padding=1), nn.BatchNorm2d(64), nn.ReLU(), nn.MaxPool2d(2)
        )
        self.fc = nn.Sequential(
            nn.Flatten(),
            nn.Linear(64 * 16 * 8, 128),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(128, 2)
        )

    def forward(self, x):
        return self.fc(self.conv(x))

class AudioProctor:
    def __init__(self, model_path=None):
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model = AudioCNN().to(self.device)
        
        # --- DYNAMIC PATH RESOLUTION ---
        if model_path is None:
            # Gets the directory where this file (audio_proctor.py) is located
            current_dir = os.path.dirname(os.path.abspath(__file__))
            # Traverses up one level, then into models/
            model_path = os.path.join(current_dir, "..", "models", "audio_detection_model.pt")
            model_path = os.path.normpath(model_path)
            
        print(f"Loading Audio Model from: {model_path}")
        
        try:
            self.model.load_state_dict(torch.load(model_path, map_location=self.device))
            self.model.eval()
        except FileNotFoundError:
            print(f"❌ Error: Model not found at {model_path}")
            exit()
            
        self.sample_rate = 16000
        self.duration = 10  # 5-second processing blocks
        
        # --- UI STATE VARIABLES ---
        # These are read by main.py to draw the UI
        self.audio_label = "Initializing..."
        self.audio_color = (0, 255, 255) # Yellow
        self.stream = None

    def _audio_callback(self, indata, frames, time_info, status):
        """Runs continuously in a background thread."""
        if status: return
        
        try:
            audio = indata.flatten().astype(np.float32)
            
            speech_count = 0
            total_volume = 0.0
            
            # Process each 1-second chunk
            for i in range(self.duration):
                start = i * self.sample_rate
                end = start + self.sample_rate
                segment = audio[start:end]
                
                if len(segment) < self.sample_rate: continue
                
                peak_volume = np.max(np.abs(segment))
                total_volume += peak_volume
                
                # PER-CHUNK FAN FILTER
                if peak_volume < 0.035:
                    continue
                    
                mel_spec = librosa.feature.melspectrogram(y=segment, sr=self.sample_rate, n_mels=64)
                mel_db = librosa.power_to_db(mel_spec, ref=np.max, top_db=40)
                
                db_range = mel_db.max() - mel_db.min()
                mel_db = (mel_db - mel_db.min()) / db_range if db_range > 0 else mel_db - mel_db.min()
                
                tensor = torch.tensor(mel_db).unsqueeze(0).unsqueeze(0).to(self.device)
                
                with torch.no_grad():
                    probs = torch.softmax(self.model(tensor), dim=1)
                    pred = probs.argmax(dim=1).item()
                    conf = probs[0][pred].item()
                    
                if pred == 1 and conf > 0.75:
                    speech_count += 1
                    
            # --- FINAL DECISION & UI UPDATE ---
            avg_volume = total_volume / self.duration
            
            # GLOBAL FAN FILTER
            if avg_volume < 0.04:
                self.audio_label = "Quiet (Fan Filtered)"
                self.audio_color = (0, 255, 0) # Green (BGR)
            elif speech_count >= 3:
                self.audio_label = "🚨 Speech Detected!"
                self.audio_color = (0, 0, 255) # Red (BGR)
            else:
                self.audio_label = "Ambient Noise"
                self.audio_color = (0, 255, 255) # Yellow (BGR)
                
        except Exception as e:
            pass # Fail silently in the thread to prevent crashing the webcam

    def start_listening(self):
        """Starts the microphone stream non-blocking."""
        self.stream = sd.InputStream(
            samplerate=self.sample_rate,
            channels=1,
            callback=self._audio_callback,
            blocksize=self.sample_rate * self.duration
        )
        self.stream.start()
        print("✅ Audio Proctoring Module Online.")

    def stop_listening(self):
        """Safely shuts down the microphone."""
        if self.stream:
            self.stream.stop()
            self.stream.close()