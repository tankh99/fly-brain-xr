"""Run one short, real connectome-driven target-pursuit trial.

The separate upstream fly-simulator checkout supplies the MIT-licensed model code
and locally downloaded FlyWire data. Its own pursuit interface maps the visual
target to LC10a input and descending-neuron rates to FlyGym steering; those interface
choices are part of the model and are disclosed in the returned caveat.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 2:
        print("RESULT_JSON:{\"error\":\"Expected one JSON stimulus argument\"}")
        return 2

    setup = json.loads(sys.argv[1])
    target_x_mm = float(setup["x"])
    target_z_mm = float(setup["z"])
    control = setup.get("control", "brain")
    if control not in ("brain", "mirror", "none"):
        print("RESULT_JSON:{\"error\":\"Control must be brain, mirror, or none\"}")
        return 2
    distance_mm = math.hypot(target_x_mm, target_z_mm)
    if distance_mm < 4.0:
        distance_mm = 4.0

    # Scene: x<0 is left; z<0 is forward. Upstream sim: +x is forward,
    # +y is the fly's left. Convert the user's absolute cue to a relative bearing.
    bearing_deg = math.degrees(math.atan2(-target_x_mm, -target_z_mm))

    from fly_simulator.games.brain_io import GameBrain
    from fly_simulator.games.chase import ChaseConfig
    from fly_simulator.games.session import ChaseSession

    brain = GameBrain(control, data_dir=str(Path.cwd() / "data" / "brain"), seed=7)
    session = None
    try:
        brain.start(timeout=120)
        cfg = ChaseConfig(start_dist_mm=distance_mm, start_bearing_deg=0, ready_s=0.1)
        session = ChaseSession(brain=brain, cfg=cfg, seed=7, chunk_steps=50)
        session.game.place_leader(dist_mm=distance_mm, bearing_deg=bearing_deg)
        # The target is stationary for this first controlled experiment. We are
        # testing the connectome's pursuit response, not odor tracking or target AI.
        session.leader.weave = False
        session.leader.speed = 0.0

        points = []
        duration_s = 1.25
        while session.game.time() < duration_s:
            session.step()
            p = session.sim.thorax_position()
            heading = float(session.sim.heading())
            state = brain.latest
            descending = state.descending if state else {}
            points.append({
                "t": round(float(session.game.time()), 4),
                "x": round(-float(p[1]), 4),
                "z": round(-float(p[0]), 4),
                "yaw": round(heading, 5),
                "turnLeftHz": round(float(descending.get("turn_L", 0)), 2),
                "turnRightHz": round(float(descending.get("turn_R", 0)), 2),
            })

        model_name = (
            brain.layout.model_name if brain.layout
            else "FlyGym CPG baseline (no connectome brain)"
        )
        if control == "none":
            caveat = "No-brain control: FlyGym's CPG drives walking; connectome input is disconnected."
        else:
            caveat = (
                f"{control} pursuit trial. The upstream interface maps the visual target to LC10a input "
                "and descending-neuron activity to FlyGym steering; walking uses FlyGym's CPG. "
                "This is a model-conditioned virtual trajectory, not a claim about a living fly."
            )
        result = {
            "model": model_name,
            "control": control,
            "points": points,
            "target": {"x": round(target_x_mm, 3), "z": round(target_z_mm, 3)},
            "caveat": caveat,
        }
        print("RESULT_JSON:" + json.dumps(result, separators=(",", ":")))
        return 0
    finally:
        if session is not None:
            session.close()
        brain.close()


if __name__ == "__main__":
    raise SystemExit(main())
