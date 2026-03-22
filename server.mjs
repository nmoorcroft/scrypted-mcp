import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { execFile } from "child_process";
import { readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const PORT = 9584;
// Scrypted Rebroadcast Plugin RTSP stream for Kitchen camera (device ID 28)
// Set RTSP_URL env var to the rebroadcast path (mixin:28:rtspServerPathKey-0)
const RTSP_URL = process.env.RTSP_URL;
if (!RTSP_URL) throw new Error("RTSP_URL environment variable is required");

function captureSnapshot() {
  return new Promise((resolve, reject) => {
    const tmpFile = join(tmpdir(), `kitchen_snap_${Date.now()}.jpg`);
    execFile(
      "ffmpeg",
      ["-rtsp_transport", "tcp", "-i", RTSP_URL,
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
  const server = new McpServer({ name: "scrypted-camera", version: "1.0.0" });

  server.tool(
    "get_kitchen_camera",
    "Get a current snapshot from the kitchen camera. Use this to visually check what is happening in the kitchen — for example whether the dog is asleep, whether someone is in the kitchen, or what the dog is doing.",
    {},
    async () => {
      try {
        const imageBuffer = await captureSnapshot();
        return {
          content: [{
            type: "image",
            data: imageBuffer.toString("base64"),
            mimeType: "image/jpeg"
          }]
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to capture snapshot: ${err.message}` }],
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

// Handle GET for SSE (optional, some clients use it)
app.get("/mcp", async (req, res) => {
  res.status(405).json({ error: "Use POST for MCP" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Scrypted MCP server listening on port ${PORT}`);
  console.log(`RTSP source: ${RTSP_URL}`);
});
