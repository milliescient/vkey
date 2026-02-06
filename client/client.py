#!/usr/bin/env python3
"""
vkeyboard client — a tkinter app that captures keystrokes and sends them
over WebSocket to the vkeyboard server running on a remote Linux machine.

Only sends keystrokes when the window is focused.

Usage:
    ./setup.sh client        # one-time setup (creates venv, installs deps)
    source .venv/bin/activate
    python3 client.py [host:port]
"""

import sys
import json
import threading
import asyncio
import tkinter as tk
from tkinter import font as tkfont

try:
    import websockets
    from websockets.asyncio.client import connect as ws_connect
except ImportError:
    print("Missing dependency. Run:  pip3 install websockets")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Key mapping: tkinter keysym → browser-style code (what the server expects)
# ---------------------------------------------------------------------------

KEYSYM_TO_CODE = {
    "Up": "ArrowUp",
    "Down": "ArrowDown",
    "Left": "ArrowLeft",
    "Right": "ArrowRight",
    "Home": "Home",
    "End": "End",
    "Prior": "PageUp",
    "Next": "PageDown",
    "BackSpace": "Backspace",
    "Delete": "Delete",
    "Return": "Enter",
    "Tab": "Tab",
    "Escape": "Escape",
    "space": "Space",
    "F1": "F1",
    "F2": "F2",
    "F3": "F3",
    "F4": "F4",
    "F5": "F5",
    "F6": "F6",
    "F7": "F7",
    "F8": "F8",
    "F9": "F9",
    "F10": "F10",
    "F11": "F11",
    "F12": "F12",
    "bracketleft": "BracketLeft",
    "bracketright": "BracketRight",
    "backslash": "Backslash",
    "semicolon": "Semicolon",
    "apostrophe": "Quote",
    "comma": "Comma",
    "period": "Period",
    "slash": "Slash",
    "grave": "Backquote",
    "minus": "Minus",
    "equal": "Equal",
}

# Modifier keysyms to ignore as standalone key events
MODIFIER_KEYSYMS = {
    "Shift_L", "Shift_R",
    "Control_L", "Control_R",
    "Alt_L", "Alt_R",
    "Meta_L", "Meta_R",
    "Super_L", "Super_R",
}


def keysym_to_code(keysym, char):
    """Convert a tkinter keysym to a browser-style KeyboardEvent.code."""
    if keysym in KEYSYM_TO_CODE:
        return KEYSYM_TO_CODE[keysym]
    # Letter keys
    if len(keysym) == 1 and keysym.isalpha():
        return f"Key{keysym.upper()}"
    # Digit keys
    if len(keysym) == 1 and keysym.isdigit():
        return f"Digit{keysym}"
    # If the char is printable and single, use keysym as-is (server will handle)
    if char and len(char) == 1 and char.isprintable():
        return f"Key{char.upper()}" if char.isalpha() else None
    return None


# ---------------------------------------------------------------------------
# Async WebSocket transport
# ---------------------------------------------------------------------------

class JsonTransport:
    """Manages an async WebSocket connection on a background thread."""

    def __init__(self):
        self._ws = None
        self._loop = None
        self._thread = None
        self._url = None
        self.connected = False
        self.on_status_change = None  # callback(connected: bool)

    def start(self, url):
        self._url = url
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self):
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        self._loop.run_until_complete(self._connect_loop())

    async def _connect_loop(self):
        while True:
            try:
                async with ws_connect(self._url) as ws:
                    self._ws = ws
                    self.connected = True
                    if self.on_status_change:
                        self.on_status_change(True)
                    # Keep-alive: just wait for close
                    try:
                        await ws.recv()
                    except websockets.ConnectionClosed:
                        pass
            except (OSError, websockets.WebSocketException):
                pass
            finally:
                self._ws = None
                self.connected = False
                if self.on_status_change:
                    self.on_status_change(False)
            # Retry after a short delay
            await asyncio.sleep(1)

    def send(self, obj):
        ws = self._ws
        if ws and self._loop:
            asyncio.run_coroutine_threadsafe(self._send(ws, obj), self._loop)

    async def _send(self, ws, obj):
        try:
            await ws.send(json.dumps(obj))
        except Exception:
            pass

    def disconnect(self):
        ws = self._ws
        if ws and self._loop:
            asyncio.run_coroutine_threadsafe(ws.close(), self._loop)


# ---------------------------------------------------------------------------
# GUI
# ---------------------------------------------------------------------------

class VKeyboardApp:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("vkeyboard")
        self.root.geometry("540x380")
        self.root.configure(bg="#1e1e1e")
        self.root.resizable(True, True)

        self.transport = JsonTransport()
        self.transport.on_status_change = self._on_status_change

        self._build_ui()
        self._bind_keys()

    def _build_ui(self):
        r = self.root

        # -- Top bar: connection controls --
        top = tk.Frame(r, bg="#1e1e1e", padx=10, pady=8)
        top.pack(fill=tk.X)

        mono = tkfont.Font(family="Menlo", size=13)
        small = tkfont.Font(family="Menlo", size=11)

        tk.Label(top, text="Server", fg="#888", bg="#1e1e1e", font=small).pack(
            side=tk.LEFT
        )

        default_host = "192.168.1.85:9876"
        if len(sys.argv) > 1:
            default_host = sys.argv[1]

        self.host_var = tk.StringVar(value=default_host)
        self.host_entry = tk.Entry(
            top,
            textvariable=self.host_var,
            font=mono,
            width=22,
            bg="#2d2d2d",
            fg="#e0e0e0",
            insertbackground="#e0e0e0",
            relief=tk.FLAT,
            highlightthickness=1,
            highlightbackground="#444",
            highlightcolor="#007acc",
        )
        self.host_entry.pack(side=tk.LEFT, padx=(6, 8))

        self.connect_btn = tk.Button(
            top,
            text="Connect",
            font=small,
            bg="#007acc",
            fg="white",
            activebackground="#005f99",
            activeforeground="white",
            relief=tk.FLAT,
            padx=12,
            pady=2,
            command=self._toggle_connection,
        )
        self.connect_btn.pack(side=tk.LEFT)

        # Status dot
        self.status_canvas = tk.Canvas(
            top, width=14, height=14, bg="#1e1e1e", highlightthickness=0
        )
        self.status_canvas.pack(side=tk.LEFT, padx=(10, 0))
        self.status_dot = self.status_canvas.create_oval(2, 2, 12, 12, fill="#555")

        self.status_label = tk.Label(
            top, text="Disconnected", fg="#888", bg="#1e1e1e", font=small
        )
        self.status_label.pack(side=tk.LEFT, padx=(4, 0))

        # -- Separator --
        sep = tk.Frame(r, bg="#333", height=1)
        sep.pack(fill=tk.X)

        # -- Typing surface --
        self.text = tk.Text(
            r,
            font=mono,
            bg="#1e1e1e",
            fg="#d4d4d4",
            insertbackground="#d4d4d4",
            relief=tk.FLAT,
            padx=12,
            pady=10,
            wrap=tk.WORD,
            highlightthickness=0,
            borderwidth=0,
        )
        self.text.pack(fill=tk.BOTH, expand=True)
        self.text.insert("1.0", "")
        self.text.focus_set()

        # Placeholder
        self._show_placeholder()

        # -- Bottom bar --
        bottom = tk.Frame(r, bg="#252526", padx=10, pady=4)
        bottom.pack(fill=tk.X, side=tk.BOTTOM)

        self.info_label = tk.Label(
            bottom,
            text="Type here when connected. Cmd maps to Ctrl on remote.",
            fg="#666",
            bg="#252526",
            font=tkfont.Font(family="Menlo", size=10),
        )
        self.info_label.pack(side=tk.LEFT)

        # Clear button
        tk.Button(
            bottom,
            text="Clear",
            font=tkfont.Font(family="Menlo", size=10),
            bg="#333",
            fg="#aaa",
            activebackground="#444",
            activeforeground="#ccc",
            relief=tk.FLAT,
            padx=8,
            command=self._clear_text,
        ).pack(side=tk.RIGHT)

    def _show_placeholder(self):
        if not self.text.get("1.0", "end-1c"):
            self.text.insert("1.0", "Start typing here...")
            self.text.config(fg="#555")
            self._has_placeholder = True
        else:
            self._has_placeholder = False

    def _clear_placeholder(self):
        if getattr(self, "_has_placeholder", False):
            self.text.delete("1.0", tk.END)
            self.text.config(fg="#d4d4d4")
            self._has_placeholder = False

    def _clear_text(self):
        self.text.delete("1.0", tk.END)
        self._show_placeholder()
        self.text.focus_set()

    def _bind_keys(self):
        # Bind to the text widget so it only fires when the window is focused
        self.text.bind("<KeyPress>", self._on_key_press)
        # Prevent default text widget behavior for modifier combos
        # so we don't get stray characters
        for mod in ("Command", "Control"):
            for ch in "acvxzspfnbdewrtyhkl/":
                self.text.bind(f"<{mod}-{ch}>", self._on_key_press)
                self.text.bind(f"<{mod}-Shift-{ch}>", self._on_key_press)

    def _on_key_press(self, event):
        self._clear_placeholder()

        keysym = event.keysym
        char = event.char

        # Skip pure modifier presses
        if keysym in MODIFIER_KEYSYMS:
            return

        # Detect modifiers from event.state bitmask
        state = event.state
        shift = bool(state & 0x1)
        # On macOS: 0x4 = Control, 0x8 = Command (Meta)
        ctrl = bool(state & 0x4)
        meta = bool(state & 0x8)   # Command key on Mac
        alt = bool(state & 0x10)   # Option key on Mac

        code = keysym_to_code(keysym, char)
        if not code:
            return

        msg = {
            "type": "keydown",
            "key": char if (char and char.isprintable()) else keysym,
            "code": code,
            "shift": shift,
            "ctrl": ctrl,
            "alt": alt,
            "meta": meta,
        }

        self.transport.send(msg)

        # Visual feedback: show the character in the text widget
        # For modifier combos, show a label like [Cmd+S]
        if meta or ctrl or alt:
            parts = []
            if meta:
                parts.append("Cmd")
            if ctrl:
                parts.append("Ctrl")
            if alt:
                parts.append("Alt")
            if shift:
                parts.append("Shift")
            parts.append(keysym.upper() if len(keysym) == 1 else keysym)
            label = "+".join(parts)
            self.text.insert(tk.END, f"[{label}]")
            self.text.see(tk.END)
            return "break"  # Don't insert the raw char

        # For normal printable chars, let tkinter's default insert them
        # For special keys (arrows, etc.), show nothing extra
        if keysym in KEYSYM_TO_CODE and keysym not in ("space",):
            return "break"

        # Let normal characters through to the text widget naturally
        return None

    def _toggle_connection(self):
        if self.transport.connected:
            self.transport.disconnect()
        else:
            host = self.host_var.get().strip()
            if not host:
                return
            if "://" not in host:
                host = f"ws://{host}"
            self.transport.start(host)
            self.status_label.config(text="Connecting...", fg="#ccaa00")

    def _on_status_change(self, connected):
        # This is called from the async thread; schedule UI update
        self.root.after(0, self._update_status, connected)

    def _update_status(self, connected):
        if connected:
            self.status_canvas.itemconfig(self.status_dot, fill="#3c3")
            self.status_label.config(text="Connected", fg="#3c3")
            self.connect_btn.config(text="Disconnect", bg="#6c2020")
        else:
            self.status_canvas.itemconfig(self.status_dot, fill="#555")
            self.status_label.config(text="Disconnected", fg="#888")
            self.connect_btn.config(text="Connect", bg="#007acc")

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    app = VKeyboardApp()
    app.run()
