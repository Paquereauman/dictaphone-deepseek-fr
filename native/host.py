import json, socket, struct, subprocess, sys, os, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def up():
    s = socket.socket(); s.settimeout(0.5)
    try:
        s.connect(("127.0.0.1", 8765)); return True
    except OSError:
        return False
    finally:
        s.close()

def reply(o):
    b = json.dumps(o).encode()
    sys.stdout.buffer.write(struct.pack("<I", len(b)) + b); sys.stdout.buffer.flush()

n = sys.stdin.buffer.read(4)
if n:
    sys.stdin.buffer.read(struct.unpack("<I", n)[0])
if not up():
    env = dict(os.environ, PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
    py = os.path.join(ROOT, ".venv", "Scripts", "python.exe")
    subprocess.Popen([py, "-m", "server.app"], cwd=ROOT, env=env,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     creationflags=0x08000000 | 0x00000008 | 0x00000200)
    for _ in range(40):
        if up(): break
        time.sleep(0.25)
reply({"ok": up()})
