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
  back_garden:  { name: "Back Garden",  rtsp: process.env.RTSP_BACK_GARDEN },
  doorbell:     { name: "Doorbell",     rtsp: process.env.RTSP_DOORBELL },
  front_drive:  { name: "Front Drive",  rtsp: process.env.RTSP_FRONT_DRIVE },
  kitchen:      { name: "Kitchen",      rtsp: process.env.RTSP_KITCHEN },
  side_gate:    { name: "Side Gate",    rtsp: process.env.RTSP_SIDE_GATE },
  utility_room: { name: "Utility Room", rtsp: process.env.RTSP_UTILITY_ROOM },
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
          .map(([id, c]) => `${id}: ${c.name}`)
          .join("\n")
      }]
    })
  );

  // Get a snapshot from a specific camera
  server.tool(
    "get_camera_snapshot",
    "Get a live snapshot from a camera. Use list_cameras first to see available camera IDs.",
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
          content: [{
            type: "image",
            data: imageBuffer.toString("base64"),
            mimeType: "image/jpeg"
          }]
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
