# 효과음 생성기. numpy로 합성해 audio/*.wav 를 만든다 (외부 사이트에서 받지 않는다).
# 실행: python3 tools/make_sfx.py  →  그 다음 ffmpeg로 mp3 변환 (tools/encode_sfx.sh)
import numpy as np, wave, os, math
SR = 22050
OUT = os.path.join(os.path.dirname(__file__), '..', 'audio')
rng = np.random.default_rng(7)

def t(sec): return np.arange(int(SR * sec)) / SR
def env(n, a=0.002, d=0.1, s=0.0, r=0.1, sr=SR):
    """ADSR. n: 샘플 수"""
    a_n, d_n, r_n = int(a*sr), int(d*sr), int(r*sr)
    s_n = max(0, n - a_n - d_n - r_n)
    e = np.concatenate([np.linspace(0, 1, a_n), np.linspace(1, s, d_n), np.full(s_n, s), np.linspace(s, 0, r_n)])
    return e[:n] if len(e) >= n else np.pad(e, (0, n - len(e)))
def noise(sec): return rng.uniform(-1, 1, int(SR * sec))
def lowpass(x, cutoff):
    """1차 저역통과. cutoff: 배열(시간에 따라 변함) 또는 숫자"""
    y = np.zeros_like(x); c = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    alpha = 1 - np.exp(-2 * np.pi * c / SR)
    acc = 0.0
    for i in range(len(x)):
        acc += alpha[i] * (x[i] - acc); y[i] = acc
    return y
def highpass(x, cutoff): return x - lowpass(x, cutoff)
def sweep(f0, f1, sec, shape='exp'):
    tt = t(sec)
    f = f0 * (f1 / f0) ** (tt / sec) if shape == 'exp' else f0 + (f1 - f0) * tt / sec
    return np.sin(2 * np.pi * np.cumsum(f) / SR)
def sat(x, drive=2.0): return np.tanh(x * drive) / math.tanh(drive)
def mix(*parts):
    n = max(len(p) for p in parts); out = np.zeros(n)
    for p in parts: out[:len(p)] += p
    return out
def delay_at(x, sec, gain=1.0):
    return np.concatenate([np.zeros(int(SR * sec)), x * gain])
def normalize(x, peak=0.95):
    m = np.max(np.abs(x)) or 1; return x / m * peak
def save(name, x):
    x = normalize(x); x = (x * 32767).astype(np.int16)
    with wave.open(os.path.join(OUT, name + '.wav'), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(x.tobytes())
    print('wrote', name, f'{len(x)/SR:.2f}s')

def thud(sec=0.18, f0=140, f1=50, click=True):
    body = sweep(f0, f1, sec) * env(int(SR*sec), 0.001, sec*0.5, 0.0, sec*0.4)
    out = body
    if click: out = mix(out, lowpass(noise(0.02), 4000) * env(int(SR*0.02), 0.0005, 0.01, 0, 0.008) * 0.8)
    return sat(out, 2.5)

def explosion(sec=0.6, sub_f=(90, 35), sub_len=0.5, cutoff=(4500, 120), crackle=0.3, drive=3.0):
    n = int(SR * sec)
    cut = cutoff[0] * (cutoff[1] / cutoff[0]) ** (np.arange(n) / n)
    nz = noise(sec); n = len(nz); cut = cut[:n] if len(cut) >= n else np.pad(cut, (0, n - len(cut)), 'edge')
    body = lowpass(nz, cut) * env(n, 0.002, sec * 0.35, 0.15, sec * 0.6)
    sub = sweep(sub_f[0], sub_f[1], sub_len) * env(int(SR*sub_len), 0.002, sub_len*0.6, 0.0, sub_len*0.4) * 1.3
    cr = noise(sec * 0.4)
    crack = highpass(cr, 2500) * env(len(cr), 0.001, 0.05, 0.2, sec*0.3) * crackle
    return sat(mix(body, sub, crack), drive)

def laser(sec=0.22, f0=2200, f1=260):
    core = sweep(f0, f1, sec) * env(int(SR*sec), 0.002, sec*0.5, 0.3, sec*0.4)
    fm = np.sin(2*np.pi*np.cumsum(sweep(f0*1.01, f1*1.01, sec)*0+ (f0*(f1/f0)**(t(sec)/sec)))/SR * 1.0)
    hz = noise(sec); hiss = highpass(hz, 3000) * env(len(hz), 0.001, 0.05, 0.1, sec*0.5) * 0.25
    return sat(mix(core, fm * 0.4, hiss), 2.0)

def zap(sec=0.14):
    n = int(SR*sec)
    buzz = np.sign(np.sin(2*np.pi*np.cumsum(sweep(900, 180, sec)*0 + (900*(180/900)**(t(sec)/sec)))/SR)) * env(n, 0.001, sec*0.4, 0.2, sec*0.5)
    cz = noise(sec); crack = highpass(cz, 1800) * env(len(cz), 0.0005, 0.03, 0.3, sec*0.6)
    return sat(mix(buzz * 0.6, crack), 2.5)

def tone(freq, sec, wave_='tri', a=0.005, d=0.1, s=0.5, r=0.15, vib=0.0):
    tt = t(sec)
    f = freq * (1 + vib * np.sin(2*np.pi*6*tt))
    ph = 2*np.pi*np.cumsum(f)/SR
    if wave_ == 'tri': x = 2/np.pi*np.arcsin(np.sin(ph))
    elif wave_ == 'sq': x = np.sign(np.sin(ph)) * 0.6
    elif wave_ == 'saw': x = 2*((ph/(2*np.pi)) % 1) - 1
    else: x = np.sin(ph)
    x = x + 0.35*np.sin(2*ph) + 0.15*np.sin(3*ph)  # 배음
    return x * env(len(tt), a, d, s, r)

def chord_hit(freqs, sec=0.5):
    return sat(mix(*[tone(f, sec, 'tri', 0.003, 0.15, 0.4, 0.3) for f in freqs]), 1.8)

def arpeggio(freqs, step=0.09, sec=0.45, wave_='sq'):
    parts = [delay_at(tone(f, sec, wave_, 0.003, 0.12, 0.5, 0.25), i*step) for i, f in enumerate(freqs)]
    return sat(mix(*parts), 1.6)

def shimmer(sec=0.8):
    s = np.zeros(int(SR*sec))
    for k in range(14):
        f = rng.uniform(2000, 6000); st = rng.uniform(0, sec*0.6); ln = 0.12
        s = mix(s, delay_at(tone(f, ln, 'sin', 0.002, 0.05, 0.3, 0.06) * 0.25, st))
    return s[:int(SR*sec)]

# ---------- 소리 목록 ----------
save('place', thud(0.16, 160, 55))                                             # 블럭 놓기
save('clear1', explosion(0.55, (110, 38), 0.45, (5000, 140), 0.35, 3.0))        # 한 줄
save('clear2', mix(explosion(0.75, (100, 32), 0.6, (6000, 110), 0.45, 3.5), delay_at(chord_hit([523, 659, 784], 0.4) * 0.5, 0.03)))
save('clear3', mix(explosion(0.95, (95, 28), 0.8, (7000, 90), 0.55, 4.0), delay_at(chord_hit([523, 659, 784, 1047], 0.5) * 0.55, 0.03), delay_at(laser(0.3, 2600, 220) * 0.5, 0.02)))
save('clear4', mix(explosion(1.3, (90, 24), 1.0, (8000, 70), 0.7, 5.0), delay_at(explosion(0.7, (80, 30), 0.5, (3000, 100), 0.4, 4.0) * 0.8, 0.18),
                   delay_at(chord_hit([659, 784, 988, 1319], 0.7) * 0.6, 0.05), delay_at(shimmer(0.9) * 0.6, 0.1)))
save('laser', laser(0.24, 2400, 240))                                          # 레이저 스윕
save('bolt', zap(0.15))                                                        # 번개
save('bomb', mix(thud(0.05, 300, 120), delay_at(explosion(1.4, (70, 22), 1.2, (9000, 60), 0.8, 6.0), 0.02), delay_at(laser(0.35, 3000, 200) * 0.45, 0.04)))
save('chain', mix(explosion(0.9, (85, 26), 0.7, (7000, 80), 0.6, 5.0), delay_at(tone(880, 0.35, 'tri', 0.002, 0.1, 0.5, 0.2) * 0.6, 0.0), delay_at(tone(1320, 0.4, 'tri', 0.002, 0.1, 0.5, 0.25) * 0.5, 0.07)))
save('mega', mix(explosion(1.8, (60, 18), 1.5, (9000, 50), 0.9, 7.0), delay_at(explosion(1.0, (90, 30), 0.8, (5000, 90), 0.6, 5.0), 0.25),
                 delay_at(arpeggio([523, 659, 784, 1047, 1319], 0.07, 0.5) * 0.7, 0.05), delay_at(shimmer(1.2) * 0.7, 0.2)))
save('fuse', mix(*[delay_at(highpass(noise(0.012), 3000) * env(int(SR*0.012), 0.0005, 0.005, 0.2, 0.006) * 0.8, i*0.075) for i in range(4)]))
save('charge', mix(sat(sweep(300, 1800, 0.35, 'exp') * env(int(SR*0.35), 0.005, 0.1, 0.6, 0.15), 1.5), delay_at(tone(1760, 0.3, 'tri', 0.002, 0.08, 0.4, 0.2) * 0.6, 0.3)))
save('combo', mix(highpass(noise(0.18), 1500) * env(int(SR*0.18), 0.002, 0.06, 0.2, 0.1) * 0.5, delay_at(tone(1046, 0.25, 'tri', 0.002, 0.08, 0.4, 0.15), 0.04)))
save('levelup', mix(arpeggio([523, 659, 784, 1047], 0.1, 0.55, 'sq'), delay_at(chord_hit([1047, 1319, 1568], 0.8) * 0.7, 0.4), delay_at(shimmer(1.0) * 0.5, 0.35), delay_at(explosion(0.6, (100, 40), 0.4, (3000, 150), 0.2, 2.5) * 0.5, 0.0)))
save('perfect', mix(arpeggio([659, 784, 988, 1319, 1568, 2093], 0.08, 0.6, 'tri'), delay_at(chord_hit([1319, 1568, 2093], 1.0) * 0.8, 0.5), delay_at(shimmer(1.4) * 0.8, 0.3), delay_at(explosion(0.8, (90, 35), 0.6, (4000, 120), 0.3, 3.0) * 0.6, 0.45)))
save('refresh', mix(sat(sweep(1200, 400, 0.25) * env(int(SR*0.25), 0.003, 0.1, 0.3, 0.12), 1.4) * 0.7, lowpass(noise(0.25), 2500) * env(int(SR*0.25), 0.002, 0.08, 0.2, 0.15) * 0.5))
save('stuck', mix(tone(220, 0.35, 'saw', 0.005, 0.1, 0.6, 0.2) * 0.6, tone(233, 0.35, 'saw', 0.005, 0.1, 0.6, 0.2) * 0.6))
save('gameover', arpeggio([784, 659, 523, 392], 0.16, 0.6, 'tri'))
save('record', mix(arpeggio([523, 659, 784, 1047, 1319], 0.09, 0.6, 'sq'), delay_at(shimmer(1.0) * 0.6, 0.3)))
save('achieve', mix(tone(1319, 0.3, 'tri', 0.002, 0.08, 0.4, 0.2), delay_at(tone(1760, 0.4, 'tri', 0.002, 0.08, 0.4, 0.3), 0.1), delay_at(shimmer(0.6) * 0.4, 0.05)))
save('mission', mix(arpeggio([880, 1109, 1319], 0.08, 0.4, 'tri'), delay_at(shimmer(0.5) * 0.4, 0.15)))
save('login', mix(arpeggio([523, 784, 1047], 0.08, 0.5, 'tri'), delay_at(shimmer(0.6) * 0.4, 0.2)))
save('pass', mix(sat(sweep(600, 1500, 0.2, 'exp') * env(int(SR*0.2), 0.003, 0.08, 0.4, 0.1), 1.4) * 0.6, delay_at(tone(1568, 0.3, 'tri', 0.002, 0.08, 0.4, 0.2) * 0.6, 0.18)))
