# scrypted-mcp

MCP server that exposes all Scrypted-managed cameras to Claude Code via the Model Context Protocol.

## What it does

Provides four MCP tools:
- `list_cameras` — returns all available camera IDs and names
- `get_camera_snapshot` — captures a live JPEG snapshot from any camera by ID and returns it as a base64 image
- `list_events` — lists recent Unifi-detected events (person, animal, vehicle, etc.) with timestamps
- `get_event_snapshot` — retrieves the stored snapshot for a specific event

Images are captured by pulling a single frame from each camera's Scrypted Rebroadcast Plugin RTSP stream using ffmpeg.

## Unifi webhook integration

Unifi automations call `GET /camera/webhook?camera=<camera_id>&event=<event_type>` when something interesting is detected. The server captures and stores a snapshot at that moment.

- **Webhook URL format:** `https://mcp.darktrain.co.uk/camera/webhook?camera=back_garden&event=person`
- Snapshots stored in `/app/snapshots/` inside the container (lost on rebuild — add a volume for persistence)
- Capped at 100 events (oldest auto-deleted)

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
