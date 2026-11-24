"""Change the EMI password and sign everyone out (rotates the session key). Values are never printed.

Usage: python set_password.py <new password>
Leaves BOT_SECRET alone, so the Discord bot keeps working.
"""
import hashlib
import secrets
import subprocess
import sys

password = sys.argv[1]
salt = secrets.token_bytes(16)
values = {
    "PASS_SALT": salt.hex(),
    "PASS_HASH": hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 2000).hex(),
    "SESSION_SECRET": secrets.token_urlsafe(48),  # new key = every existing sign-in stops working
}
for name, value in values.items():
    r = subprocess.run(f"npx wrangler secret put {name}", input=value, shell=True, capture_output=True,
                       text=True, encoding="utf-8", errors="replace")
    print(f"{name}: {'set' if r.returncode == 0 else 'FAILED'}")
    if r.returncode != 0:
        print((r.stderr or "")[-400:].replace(value, "<hidden>"))
        sys.exit(1)
