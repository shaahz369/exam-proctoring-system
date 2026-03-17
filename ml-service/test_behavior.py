import sys
import os
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core.behavior_analyzer import BehaviorAnalyzer

def test():
    analyzer = BehaviorAnalyzer()
    
    # 1. Normal short session
    normal = []
    # 20 frames of normal behavior
    for _ in range(20):
        normal.append([1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
    
    res = analyzer.predict(normal)
    print(f"Normal (20 frames): {res}")
    
    # 2. Continuous phone
    phone = []
    for _ in range(20):
        phone.append([1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
        
    res2 = analyzer.predict(phone)
    print(f"\nContinuous Phone (20 frames): {res2}")
    
    # 3. Burst Phone
    burst = []
    for t in range(20):
        if 5 <= t < 10:
            burst.append([1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
        else:
            burst.append([1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
            
    res3 = analyzer.predict(burst)
    print(f"\nBurst Phone (20 frames, 5 phone): {res3}")
    
    # 4. Long looking away
    look = []
    for t in range(50):
        look.append([1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 30.0, 30.0])
        
    res4 = analyzer.predict(look)
    print(f"\nLook away (50 frames left): {res4}")
    
    # 5. Full 120 frames cheating
    long_cheat = []
    for t in range(120):
        long_cheat.append([1.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 30.0, 30.0])
    res5 = analyzer.predict(long_cheat)
    print(f"\nMax cheating (120 frames phone+look away): {res5}")

if __name__ == "__main__":
    test()
