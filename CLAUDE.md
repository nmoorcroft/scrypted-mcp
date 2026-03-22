# scrypted-mcp

MCP server that exposes a Scrypted-managed camera to Claude Code via the Model Context Protocol.

## What it does

Provides a single MCP tool — `get_kitchen_camera` — that captures a live JPEG snapshot from the kitchen camera and returns it as a base64 image. Claude can call this tool to visually inspect the kitchen (e.g. check on the dog, see if someone is home).

The image is captured by pulling a single frame from the Scrypted Rebroadcast Plugin's RTSP stream using ffmpeg.

## Architecture

```
Claude Code
    ↓ HTTPS POST /mcp
mcp.darktrain.co.uk  (nginx reverse proxy)
    ↓ HTTP
home NUC :9584  (scrypted-mcp Docker container)
    ↓ RTSP over TCP
Scrypted :40081  (rebroadcast stream for kitchen camera, device ID 28)
    ↓
Physical camera
```

## MCP endpoint

- **Public URL:** `https://mcp.darktrain.co.uk/mcp`
- **Transport:** Streamable HTTP (POST)
- **Internal port:** 9584

## Deployment

The container is built and run on the home NUC via docker compose alongside other home services (`/home/admin/docker/docker-compose.yml`).

```bash
./deploy.sh              # sync source + rebuild + restart + tail logs
./deploy.sh --build-only # sync files only, no restart
./deploy.sh --restart-only # rebuild/restart without syncing
```

The deploy script rsyncs source files to `admin@home:/home/admin/docker/volumes/scrypted-mcp/` and runs `docker compose up -d --build scrypted-mcp`.

## Key config

| Setting | Value |
|---|---|
| RTSP URL | `rtsp://localhost:40081/8fef854beb27bc16` |
| Scrypted device ID | 28 (kitchen camera) |
| RTSP path key | `mixin:28:rtspServerPathKey-0` |
| Server port | 9584 |
| Network mode | host (shares NUC network namespace) |
| Timezone | Europe/London |
