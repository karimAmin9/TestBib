# devops
- Features:
  - [pdf-reader](pdf-reader.md): container images, compose, migrations on startup (done)
  - [local-hosting](local-hosting.md): run on the owner's PC, private phone access via Tailscale (stack deployed; superseded by phone-app, Tailscale never set up)
  - [phone-app](phone-app.md): everything on the phone as an offline PWA on GitHub Pages, auto-deployed (planned; Phase 0 next)
- Principles:
  - Bind published ports to `127.0.0.1`; remote access only through Tailscale or a TLS proxy.
  - Never `docker compose down -v`: the volumes are the only copy of the data.
  - Every deploy runs the tests first; a failing test blocks the deploy.
