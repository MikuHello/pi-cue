import fcntl
import json
import os
from pathlib import Path
import pty
import select
import signal
import struct
import termios
import time

root = Path(__file__).resolve().parent.parent
base = root / ".dev" / "performance" / str(time.time_ns())
results = []
for enabled in [False, True]:
    directory = base / ("with-pi-cue" if enabled else "baseline")
    for item in ["agent", "sessions", "workspace", "tmp", "cache"]:
        (directory / item).mkdir(parents=True, exist_ok=True)
    environment = dict(os.environ, TERM="xterm-256color", PI_CUE_PROBE_DIR=str(directory), PI_CODING_AGENT_DIR=str(directory / "agent"), TMPDIR=str(directory / "tmp"), TMP=str(directory / "tmp"), TEMP=str(directory / "tmp"), XDG_CACHE_HOME=str(directory / "cache"), NODE_COMPILE_CACHE=str(directory / "cache"), JITI_FS_CACHE="false", PI_TELEMETRY="0", PI_OFFLINE="1")
    command = ["node", str(root / "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"), "-ne", "-e", str(root / "tests/fixtures/idle-probe.ts"), "-ns", "-np", "--no-themes", "--no-mcp", "-nc", "--session-dir", str(directory / "sessions")]
    if enabled:
        command.extend(["-e", str(root / "index.ts")])
    pid, master = pty.fork()
    if pid == 0:
        os.chdir(directory / "workspace")
        os.execvpe(command[0], command, environment)
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
    deadline = time.monotonic() + 8
    exited = False
    while time.monotonic() < deadline:
        ready, _, _ = select.select([master], [], [], 0.05)
        if ready:
            try:
                os.read(master, 65536)
            except OSError:
                break
        waited, status = os.waitpid(pid, os.WNOHANG)
        if waited:
            exited = True
            break
    if not exited:
        try:
            os.kill(pid, signal.SIGTERM)
            os.waitpid(pid, 0)
        except (ProcessLookupError, ChildProcessError):
            pass
    os.close(master)
    result = json.loads((directory / "idle.json").read_text())
    results.append({"piCueLoaded": enabled, **result})
report = {"description": "Real Pi 1.4.0 idle window in controlled macOS PTY, one sample each; observational, not a benchmark guarantee", "results": results, "artifacts": str(base)}
(base / "result.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
