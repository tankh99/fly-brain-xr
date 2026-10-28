import "dotenv/config";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import express from "express";
import OpenAI from "openai";

const execFileAsync = promisify(execFile);
const app = express();
app.use(express.json({ limit: "2mb" }));

interface StimulusSetup {
  kind: "pursuit_target" | "looming";
  x: number;
  z: number;
  summary: string;
}

function isStimulusSetup(value: unknown): value is StimulusSetup {
  if (!value || typeof value !== "object") return false;
  const setup = value as Record<string, unknown>;
  return setup.kind === "pursuit_target"
    && typeof setup.x === "number" && Number.isFinite(setup.x) && setup.x >= -22 && setup.x <= 22
    && typeof setup.z === "number" && Number.isFinite(setup.z) && setup.z >= -22 && setup.z <= 22
    && typeof setup.summary === "string" && setup.summary.length > 0 && setup.summary.length <= 120;
}

const responseFormat = {
  type: "json_schema" as const,
  json_schema: {
    name: "fly_stimulus_setup",
    strict: true,
    schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["pursuit_target"] },
        x: { type: "number", description: "Left/right position in the arena, range -22 to 22 millimetres. Negative is screen-left." },
        z: { type: "number", description: "Near/far position in the arena, range -22 to 22 millimetres. Negative is forward from the fly." },
        summary: { type: "string", description: "One short plain-language summary of the configured cue." },
      },
      required: ["kind", "x", "z", "summary"],
      additionalProperties: false,
    },
  },
};

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    museConfigured: Boolean(process.env.MODEL_API_KEY),
    simulatorConfigured: Boolean(process.env.FLY_SIMULATOR_ROOT),
    model: process.env.META_MODEL ?? "muse-spark-1.3",
  });
});

app.post("/api/interpret-stimulus", async (req, res) => {
  const instruction = req.body?.instruction;
  if (typeof instruction !== "string" || instruction.trim().length < 1 || instruction.length > 300) {
    return res.status(400).json({ error: "Instruction must be 1–300 characters." });
  }
  if (!process.env.MODEL_API_KEY) {
    return res.status(503).json({ error: "Muse is not configured yet. Add MODEL_API_KEY to the server .env file." });
  }

  try {
    const client = new OpenAI({
      apiKey: process.env.MODEL_API_KEY,
      baseURL: "https://api.meta.ai/v1",
    });
    const completion = await client.chat.completions.create({
      model: process.env.META_MODEL ?? "muse-spark-1.3",
      messages: [
        {
          role: "system",
          content: [
            "You configure a small fruit-fly experiment arena. Convert the instruction into only a visual target setup.",
            "The only allowed kind is pursuit_target. Do not predict neural activity, movement, or behavior.",
            "Coordinates are millimetres in a 50mm arena: x < 0 is screen-left, x > 0 screen-right; z < 0 is forward from the fly, z > 0 behind. Clamp x and z to [-22, 22].",
            "If the instruction is ambiguous, choose a pursuit target at x=0,z=-10 and say so in summary.",
          ].join(" "),
        },
        { role: "user", content: instruction.trim() },
      ],
      response_format: responseFormat,
    });

    const content = completion.choices[0]?.message.content;
    if (!content) return res.status(502).json({ error: "Muse returned no stimulus setup." });
    const setup: unknown = JSON.parse(content);
    if (!isStimulusSetup(setup)) return res.status(502).json({ error: "Muse returned an invalid stimulus setup." });
    return res.json({ setup, model: completion.model });
  } catch (error) {
    console.error("Muse stimulus interpretation failed:", error);
    return res.status(502).json({ error: "Muse could not configure that stimulus. Try a simpler instruction." });
  }
});

app.post("/api/ground-target", async (req, res) => {
  const { imageDataUrl, targetDescription = "" } = req.body ?? {};
  if (typeof imageDataUrl !== "string"
    || imageDataUrl.length > 1_500_000
    || !/^data:image\/(jpeg|png|webp);base64,/.test(imageDataUrl)) {
    return res.status(400).json({ error: "Capture a JPEG, PNG, or WebP frame under 1.5 MB." });
  }
  if (typeof targetDescription !== "string" || targetDescription.length > 120) {
    return res.status(400).json({ error: "Target description must be under 120 characters." });
  }
  if (!process.env.MODEL_API_KEY) {
    return res.status(503).json({ error: "Muse is not configured. Add MODEL_API_KEY to the server .env file." });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.MODEL_API_KEY, baseURL: "https://api.meta.ai/v1" });
    const completion = await client.chat.completions.create({
      model: process.env.META_MODEL ?? "muse-spark-1.3",
      messages: [
        { role: "system", content: "Locate one visible physical object for a virtual fly pursuit experiment. Do not identify people or infer personal attributes. Return its name and normalized center point on a 0–1000 image grid (origin top-left), confidence 0–1, and found=false if absent. Do not predict behavior." },
        {
          role: "user",
          content: [
            { type: "text", text: targetDescription.trim() ? `Find this object: ${targetDescription.trim()}. Return the center point.` : "Choose one clear, distinct, non-person object as a pursuit target. Return its center point." },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "grounded_target",
          strict: true,
          schema: {
            type: "object",
            properties: {
              found: { type: "boolean" },
              objectName: { type: "string" },
              x: { type: "number", description: "Normalized horizontal coordinate 0 (left) to 1000 (right)." },
              y: { type: "number", description: "Normalized vertical coordinate 0 (top) to 1000 (bottom)." },
              confidence: { type: "number", description: "Confidence between 0 and 1." },
            },
            required: ["found", "objectName", "x", "y", "confidence"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = completion.choices[0]?.message.content;
    if (!content) return res.status(502).json({ error: "Muse returned no object location." });
    const value: unknown = JSON.parse(content);
    if (!value || typeof value !== "object") return res.status(502).json({ error: "Muse returned invalid grounding data." });
    const target = value as Record<string, unknown>;
    if (typeof target.found !== "boolean" || typeof target.objectName !== "string"
      || typeof target.x !== "number" || !Number.isFinite(target.x) || target.x < 0 || target.x > 1000
      || typeof target.y !== "number" || !Number.isFinite(target.y) || target.y < 0 || target.y > 1000
      || typeof target.confidence !== "number" || !Number.isFinite(target.confidence)
      || target.confidence < 0 || target.confidence > 1) {
      return res.status(502).json({ error: "Muse returned an invalid object location." });
    }
    return res.json({ target, model: completion.model });
  } catch (error) {
    console.error("Muse image grounding failed:", error);
    return res.status(502).json({ error: "Muse could not locate a target in that frame." });
  }
});

app.post("/api/simulate", async (req, res) => {
  const setup = req.body?.setup;
  if (!isStimulusSetup(setup)) return res.status(400).json({ error: "Place a valid target in the arena first." });
  const control = req.body?.control ?? "brain";
  if (!(["brain", "mirror", "none"] as const).includes(control)) return res.status(400).json({ error: "Control must be brain, mirror, or none." });
  const simulatorRoot = process.env.FLY_SIMULATOR_ROOT;
  if (!simulatorRoot) return res.status(503).json({ error: "Connectome runtime is not configured. Set FLY_SIMULATOR_ROOT on the server." });

  const python = process.env.FLY_SIMULATOR_PYTHON ?? path.join(simulatorRoot, ".venv", "bin", "python");
  const bridge = path.resolve("simulation", "run_chase.py");
  try {
    const { stdout } = await execFileAsync(python, [bridge, JSON.stringify({ ...setup, control })], {
      cwd: simulatorRoot,
      env: { ...process.env, PYTHONPATH: simulatorRoot },
      timeout: 180_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const resultLine = stdout.split("\n").find((line) => line.startsWith("RESULT_JSON:"));
    if (!resultLine) return res.status(502).json({ error: "Simulator exited without a trajectory." });
    return res.json(JSON.parse(resultLine.slice("RESULT_JSON:".length)));
  } catch (error) {
    console.error("Connectome simulation failed:", error);
    return res.status(502).json({ error: "Connectome simulation failed. Check the local simulator and brain-data setup." });
  }
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`Meta Fly XR API listening on http://localhost:${port}`));
