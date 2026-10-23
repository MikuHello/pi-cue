import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import signal
import struct
import termios
import time

root = Path(__file__).resolve().parent.parent
artifacts = root / ".dev" / "host-smoke"
artifacts.mkdir(parents=True, exist_ok=True)
test_root = artifacts / str(time.time_ns())
for name in ["agent", "sessions", "workspace", "tmp", "cache"]:
    (test_root / name).mkdir(parents=True)
environment = dict(os.environ, TERM="xterm-256color", PI_CODING_AGENT_DIR=str(test_root / "agent"), PI_CODING_AGENT_SESSION_DIR=str(test_root / "sessions"), TMPDIR=str(test_root / "tmp"), TMP=str(test_root / "tmp"), TEMP=str(test_root / "tmp"), XDG_CACHE_HOME=str(test_root / "cache"), NODE_COMPILE_CACHE=str(test_root / "cache"), JITI_FS_CACHE="false", PI_TELEMETRY="0", PI_OFFLINE="1")
command = ["node", str(root / "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"), "-ne", "-e", str(root / "index.ts"), "-ns", "-np", "--no-themes", "--no-mcp", "-nc", "--session-dir", str(test_root / "sessions"), "--tui-mode", "fullscreen"]
transcript = bytearray()
checks = []
pid, master = pty.fork()
if pid == 0:
    os.chdir(test_root / "workspace")
    os.execvpe(command[0], command, environment)
fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 36, 100, 0, 0))

def cleaned(data):
    text = data.decode("utf8", errors="replace")
    text = re.sub(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)", "", text)
    return re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", text)

def read_for(seconds):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        ready, _, _ = select.select([master], [], [], min(0.05, max(0, end - time.monotonic())))
        if ready:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                break
            if not chunk:
                break
            transcript.extend(chunk)

def send(data, wait=0.25):
    start = len(transcript)
    os.write(master, data)
    read_for(wait)
    return cleaned(transcript[start:])

status = None
forced = False
try:
    read_for(1.5)
    opened = send(b"/cue\r", 0.6)
    checks.append({"name": "native two-column settings open without credentials", "passed": "Auto reminders" in opened and "General" in opened and "Personal defaults" not in opened})
    send(b"\x1b")
    send(b"/cue debug\r")
    send(b"\x1b[O")
    diagnostics = send(b"\x1b[B" * 3 + b"\r")
    checks.append({"name": "synthetic FocusOut observed through real Pi input", "passed": "Observed focus: unfocused" in diagnostics})
    send(b"\x1b")
    send(b"\x1b[I")
    diagnostics = send(b"\r")
    checks.append({"name": "synthetic FocusIn observed through real Pi input", "passed": "Observed focus: focused" in diagnostics})
    send(b"\x1b")
    send(b"\x1b")
    send(b"/cue\r")
    send(b"\x1b[B\r\x1b[B ")
    configuration = test_root / "agent" / "pi-cue.json"
    project_configuration = test_root / "workspace" / ".pi" / "pi-cue.json"
    checks.append({"name": "Space language confirmation writes only the single isolated configuration", "passed": configuration.exists() and json.loads(configuration.read_text())["settings"] == {"language": "zh-CN"} and not project_configuration.exists()})
    send(b"\x1b")
    send(b"\x04", 0.5)
    waited, status = os.waitpid(pid, os.WNOHANG)
    checks.append({"name": "Esc closes settings and Ctrl+D exits native host", "passed": waited == pid and os.waitstatus_to_exitcode(status) == 0})
finally:
    if status is None or not any(item["name"] == "Esc closes settings and Ctrl+D exits native host" and item["passed"] for item in checks):
        try:
            forced = True
            os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
        except (ProcessLookupError, ChildProcessError):
            pass
    os.close(master)
    (test_root / "terminal.txt").write_text(cleaned(transcript))
    (test_root / "terminal.ansi").write_bytes(transcript)
    result = {"environment": "macOS / fullscreen controlled PTY 100x36; no physical terminal focus proof", "checks": checks, "forcedCleanup": forced, "artifacts": str(test_root)}
    (test_root / "result.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
if not all(item["passed"] for item in checks):
    raise SystemExit(1)
