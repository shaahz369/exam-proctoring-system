# ml-service/core/train_behavior_model.py
"""
Generates synthetic training data simulating normal vs cheating candidate
behavior, then trains the BehaviorLSTM model and saves weights.

Usage:
    cd ml-service
    python core/train_behavior_model.py
"""

import os
import sys
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

# Add parent directory to path so we can import from core/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from core.behavior_analyzer import BehaviorLSTM, SEQUENCE_LENGTH, NUM_FEATURES

# ── Config ─────────────────────────────────────────────────────────────────────
NUM_SAMPLES = 5000          # Total samples (balanced 50/50)
BATCH_SIZE = 64
EPOCHS = 30
LEARNING_RATE = 0.001
MODEL_SAVE_PATH = os.path.join(os.path.dirname(__file__), "..", "models", "behavior_lstm.pth")


# ── Synthetic Data Generator ──────────────────────────────────────────────────
def generate_normal_sample():
    """
    Simulates a normal (non-cheating) candidate:
    - person_count: always 1
    - phone_detected: always 0
    - gaze: mostly FOCUSED (95%+), occasional brief look away (1-2 frames max)
    - pitch/yaw: small variations around 0
    """
    seq = np.zeros((SEQUENCE_LENGTH, NUM_FEATURES), dtype=np.float32)

    for t in range(SEQUENCE_LENGTH):
        seq[t, 0] = 1.0 / 3.0       # person_count = 1
        seq[t, 1] = 0               # phone_detected = 0

        # Gaze: 95% focused, 5% random glance (not sustained)
        if np.random.random() < 0.95:
            seq[t, 2] = 1   # gaze_focused
        else:
            direction = np.random.choice([3, 4, 5, 6])  # left/right/up/down
            seq[t, direction] = 1

        seq[t, 7] = 0       # no_face = 0

        # Small pitch/yaw jitter (normalized roughly to [-1, 1] using /45.0)
        seq[t, 8] = np.clip(np.random.normal(0, 5) / 45.0, -1.0, 1.0)   # pitch
        seq[t, 9] = np.clip(np.random.normal(0, 5) / 45.0, -1.0, 1.0)   # yaw

    return seq


def generate_cheating_sample():
    """
    Simulates a suspicious (cheating) candidate using "bursty" patterns.
    Real-world cheating is short: showing a phone for 2 seconds (4 frames), etc.
    """
    # Start with a normal baseline
    seq = generate_normal_sample()
    
    # Decide which type of cheating to simulate
    cheat_type = np.random.choice(["phone", "multi_person", "gaze_away", "no_face"])
    
    # 1. Phone Cheat: Burst of 2-10 frames showing a phone
    if cheat_type == "phone":
        duration = np.random.randint(2, 11)
        start = np.random.randint(0, SEQUENCE_LENGTH - duration)
        for t in range(start, start + duration):
            seq[t, 1] = 1  # phone_detected = 1
            
    # 2. Multi-Person Cheat: Burst of 2-10 frames where a second person enters
    elif cheat_type == "multi_person":
        duration = np.random.randint(2, 11)
        start = np.random.randint(0, SEQUENCE_LENGTH - duration)
        for t in range(start, start + duration):
            seq[t, 0] = np.random.choice([2, 3]) / 3.0  # person_count > 1
            
    # 3. Sustained Gaze Away: Looking away continuously for 10-30 frames (5-15 seconds)
    elif cheat_type == "gaze_away":
        duration = np.random.randint(10, 31)
        start = np.random.randint(0, SEQUENCE_LENGTH - duration)
        direction = np.random.choice([3, 4, 5, 6]) # Pick one direction to stare
        for t in range(start, start + duration):
            seq[t, 2] = 0  # no longer focused
            # Clear other directions
            seq[t, 3:7] = 0
            seq[t, direction] = 1
            # Add larger pitch/yaw to match looking away (normalized using /45.0)
            seq[t, 8] = np.clip(np.random.normal(25 if direction in [5,6] else 0, 5) / 45.0, -1.0, 1.0)
            seq[t, 9] = np.clip(np.random.normal(25 if direction in [3,4] else 0, 5) / 45.0, -1.0, 1.0)
            
    # 4. No Face: Burst of 5-20 frames where candidate disappears
    elif cheat_type == "no_face":
        duration = np.random.randint(5, 21)
        start = np.random.randint(0, SEQUENCE_LENGTH - duration)
        for t in range(start, start + duration):
            seq[t, 7] = 1  # no_face = 1
            seq[t, 0] = 0  # person_count = 0

    return seq


def generate_dataset(num_samples):
    """Generate balanced dataset of normal and cheating samples."""
    X = []
    y = []

    half = num_samples // 2

    print(f"Generating {half} normal samples...")
    for _ in range(half):
        X.append(generate_normal_sample())
        y.append(0)

    print(f"Generating {half} cheating samples...")
    for _ in range(half):
        X.append(generate_cheating_sample())
        y.append(1)

    X = np.array(X, dtype=np.float32)
    y = np.array(y, dtype=np.float32)

    # Shuffle
    indices = np.random.permutation(len(X))
    X = X[indices]
    y = y[indices]

    return X, y


# ── Training ──────────────────────────────────────────────────────────────────
def train():
    print("=" * 60)
    print("  LSTM Behavior Model — Training")
    print("=" * 60)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    # Generate data
    X, y = generate_dataset(NUM_SAMPLES)

    # Split 80/20
    split = int(0.8 * len(X))
    X_train, X_val = X[:split], X[split:]
    y_train, y_val = y[:split], y[split:]

    print(f"Train: {len(X_train)} | Val: {len(X_val)}")

    # DataLoaders
    train_ds = TensorDataset(torch.tensor(X_train), torch.tensor(y_train))
    val_ds = TensorDataset(torch.tensor(X_val), torch.tensor(y_val))

    train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=BATCH_SIZE)

    # Model
    model = BehaviorLSTM().to(device)
    criterion = nn.BCELoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=LEARNING_RATE)

    print(f"\nModel parameters: {sum(p.numel() for p in model.parameters()):,}")
    print(f"Epochs: {EPOCHS} | Batch size: {BATCH_SIZE} | LR: {LEARNING_RATE}\n")

    best_val_acc = 0.0

    for epoch in range(1, EPOCHS + 1):
        # ── Train ──
        model.train()
        train_loss = 0.0
        train_correct = 0
        train_total = 0

        for X_batch, y_batch in train_loader:
            X_batch = X_batch.to(device)
            y_batch = y_batch.to(device).unsqueeze(1)

            optimizer.zero_grad()
            output = model(X_batch)
            loss = criterion(output, y_batch)
            loss.backward()
            optimizer.step()

            train_loss += loss.item() * len(X_batch)
            preds = (output > 0.5).float()
            train_correct += (preds == y_batch).sum().item()
            train_total += len(y_batch)

        train_loss /= train_total
        train_acc = train_correct / train_total * 100

        # ── Validate ──
        model.eval()
        val_loss = 0.0
        val_correct = 0
        val_total = 0

        with torch.no_grad():
            for X_batch, y_batch in val_loader:
                X_batch = X_batch.to(device)
                y_batch = y_batch.to(device).unsqueeze(1)

                output = model(X_batch)
                loss = criterion(output, y_batch)

                val_loss += loss.item() * len(X_batch)
                preds = (output > 0.5).float()
                val_correct += (preds == y_batch).sum().item()
                val_total += len(y_batch)

        val_loss /= val_total
        val_acc = val_correct / val_total * 100

        print(f"Epoch {epoch:02d}/{EPOCHS} | "
              f"Train Loss: {train_loss:.4f} Acc: {train_acc:.1f}% | "
              f"Val Loss: {val_loss:.4f} Acc: {val_acc:.1f}%")

        # Save best model
        if val_acc > best_val_acc:
            best_val_acc = val_acc
            os.makedirs(os.path.dirname(MODEL_SAVE_PATH), exist_ok=True)
            torch.save(model.state_dict(), MODEL_SAVE_PATH)

    print(f"\n✅ Training complete! Best val accuracy: {best_val_acc:.1f}%")
    print(f"✅ Model saved to: {MODEL_SAVE_PATH}")


if __name__ == "__main__":
    train()
