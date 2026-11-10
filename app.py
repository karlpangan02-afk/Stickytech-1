"""StickyTech server with QR-code access.  Run:  python app.py   then open http://localhost:8000
Only people who scanned a valid QR code (made with make_codes.py) can open the app.
Each buyer gets their own private notes and schedule. Uses only the Python standard library."""
import json, os, secrets, threading, urllib.parse
from http.cookies import CookieError, SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
CODES = os.path.join(ROOT, "codes.json")   # the list of valid QR codes (private)
USERS = os.path.join(ROOT, "data")         # one private folder per buyer
STATIC = (".html", ".css", ".js", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico")
LOGO = "/StickyTech_Mascot_Logo.png"
lock = threading.Lock()


def load_codes():
    try:
        with open(CODES, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_codes(codes):
    tmp = CODES + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(codes, f, indent=2)
    os.replace(tmp, CODES)


def read_data(path):
    d = []
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                d = json.load(f)
        except ValueError:
            d = []
    if isinstance(d, list):  # older file: just a list of notes
        d = {"notes": d, "folders": None}
    return d


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        self.user = None
        super().__init__(*args, directory=ROOT, **kwargs)

    # ---------- helpers ----------
    def _json(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _page(self, title, msg, status=403):
        body = (
            "<!DOCTYPE html><html lang='en'><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            f"<title>{title}</title></head>"
            "<body style='font-family:system-ui,sans-serif;display:grid;place-items:center;"
            "min-height:100vh;margin:0;background:#f4f1ff;color:#2b2150;text-align:center;padding:24px'>"
            f"<div><img src='{LOGO}' alt='' style='max-width:220px;width:60%'>"
            f"<h1>{title}</h1><p>{msg}</p></div></body></html>"
        ).encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _cookie(self):
        try:
            c = SimpleCookie(self.headers.get("Cookie", "")).get("st_auth")
        except CookieError:
            return "", ""
        token, _, dev = (c.value if c else "").partition(".")
        return token, dev

    def _auth(self):
        """Return the buyer's record if this browser holds a valid, unrevoked pass."""
        token, dev = self._cookie()
        c = load_codes().get(token)
        if c and not c.get("revoked") and dev in c.get("devices", []):
            return c
        return None

    def _paths(self):
        d = os.path.join(USERS, self.user["id"])
        os.makedirs(d, exist_ok=True)
        return os.path.join(d, "notes.json"), os.path.join(d, "schedule.json")

    def _activate(self, token):
        """Opened by scanning the QR code: /a/<token>. Gives this browser a pass."""
        with lock:
            codes = load_codes()
            c = codes.get(token)
            if not c or c.get("revoked"):
                return self._page("Invalid QR code", "This code is not valid. Please contact the seller.")
            old_token, old_dev = self._cookie()
            dev = old_dev if (old_token == token and old_dev in c["devices"]) else None
            if dev is None:
                if len(c["devices"]) >= c.get("max_devices", 2):
                    return self._page("Code already used",
                                      "This QR code has reached its device limit. Please contact the seller.")
                dev = secrets.token_urlsafe(16)
                c["devices"].append(dev)
                save_codes(codes)
        cookie = f"st_auth={token}.{dev}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax"
        if self.headers.get("X-Forwarded-Proto") == "https":
            cookie += "; Secure"
        self.send_response(302)
        self.send_header("Location", "/")
        self.send_header("Set-Cookie", cookie)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    @staticmethod
    def _is_static(path):
        p = urllib.parse.unquote(path).strip("/")
        return p == "" or ("/" not in p and "\\" not in p and p.lower().endswith(STATIC))

    # ---------- routes ----------
    def do_HEAD(self):
        self.send_error(405)

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/a/"):
            return self._activate(path[3:])
        if path == LOGO:  # the lock screen needs the logo
            return super().do_GET()
        self.user = self._auth()
        if not self.user:
            if path.startswith("/api/"):
                return self._json({"error": "locked"}, 401)
            return self._page("Scan your QR code",
                              "This app is for buyers only. Scan the QR code you received to get in.")
        notes_path, sched_path = self._paths()
        if path == "/api/notes":
            d = read_data(notes_path)
            out = {"notes": d.get("notes") or []}
            if isinstance(d.get("folders"), list):
                out["folders"] = d["folders"]
            return self._json(out)
        if path == "/api/schedule":
            try:
                with open(sched_path, encoding="utf-8") as f:
                    return self._json(json.load(f))
            except (OSError, ValueError):
                return self._json({})
        if not self._is_static(path):
            return self.send_error(404)
        super().do_GET()

    def do_POST(self):
        self.user = self._auth()
        if not self.user:
            return self._json({"error": "locked"}, 401)
        notes_path, sched_path = self._paths()
        if self.path == "/api/schedule":
            try:
                size = int(self.headers.get("Content-Length", 0))
                assert size < 80_000_000
                p = json.loads(self.rfile.read(size))
                imgs, st = p.get("images", []), p.get("settings", {})
                assert isinstance(imgs, list) and len(imgs) <= 40 and isinstance(st, dict)
                clean = []
                for i in imgs:
                    assert isinstance(i, dict) and isinstance(i.get("src"), str) and i["src"].startswith("data:image/")
                    clean.append({
                        "id": str(i.get("id", ""))[:20],
                        "src": i["src"],
                        "name": str(i.get("name", ""))[:80],
                        "board": bool(i.get("board")),
                        "x": float(i.get("x") or 0), "y": float(i.get("y") or 0),
                        "w": float(i.get("w") or 240), "r": float(i.get("r") or 0),
                    })
            except (ValueError, TypeError, AssertionError, AttributeError):
                return self._json({"error": "Bad schedule data."}, 400)
            with open(sched_path, "w", encoding="utf-8") as f:
                json.dump({"images": clean, "settings": st}, f)
            return self._json({"saved": True})
        if self.path != "/api/notes":
            return self.send_error(404)
        try:
            size = int(self.headers.get("Content-Length", 0))
            assert size < 10_000_000
            p = json.loads(self.rfile.read(size))
            old = read_data(notes_path)
            if isinstance(p, list):
                data = {"notes": p[:200], "folders": old.get("folders")}
            else:
                assert isinstance(p, dict) and isinstance(p.get("notes"), list)
                fl = p.get("folders")
                data = {"notes": p["notes"][:200], "folders": fl[:50] if isinstance(fl, list) else old.get("folders")}
        except (ValueError, AssertionError):
            return self._json({"error": "Send a JSON list of notes."}, 400)
        with open(notes_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        self._json({"saved": len(data["notes"])})

    def log_message(self, *args):
        pass


def lan_ip():
    """This computer's address on the Wi-Fi, so a phone can open the app too."""
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


if __name__ == "__main__":
    print("StickyTech running at http://localhost:8000  (Ctrl+C to stop)")
    ip = lan_ip()
    if ip:
        print(f"On your phone (same Wi-Fi): http://{ip}:8000")
    ThreadingHTTPServer(("", 8000), Handler).serve_forever()
