import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { execFile } from "child_process";
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { z } from "zod";

const PORT = 9584;
const SNAPSHOTS_DIR = "/app/snapshots";
const EVENTS_FILE = join(SNAPSHOTS_DIR, "events.json");
const MAX_EVENTS = 100;

// Camera definitions — RTSP URLs injected via environment variables
const CAMERAS = {
  back_garden:  { name: "Back Garden",  rtsp: process.env.RTSP_BACK_GARDEN,  description: "Shows the back garden: patio with a dining table in the foreground, lawn beyond, fields in the distance. The sunroom bifold doors are visible. The dog is often seen running around in the garden." },
  doorbell:     { name: "Doorbell",     rtsp: process.env.RTSP_DOORBELL,     description: "Mounted at the front door, showing the front driveway from the house side. Visitors are clearly visible as they approach the front door." },
  front_drive:  { name: "Front Drive",  rtsp: process.env.RTSP_FRONT_DRIVE,  description: "Shows the front driveway with two garage doors. When the family is home, three cars are parked here: Neil's BMW i4 furthest from the house, Cat's BMW 1 Series in the middle, and Lottie's Renault Zoe closest to the house. The public road is visible beyond the driveway." },
  kitchen:      { name: "Kitchen",      rtsp: process.env.RTSP_KITCHEN,      description: "Despite the name, this camera does NOT show the cooking area (which is around the corner to the right and out of frame). It shows the sunroom in the foreground and the dining room beyond. The sunroom has a sofa, the dog's pen, and her bed where she sleeps at night and when the family is out. NOTE: inside the pen there is a dog bed and a blanket scrunched up on the floor beside it — do not mistake these for Saffie; she is a large dog and unmistakable when present. The dining table is where the family eats. On the left is a door to the utility room, on the right a door to the hall. The bifold doors leading to the back garden patio are also visible." },
  side_gate:    { name: "Side Gate",    rtsp: process.env.RTSP_SIDE_GATE,    description: "Shows the side passage running between the front and back of the property. The utility room back door is visible mid-way along the path when open. The bins are also visible. Behind the camera is the side gate that leads to the front driveway. The far end of the passage opens into the back garden." },
  utility_room: { name: "Utility Room", rtsp: process.env.RTSP_UTILITY_ROOM, description: "Shows the utility room. On the right is the back door which has a cat flap; through the door leads to the dining room. Cat food is often visible on the floor. On the left is a worktop used for laundry, preparing pet food, and similar tasks. NOTE: there is a pig-shaped doorstop that is sometimes used to hold the utility room door open — it can easily be mistaken for a cat, but it is not." },
};

const missing = Object.entries(CAMERAS).filter(([, c]) => !c.rtsp).map(([k]) => `RTSP_${k.toUpperCase()}`);
if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);

// Ensure snapshots directory exists and load event index
mkdirSync(SNAPSHOTS_DIR, { recursive: true });
let events = [];
if (existsSync(EVENTS_FILE)) {
  try { events = JSON.parse(readFileSync(EVENTS_FILE, "utf8")); } catch {}
}

function saveEventIndex() {
  writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2));
}

function captureSnapshot(rtspUrl) {
  return new Promise((resolve, reject) => {
    const tmpFile = join(tmpdir(), `snap_${Date.now()}.jpg`);
    execFile(
      "ffmpeg",
      ["-rtsp_transport", "tcp", "-i", rtspUrl,
       "-frames:v", "1", "-q:v", "5", "-update", "1", tmpFile, "-y"],
      { timeout: 15000 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(`ffmpeg failed: ${stderr.slice(-500)}`));
          return;
        }
        try {
          const data = readFileSync(tmpFile);
          try { unlinkSync(tmpFile); } catch {}
          resolve(data);
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

const app = express();
app.use(express.json());

// Webhook endpoint — called by Unifi automations when an event is detected.
// URL format: /webhook?camera=<camera_id>&event=<event_type>
// e.g. /webhook?camera=back_garden&event=person
app.get("/webhook", async (req, res) => {
  const { camera: cameraId, event: eventType = "unknown" } = req.query;

  if (!cameraId || !CAMERAS[cameraId]) {
    console.warn(`Webhook: unknown camera "${cameraId}"`);
    return res.status(400).json({ error: `Unknown camera: ${cameraId}. Available: ${Object.keys(CAMERAS).join(", ")}` });
  }

  const camera = CAMERAS[cameraId];
  const timestamp = new Date().toISOString();
  const safeTs = timestamp.replace(/[:.]/g, "-");
  const filename = `${safeTs}_${cameraId}_${eventType}.jpg`;
  const filepath = join(SNAPSHOTS_DIR, filename);

  try {
    const imageBuffer = await captureSnapshot(camera.rtsp);
    writeFileSync(filepath, imageBuffer);

    const ev = { id: filename, timestamp, camera: cameraId, cameraName: camera.name, event: eventType };
    events.unshift(ev);

    // Trim to MAX_EVENTS, deleting old snapshot files
    if (events.length > MAX_EVENTS) {
      const removed = events.splice(MAX_EVENTS);
      for (const old of removed) {
        try { unlinkSync(join(SNAPSHOTS_DIR, old.id)); } catch {}
      }
    }

    saveEventIndex();
    console.log(`Webhook: ${eventType} on ${camera.name} — saved ${filename}`);
    res.json({ ok: true, event: ev });
  } catch (err) {
    console.error(`Webhook snapshot failed for ${camera.name}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.post("/mcp", async (req, res) => {
  const server = new McpServer({ name: "scrypted-cameras", version: "2.0.0" });

  // List all available cameras
  server.tool(
    "list_cameras",
    "List all available cameras by name and ID.",
    {},
    async () => ({
      content: [{
        type: "text",
        text: Object.entries(CAMERAS)
          .map(([id, c]) => `${id}: ${c.name} — ${c.description}`)
          .join("\n")
      }]
    })
  );

  // Get a snapshot from a specific camera
  server.tool(
    "get_camera_snapshot",
    "Get a live snapshot from a camera. Use list_cameras first to see available camera IDs. Household members who may appear in images: Neil (adult male, homeowner, medium-length dark brown hair worn loose to the collar, trimmed dark beard with some grey, medium build, often wears an Apple Watch), Catta (also known as Cat or Mummy, adult female, Neil's wife, distinctive voluminous curly/wavy blonde hair, blue eyes), Lottie (daughter, young woman, curly/wavy dark brown hair worn loose to the shoulders or sometimes up, pale complexion, hazel eyes, slender build), Tom (son, teenage boy, distinctive voluminous curly dark brown hair, tall and slim build, often wears an Apple Watch). Pets: Saffie is the dog (female, Golden Retriever, rich warm golden-amber coat — deeper gold than a typical light retriever, floppy ears, black nose, medium-large build; harness only worn on walks; at home wears a teal/green collar; her bed is a grey cushioned dog bed in the sunroom); Chell is a predominantly black cat with a very distinctive orange/ginger patch on her forehead, a white chin and chest bib, white paws, and bright yellow-green eyes — she wears a teal collar. Lara is a dark tortoiseshell cat — deep dark brown/black all over with warm amber/copper mottling throughout, no white markings at all, amber/golden eyes, stocky rounded build; wears a teal collar (same colour as Chell's, so use coat and markings to tell them apart: Lara has no white, Chell has a white chin/chest and orange forehead patch). All camera feeds show the current date and time in the top-right corner of the image.",
    { camera_id: z.string().describe("Camera ID, e.g. kitchen, back_garden, doorbell") },
    async ({ camera_id }) => {
      const camera = CAMERAS[camera_id];
      if (!camera) {
        return {
          content: [{ type: "text", text: `Unknown camera: ${camera_id}. Available: ${Object.keys(CAMERAS).join(", ")}` }],
          isError: true
        };
      }
      try {
        const imageBuffer = await captureSnapshot(camera.rtsp);
        return {
          content: [
            { type: "text", text: `${camera.name}: ${camera.description}` },
            { type: "image", data: imageBuffer.toString("base64"), mimeType: "image/jpeg" }
          ]
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to capture snapshot from ${camera.name}: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // List recent events captured via Unifi webhooks
  server.tool(
    "list_events",
    "List recent events detected by Unifi cameras. Returns text metadata only — no images. Use get_event_snapshot to load an image for a specific event. Filter by camera, event type, or time window to avoid processing every event. Known event types from Unifi: person, animal, vehicle, package, ring.",
    {
      limit:      z.number().optional().describe("Max events to return (default 20)"),
      camera:     z.string().optional().describe("Filter by camera ID, e.g. front_drive"),
      event_type: z.string().optional().describe("Filter by event type, e.g. person, animal, vehicle"),
      since:      z.string().optional().describe("Only events after this ISO timestamp, e.g. 2026-03-22T20:00:00Z"),
    },
    async ({ limit = 20, camera, event_type, since }) => {
      let filtered = events;
      if (camera)     filtered = filtered.filter(e => e.camera === camera);
      if (event_type) filtered = filtered.filter(e => e.event === event_type);
      if (since)      filtered = filtered.filter(e => e.timestamp >= since);
      filtered = filtered.slice(0, limit);
      return {
        content: [{
          type: "text",
          text: filtered.length === 0
            ? "No events match the filter."
            : filtered.map(e => `${e.id} | ${e.timestamp} | ${e.cameraName} | ${e.event}`).join("\n")
        }]
      };
    }
  );

  // Get the snapshot for a specific event
  server.tool(
    "get_event_snapshot",
    "Get the stored snapshot image for a specific Unifi-detected event. Use list_events first to get event IDs.",
    { event_id: z.string().describe("Event ID from list_events") },
    async ({ event_id }) => {
      const ev = events.find(e => e.id === event_id);
      if (!ev) {
        return {
          content: [{ type: "text", text: `Unknown event: ${event_id}` }],
          isError: true
        };
      }
      try {
        const imageBuffer = readFileSync(join(SNAPSHOTS_DIR, ev.id));
        const camera = CAMERAS[ev.camera];
        return {
          content: [
            { type: "text", text: `${ev.cameraName} | ${ev.event} | ${ev.timestamp}${camera ? `\n${camera.description}` : ""}` },
            { type: "image", data: imageBuffer.toString("base64"), mimeType: "image/jpeg" }
          ]
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to read snapshot for event ${event_id}: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => transport.close());

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.get("/mcp", async (req, res) => {
  res.status(405).json({ error: "Use POST for MCP" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Scrypted MCP server listening on port ${PORT}`);
  console.log(`Cameras: ${Object.values(CAMERAS).map(c => c.name).join(", ")}`);
});
