import "dotenv/config";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import express from "express";
import OpenAI from "openai";

const execFileAsync = promisify(execFile);
const app = express();
app.use(express.json({ limit: "8kb" }));

interface StimulusSetup {
  kind: "pursuit_target" | "looming";
  x: number;
  z: number;
  intensity: number;
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

app.post("/api/simulate", async (req, res) => {
  const setup = req.body?.setup;
  if (!isStimulusSetup(setup)) return res.status(400).json({ error: "Place a valid target in the arena first." });
  const simulatorRoot = process.env.FLY_SIMULATOR_ROOT;
  if (!simulatorRoot) return res.status(503).json({ error: "Connectome runtime is not configured. Set FLY_SIMULATOR_ROOT on the server." });

  const python = process.env.FLY_SIMULATOR_PYTHON ?? path.join(simulatorRoot, ".venv", "bin", "python");
  const bridge = path.resolve("simulation", "run_chase.py");
  try {
    const { stdout } = await execFileAsync(python, [bridge, JSON.stringify(setup)], {
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
