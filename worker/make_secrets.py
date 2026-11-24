"""Generate the Worker secrets and push them with wrangler (values are never printed).

Usage: python make_secrets.py <password> <bot-secret-output-file>
Writes the bot secret to the given file so it can be copied into the bot's .env.
"""
import hashlib
import secrets
import subprocess
import sys

password, bot_file = sys.argv[1], sys.argv[2]
salt = secrets.token_bytes(16)
values = {
    "PASS_SALT": salt.hex(),
    "PASS_HASH": hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 2000).hex(),
    "SESSION_SECRET": secrets.token_urlsafe(48),
    "BOT_SECRET": secrets.token_urlsafe(48),
}
for name, value in values.items():
    r = subprocess.run(f"npx wrangler secret put {name}", input=value, text=True, shell=True,
                       capture_output=True)
    ok = r.returncode == 0
    print(f"{name}: {'set' if ok else 'FAILED'}")
    if not ok:
        print(r.stderr[-500:].replace(value, "<hidden>"))
        sys.exit(1)
with open(bot_file, "w", encoding="utf-8") as f:
    f.write(values["BOT_SECRET"])
print("bot secret saved for the bot's .env")
