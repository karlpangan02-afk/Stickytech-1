"""Make and manage QR codes for your buyers.

  python make_codes.py add "Juan" "Maria" --url https://yoursite.com
  python make_codes.py add "Juan" --url https://yoursite.com --devices 3
  python make_codes.py list
  python make_codes.py reset "Juan"     (buyer got a new phone: lets them scan again)
  python make_codes.py revoke "Juan"    (turns that QR off for good)

QR images are saved in the qr_codes folder. Needs:  pip install "qrcode[pil]"
"""
import argparse, json, os, re, secrets, sys, time

ROOT = os.path.dirname(os.path.abspath(__file__))
CODES = os.path.join(ROOT, "codes.json")
OUT = os.path.join(ROOT, "qr_codes")


def load():
    try:
        with open(CODES, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save(codes):
    tmp = CODES + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(codes, f, indent=2)
    os.replace(tmp, CODES)


def find(codes, label):
    for token, c in codes.items():
        if c["label"].lower() == label.lower():
            return token, c
    sys.exit(f'No buyer named "{label}". Run "python make_codes.py list" to see names.')


def cmd_add(a):
    try:
        import qrcode
    except ImportError:
        qrcode = None
        print('Tip: run  pip install "qrcode[pil]"  to get QR images. Links are shown below meanwhile.\n')
    codes = load()
    os.makedirs(OUT, exist_ok=True)
    for label in a.names:
        if any(c["label"].lower() == label.lower() for c in codes.values()):
            print(f'Skipped "{label}": that name already exists (use a different name).')
            continue
        token = secrets.token_urlsafe(16)
        codes[token] = {"id": secrets.token_hex(8), "label": label, "max_devices": a.devices,
                        "devices": [], "revoked": False, "created": time.strftime("%Y-%m-%d %H:%M")}
        link = f"{a.url.rstrip('/')}/a/{token}"
        print(f"{label}: {link}")
        if qrcode:
            name = re.sub(r"[^\w\- ]", "", label).strip() or codes[token]["id"]
            qrcode.make(link).save(os.path.join(OUT, f"{name}.png"))
    save(codes)
    if qrcode:
        print(f"\nQR images saved in: {OUT}")
    print("Keep these QR images private. Give each one only to the person who paid.")


def cmd_list(_):
    codes = load()
    if not codes:
        print("No codes yet.")
    for c in codes.values():
        state = "REVOKED" if c.get("revoked") else "active"
        print(f'{c["label"]:<20} devices {len(c["devices"])}/{c["max_devices"]}   {state}   {c.get("created", "")}')


def cmd_reset(a):
    codes = load()
    _, c = find(codes, a.name)
    c["devices"] = []
    save(codes)
    print(f'"{a.name}" can scan their QR again.')


def cmd_revoke(a):
    codes = load()
    _, c = find(codes, a.name)
    c["revoked"] = True
    save(codes)
    print(f'"{a.name}" is now blocked.')


p = argparse.ArgumentParser(description="Manage StickyTech QR codes")
sub = p.add_subparsers(dest="cmd", required=True)
s = sub.add_parser("add"); s.add_argument("names", nargs="+")
s.add_argument("--url", required=True, help="your website address, e.g. https://yoursite.com")
s.add_argument("--devices", type=int, default=2, help="how many phones/computers one QR may be used on")
s.set_defaults(f=cmd_add)
sub.add_parser("list").set_defaults(f=cmd_list)
for n, f in (("reset", cmd_reset), ("revoke", cmd_revoke)):
    s = sub.add_parser(n); s.add_argument("name"); s.set_defaults(f=f)
a = p.parse_args()
a.f(a)
