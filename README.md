# EMI

A private, one-chat Discord-style website for talking with emi. Everything you say here shows up in
the emi Discord DM (as "Xiaole: ...") and everything said on Discord shows up here.

- `docs/` - the website (GitHub Pages). Plain HTML/CSS/JS, no build step.
- `worker/` - the Cloudflare Worker + D1 database behind it (login, messages, images, sync).

Messages, images, and the password check live in Cloudflare, not in this repo. The password is only
stored there as a salted hash.

Local design mode with fake data: serve `docs/` and open `http://localhost:8080/?mock`.
