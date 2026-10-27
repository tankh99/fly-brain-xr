import "dotenv/config";
import express from "express";
import OpenAI from "openai";

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
  return (setup.kind === "pursuit_target" || setup.kind === "looming")
    && typeof setup.x === "number" && Number.isFinite(setup.x) && setup.x >= -2.2 && setup.x <= 2.2
    && typeof setup.z === "number" && Number.isFinite(setup.z) && setup.z >= -2.2 && setup.z <= 2.2
    && typeof setup.intensity === "number" && Number.isFinite(setup.intensity) && setup.intensity >= 0.1 && setup.intensity <= 1
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
        kind: { type: "string", enum: ["pursuit_target", "looming"] },
        x: { type: "number", description: "Left/right position in the arena, range -2.2 to 2.2 metres. Negative is left." },
        z: { type: "number", description: "Near/far position in the arena, range -2.2 to 2.2 metres. Negative is toward the viewer." },
        intensity: { type: "number", description: "Stimulus strength from 0.1 to 1." },
        summary: { type: "string", description: "One short plain-language summary of the configured cue." },
      },
      required: ["kind", "x", "z", "intensity", "summary"],
      additionalProperties: false,
    },
  },
};

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, museConfigured: Boolean(process.env.MODEL_API_KEY), model: process.env.META_MODEL ?? "muse-spark-1.3" });
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
            "Allowed kinds: pursuit_target or looming. Do not predict neural activity, movement, or behavior.",
            "Coordinates are metres: x < 0 is left, x > 0 is right; z < 0 is near/viewer, z > 0 is far. Clamp x and z to [-2.2, 2.2], intensity to [0.1, 1].",
            "If the instruction is ambiguous, choose pursuit_target at the center with intensity 0.5 and say so in summary.",
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

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`Meta Fly XR API listening on http://localhost:${port}`));
