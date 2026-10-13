# devops
- Features:
  - [pdf-reader](pdf-reader.md): container images, compose, migrations on startup (done)
  - [local-hosting](local-hosting.md): run on the owner's PC, private phone access via Tailscale (stack deployed; Tailscale pending)
- Principles:
  - Bind published ports to `127.0.0.1`; remote access only through Tailscale or a TLS proxy.
  - Never `docker compose down -v`: the volumes are the only copy of the data.
