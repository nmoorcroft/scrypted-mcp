# scrypted-mcp

MCP server that exposes all Scrypted-managed cameras to Claude Code via the Model Context Protocol.

## What it does

Provides two MCP tools:
- `list_cameras` — returns all available camera IDs and names
- `get_camera_snapshot` — captures a live JPEG snapshot from any camera by ID and returns it as a base64 image

Images are captured by pulling a single frame from each camera's Scrypted Rebroadcast Plugin RTSP stream using ffmpeg.

## Architecture

```
Claude Code
    ↓ HTTPS POST /mcp
mcp.darktrain.co.uk  (nginx reverse proxy)
    ↓ HTTP
home NUC :9584  (scrypted-mcp Docker container)
    ↓ RTSP over TCP
Scrypted  (per-camera rebroadcast streams, High quality)
    ↓
Physical cameras
```

## MCP endpoint

- **Public URL:** `https://mcp.darktrain.co.uk/camera/mcp`
- **Transport:** Streamable HTTP (POST)
- **Internal port:** 9584

## Cameras

| Camera ID     | Name         | Scrypted Device ID |
|---------------|--------------|--------------------|
| back_garden   | Back Garden  | 30                 |
| doorbell      | Doorbell     | 31                 |
| front_drive   | Front Drive  | 26                 |
| kitchen       | Kitchen      | 28                 |
| side_gate     | Side Gate    | 29                 |
| utility_room  | Utility Room | 27                 |

RTSP URLs are stored as environment variables (`RTSP_<CAMERA_ID>`) in `/home/admin/docker/.env` on the NUC. Each camera has its own rebroadcast port and path key (High stream, `rtspServerPathKey-0`).

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
| Server port | 9584 |
| Network mode | host (shares NUC network namespace) |
| Timezone | Europe/London |
| RTSP stream quality | High (`rtspServerPathKey-0`) |
