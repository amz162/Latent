#!/usr/bin/env python3
"""
True daemon launcher for the Next.js dev server.

Uses double-fork + setsid to fully detach from this shell so the server
survives after the parent bash tool command returns.

The shell's process group gets SIGTERM/SIGKILL on shell exit, but a
double-forked daemon in its own session (new sid + new pgid) is no longer
in that process group, so it survives.
"""
import os
import sys
import time
import subprocess
import signal

PROJECT_DIR = "/home/z/my-project"
DEV_SH = os.path.join(PROJECT_DIR, ".zscripts/dev.sh")
LOG_FILE = os.path.join(PROJECT_DIR, "dev-start.log")
PID_FILE = os.path.join(PROJECT_DIR, ".zscripts/dev.pid")
READY_FILE = os.path.join(PROJECT_DIR, ".zscripts/dev.ready")


def write_pid_file(pid: int) -> None:
    try:
        with open(PID_FILE, "w") as f:
            f.write(str(pid))
    except Exception as e:
        sys.stderr.write(f"warn: could not write pid file {PID_FILE}: {e}\n")


def daemonize() -> int:
    """Classic double-fork. Returns the daemon child PID in the parent."""
    # First fork
    try:
        pid = os.fork()
    except OSError as e:
        sys.stderr.write(f"first fork failed: {e}\n")
        sys.exit(1)

    if pid > 0:
        # Parent: return child's pid (child will exit immediately after second fork).
        return pid

    # First child: become session leader (new sid, new pgid)
    os.setsid()

    # Second fork — the actual daemon. Its parent (first child) exits immediately,
    # so the daemon gets reparented to init (PID 1 = tini in this container).
    try:
        daemon_pid = os.fork()
    except OSError as e:
        sys.stderr.write(f"second fork failed: {e}\n")
        sys.exit(1)

    if daemon_pid > 0:
        # First child exits — this is what makes the daemon survive.
        os._exit(0)

    # === We are now the daemon ===
    # Reset umask, cd to project, close inherited fds, redirect stdio.
    os.umask(0o022)
    os.chdir(PROJECT_DIR)
    # Close stdin/stdout/stderr, reopen to log file
    sys.stdout.flush()
    sys.stderr.flush()
    devnull_fd = os.open("/dev/null", os.O_RDWR)
    log_fd = os.open(LOG_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    os.dup2(devnull_fd, 0)  # stdin <- /dev/null
    os.dup2(log_fd, 1)     # stdout -> log
    os.dup2(log_fd, 2)     # stderr -> log

    # Reset signal handlers to defaults (we want default SIGTERM handling,
    # not the parent's potentially-trapped versions).
    for sig in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM, signal.SIGPIPE):
        signal.signal(sig, signal.SIG_DFL)

    # Now actually launch dev.sh. We exec it so it becomes the daemon's
    # actual process — its parent is init (PID 1 = tini), so when this bash
    # shell exits, the process is NOT in our process group and survives.
    os.execv("/bin/bash", ["/bin/bash", DEV_SH])


def main() -> int:
    # Mark not-ready before launching
    try:
        os.remove(READY_FILE)
    except FileNotFoundError:
        pass

    daemon_pid = daemonize()

    # Parent: wait briefly to confirm the daemon's child (dev.sh) is alive
    print(f"Launched daemon. First-fork child pid was {daemon_pid}.")
    print("The actual Next.js process is a grandchild reparented to PID 1 (tini).")
    print("Waiting ~10s for dev.sh to spawn next dev...")

    for _ in range(20):
        time.sleep(0.5)

    # Inspect dev.log to see if next dev started
    try:
        with open(os.path.join(PROJECT_DIR, "dev.log")) as f:
            tail = f.read()[-2000:]
    except FileNotFoundError:
        tail = "(no dev.log yet)"

    print("---dev.log tail---")
    print(tail)
    print("---ps snapshot---")
    try:
        out = subprocess.run(
            ["ps", "-ef"],
            capture_output=True, text=True, timeout=5,
        ).stdout
        for line in out.splitlines():
            if any(k in line for k in ("next", "node", "dev.sh", "bun")) and "grep" not in line:
                print(line)
    except Exception as e:
        print(f"ps failed: {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
