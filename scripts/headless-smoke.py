import json
import os
from pathlib import Path
import select
import subprocess
import time

root = Path(__file__).resolve().parent.parent
base = root / ".dev" / "headless-smoke" / str(time.time_ns())
results = []
for name, flags, unsupported in [(name, flags, unsupported) for name, flags in [("print", ["--print"]), ("json", ["--mode", "json"]), ("rpc", ["--mode", "rpc"]), ("no-tty", [])] for unsupported in [False, True]]:
    directory = base / (name + ("-unsupported-override" if unsupported else "-enabled-integrations"))
    for item in ["agent", "sessions", "workspace", "tmp", "cache"]:
        (directory / item).mkdir(parents=True, exist_ok=True)
    (directory / "agent" / "pi-cue.json").write_text(json.dumps({"schemaVersion": 1, "settings": {"headlessNotifications": unsupported, "enabled": True, "notifyOnAsk": True, "subagentNotifications": True}}))
    environment = dict(os.environ, PI_CUE_PROBE_DIR=str(directory), PI_CODING_AGENT_DIR=str(directory / "agent"), PI_CODING_AGENT_SESSION_DIR=str(directory / "sessions"), TMPDIR=str(directory / "tmp"), TMP=str(directory / "tmp"), TEMP=str(directory / "tmp"), XDG_CACHE_HOME=str(directory / "cache"), NODE_COMPILE_CACHE=str(directory / "cache"), JITI_FS_CACHE="false", PI_TELEMETRY="0", PI_OFFLINE="1")
    command = ["node", str(root / "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"), "-ne", "-e", str(root / "index.ts"), "-e", str(root / "tests/fixtures/local-provider.ts"), "-ns", "-np", "--no-themes", "--no-mcp", "-nc", "--session-dir", str(directory / "sessions"), "--model", "pi-cue-local/fixture", *flags]
    if name != "rpc":
        command.append("Complete the local fixture")
    process = subprocess.Popen(command, cwd=directory / "workspace", env=environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if name == "rpc":
        process.stdin.write(b'{"id":"fixture","type":"prompt","message":"Complete the local fixture"}\n')
        process.stdin.flush()
    else:
        process.stdin.close()
        process.stdin = None
    deadline = time.monotonic() + 15
    stdout = bytearray()
    stderr = bytearray()
    while process.poll() is None and time.monotonic() < deadline:
        readable, _, _ = select.select([process.stdout, process.stderr], [], [], 0.05)
        for stream in readable:
            chunk = os.read(stream.fileno(), 65536)
            (stdout if stream is process.stdout else stderr).extend(chunk)
    if process.poll() is None:
        process.terminate()
    tail_out, tail_error = process.communicate(timeout=3)
    stdout.extend(tail_out)
    stderr.extend(tail_error)
    (directory / "stdout.txt").write_bytes(stdout)
    (directory / "stderr.txt").write_bytes(stderr)
    trace_path = directory / "trace.json"
    trace = json.loads(trace_path.read_text()) if trace_path.exists() else {}
    call_path = directory / "external-calls.json"
    final_calls = json.loads(call_path.read_text()) if call_path.exists() else []
    passed = process.returncode == 0 and trace.get("events") == ["agent_start", "tool_execution_start", "probe_ask_blocked", "probe_subagent_events", "tool_execution_end", "agent_end", "agent_settled"] and final_calls == [] and b"\x1b" not in stdout and b"\x07" not in stdout and b"extension_ui_request" not in stdout
    results.append({"name": name, "unsupportedHeadlessOverride": unsupported, "passed": passed, "exit": process.returncode, "trace": trace, "finalExternalCalls": final_calls, "stdoutBytes": len(stdout), "stderrBytes": len(stderr)})
report = {"type": "real Pi 1.4.0 lifecycle with local deterministic provider, no network or credentials", "results": results, "artifacts": str(base)}
(base / "result.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
if not all(item["passed"] for item in results):
    raise SystemExit(1)
