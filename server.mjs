import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { execFile } from "child_process";
import { readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { z } from "zod";

const PORT = 9584;

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
