const { WebSocketServer } = require("ws");
const { execFile } = require("child_process");

const { readdirSync, existsSync } = require("fs");

const PORT = parseInt(process.env.PORT || "9876", 10);

// Auto-detect X11 display from /tmp/.X11-unix if not set
function detectDisplay() {
  if (process.env.DISPLAY) return process.env.DISPLAY;
  try {
    const sockets = readdirSync("/tmp/.X11-unix");
    const num = sockets.find((s) => s.startsWith("X"));
    if (num) return `:${num.slice(1)}`;
  } catch {}
  return ":0";
}

// Auto-detect Xauthority file if not set
function detectXauthority() {
  if (process.env.XAUTHORITY) return process.env.XAUTHORITY;
  const uid = process.getuid?.() ?? 1000;
  const candidates = [
    `/run/user/${uid}/gdm/Xauthority`,
    `${process.env.HOME}/.Xauthority`,
    `/var/run/lightdm/${process.env.USER}/xauthority`,
  ];
  return candidates.find((p) => existsSync(p)) || "";
}

const DISPLAY = detectDisplay();
const XAUTHORITY = detectXauthority();

// Map browser KeyboardEvent.code / key values to xdotool key names
const KEY_MAP = {
  // Navigation
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "Prior",
  PageDown: "Next",

  // Editing
  Backspace: "BackSpace",
  Delete: "Delete",
  Enter: "Return",
  Tab: "Tab",
  Escape: "Escape",

  // Whitespace
  Space: "space",

  // Modifiers (handled separately, but listed for reference)
  ShiftLeft: "Shift_L",
  ShiftRight: "Shift_R",
  ControlLeft: "Control_L",
  ControlRight: "Control_R",
  AltLeft: "Alt_L",
  AltRight: "Alt_R",
  MetaLeft: "Super_L",
  MetaRight: "Super_R",

  // Function keys
  F1: "F1",
  F2: "F2",
  F3: "F3",
  F4: "F4",
  F5: "F5",
  F6: "F6",
  F7: "F7",
  F8: "F8",
  F9: "F9",
  F10: "F10",
  F11: "F11",
  F12: "F12",

  // Punctuation that xdotool needs as names
  BracketLeft: "bracketleft",
  BracketRight: "bracketright",
  Backslash: "backslash",
  Semicolon: "semicolon",
  Quote: "apostrophe",
  Comma: "comma",
  Period: "period",
  Slash: "slash",
  Backquote: "grave",
  Minus: "minus",
  Equal: "equal",
};

// Modifier-only codes we should ignore as standalone keystrokes
const MODIFIER_CODES = new Set([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

function buildXdotoolKey(msg) {
  // Skip modifier-only presses
  if (MODIFIER_CODES.has(msg.code)) return null;

  const parts = [];

  // The client maps Mac Cmd → meta=true, which we treat as Ctrl on Linux
  if (msg.meta) parts.push("ctrl");
  if (msg.ctrl) parts.push("ctrl");
  if (msg.alt) parts.push("alt");
  if (msg.shift) parts.push("shift");

  // Deduplicate ctrl if both meta and ctrl were somehow set
  const modifiers = [...new Set(parts)];

  // Resolve the key name
  let xkey = KEY_MAP[msg.code];

  if (!xkey) {
    // For letter keys (KeyA-KeyZ), use lowercase letter
    if (msg.code && msg.code.startsWith("Key")) {
      xkey = msg.code.slice(3).toLowerCase();
    }
    // For digit keys (Digit0-Digit9)
    else if (msg.code && msg.code.startsWith("Digit")) {
      xkey = msg.code.slice(5);
    }
    // Fallback: use the key value directly if it's a single char
    else if (msg.key && msg.key.length === 1) {
      xkey = msg.key;
    } else {
      return null; // Unknown key, skip
    }
  }

  // If there are modifiers, use xdotool key with combo notation
  if (modifiers.length > 0) {
    return [...modifiers, xkey].join("+");
  }

  return xkey;
}

function sendKeystroke(combo) {
  // For single printable chars with no modifiers, use 'xdotool key' too
  // (xdotool type has issues with special chars and doesn't work for shortcuts)
  const env = { ...process.env, DISPLAY, XAUTHORITY };
  execFile("xdotool", ["key", "--clearmodifiers", combo], { env }, (err) => {
    if (err) {
      console.error(`  xdotool error: ${err.message}`);
    }
  });
}

// --- Server ---

const wss = new WebSocketServer({ host: "0.0.0.0", port: PORT });

console.log(`vkeyboard server listening on 0.0.0.0:${PORT}`);
console.log(`Using X11 display: ${DISPLAY}${XAUTHORITY ? `, auth: ${XAUTHORITY}` : ""}`);
console.log("Waiting for connections...\n");

wss.on("connection", (ws, req) => {
  const addr = req.socket.remoteAddress;
  console.log(`Client connected: ${addr}`);

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
      return;
    }

    if (msg.type !== "keydown") return;

    const combo = buildXdotoolKey(msg);
    if (!combo) return;

    const modStr = [
      msg.meta ? "Cmd" : "",
      msg.ctrl ? "Ctrl" : "",
      msg.alt ? "Alt" : "",
      msg.shift ? "Shift" : "",
    ]
      .filter(Boolean)
      .join("+");

    console.log(
      `  key: ${modStr ? modStr + "+" : ""}${msg.key}  →  xdotool key ${combo}`
    );
    sendKeystroke(combo);
  });

  ws.on("close", () => {
    console.log(`Client disconnected: ${addr}`);
  });
});
