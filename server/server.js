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

// Raw character → xdotool keysym name (fallback when client sends char, not code)
const CHAR_TO_XKEY = {
  ";": "semicolon",
  "'": "apostrophe",
  ",": "comma",
  ".": "period",
  "/": "slash",
  "\\": "backslash",
  "[": "bracketleft",
  "]": "bracketright",
  "`": "grave",
  "-": "minus",
  "=": "equal",
  " ": "space",
  // Shifted punctuation
  "?": "question",
  ":": "colon",
  '"': "quotedbl",
  "<": "less",
  ">": "greater",
  "{": "braceleft",
  "}": "braceright",
  "|": "bar",
  "~": "asciitilde",
  "!": "exclam",
  "@": "at",
  "#": "numbersign",
  "$": "dollar",
  "%": "percent",
  "^": "asciicircum",
  "&": "ampersand",
  "*": "asterisk",
  "(": "parenleft",
  ")": "parenright",
  "_": "underscore",
  "+": "plus",
};

// Keysyms that already represent shifted characters — don't add shift again
const SHIFTED_KEYSYMS = new Set([
  "question", "colon", "quotedbl", "less", "greater",
  "braceleft", "braceright", "bar", "asciitilde",
  "exclam", "at", "numbersign", "dollar", "percent",
  "asciicircum", "ampersand", "asterisk", "parenleft",
  "parenright", "underscore", "plus",
]);

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
    // Fallback: translate raw char to xdotool keysym name
    else if (msg.key && msg.key.length === 1) {
      xkey = CHAR_TO_XKEY[msg.key] || msg.key;
    } else {
      return null; // Unknown key, skip
    }
  }

  // Strip shift if the keysym already represents the shifted character
  const finalMods = SHIFTED_KEYSYMS.has(xkey)
    ? modifiers.filter((m) => m !== "shift")
    : modifiers;

  if (finalMods.length > 0) {
    return [...finalMods, xkey].join("+");
  }

  return xkey;
}

function sendKeystroke(combo) {
  const env = { ...process.env, DISPLAY, XAUTHORITY };
  const parts = combo.split("+");

  // For modifier combos, use explicit keydown/keyup sequence so X11 clients
  // (especially Electron/VSCode) see proper separate events
  if (parts.length > 1) {
    const modifiers = parts.slice(0, -1);
    const key = parts[parts.length - 1];
    const args = [];
    for (const mod of modifiers) args.push("keydown", mod);
    args.push("key", key);
    for (const mod of modifiers.reverse()) args.push("keyup", mod);
    execFile("xdotool", args, { env }, (err) => {
      if (err) console.error(`  xdotool error: ${err.message}`);
    });
  } else {
    execFile("xdotool", ["key", combo], { env }, (err) => {
      if (err) console.error(`  xdotool error: ${err.message}`);
    });
  }
}

// --- Mouse ---

function sendMouseMove(dx, dy) {
  const env = { ...process.env, DISPLAY, XAUTHORITY };
  execFile(
    "xdotool",
    ["mousemove_relative", "--", String(Math.round(dx)), String(Math.round(dy))],
    { env },
    (err) => {
      if (err) console.error(`  xdotool error: ${err.message}`);
    }
  );
}

function sendMouseClick(button) {
  const env = { ...process.env, DISPLAY, XAUTHORITY };
  execFile("xdotool", ["click", String(button)], { env }, (err) => {
    if (err) console.error(`  xdotool error: ${err.message}`);
  });
}

function sendScroll(dy) {
  const env = { ...process.env, DISPLAY, XAUTHORITY };
  // button 4 = scroll up, button 5 = scroll down
  const button = dy > 0 ? 4 : 5;
  const count = Math.abs(Math.round(dy)) || 1;
  execFile(
    "xdotool",
    ["click", "--repeat", String(count), String(button)],
    { env },
    (err) => {
      if (err) console.error(`  xdotool error: ${err.message}`);
    }
  );
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

    // --- Mouse events ---
    if (msg.type === "mousemove") {
      sendMouseMove(msg.dx, msg.dy);
      return;
    }
    if (msg.type === "click") {
      console.log(`  mouse: click ${msg.button}`);
      sendMouseClick(msg.button);
      return;
    }
    if (msg.type === "scroll") {
      sendScroll(msg.dy);
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
