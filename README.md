# Dynamic Pantograph (MTR / JCM)

It all started because I wanted to make the pantograph in my Blockbench model dynamic. Later, I wanted to ensure compatibility not only with the MSD mode but also with the pantograph and wire modes, and it works really well. Anyway, I then placed the pantograph I created in Blockbench into the folders as p1, p2, p3, and pbase, but the Blockbench export doesn’t save the OBJ files into those groups. So I created a simple `objgroupfix.js` script, which easily solved the grouping issue. But I had another problem: this time, the angle on the pantograph’s arm was wrong. Since the math behind this was a bit too much for me, I had to ask Claude to create `pivotfix.js` for me. Because those mathematical calculations were giving me.

I'm sharing this so that the trains made with Blockbench also have dynamic pantographs

The original dynamic pantograph library was developed by [HarryTheCat](https://github.com/MaratMadiev). I’d recommend checking it out.

## What it actually does

- First, it checks the MSD catenary system. If it cannot find a wire, it tries the “Create: Pantographs & Wires” command instead. If neither is installed, or if JCM’s scripting restrictions prevent access, it stops at a fixed height and reports the reason in the chat window. The value of this fixed height can also be changed at the beginning of the config file.
- When the train is not on a route (while in the depot), the pantograph automatically lowers to the resting height; this setting can be adjusted or even disabled if desired.
- Which vehicles get a pantograph, and where it's mounted, is a config table at the top of the script.

## Files

- **`dynamic_panto_lib.js`** — I wouldn't recommend touching this. If you don't know what you're doing, this is just the main library required for the script to run. You can download it from Modrinth and place it in the Minecraft resource pack.
- **`EXAMPLE_pantograph.js`** — the per-train config and render entrypoint. This is the one you edit.

## Setup

1. Drop `dynamic_panto_lib.js` and `EXAMPLE_pantograph.js` into `assets/mtr/panto/scripts/`.
2. **Rename `EXAMPLE_pantograph.js`** to something specific to your train, e.g. `my_train_pantograph.js`. This matters: if you ever add a second train with a pantograph and both are still using a file literally named `EXAMPLE_pantograph.js`, they'll collide. Do this before you forget.
3. Open your renamed copy and fill in the blanks at the top:
   ```javascript
   var PANTO_MODEL_PATH = "mtr:panto/your_panto.obj";
   var PANTO_MODEL_NAME = "My Cool Panto";
   ```
4. Fill in `PANTO_VEHICLE_CONFIG` with your own vehicle IDs (see below).
5. Add the script's `scriptId` to those vehicles in `mtr_custom_resources.json`.

### About the PAW fallback

Reading PAW's catenary data needs raw Java class access that JCM blocks by default. If you want it:

```toml
disableScriptRestrictions = true
```

in `config/jsblock/client.toml` (or the same toggle in JCM's settings menu), then restart. Without it, MSD still works fine the pantograph just can't fall back to PAW, and you'll get a one-time heads-up in chat about it.

## Configuring vehicles

```javascript
var PANTO_VEHICLE_CONFIG = {
    "YOUR_VEHICLE_ID_1": {
        mountHeight: 2.53,
        mountX: 0,
        mountZ: 1.875,
        rotationYDeg: 180,
        wireDetectZ: 1.92,
    },
    "YOUR_VEHICLE_ID_2": {
        mountHeight: 2.53,
        mountX: 0,
        mountZ: -1.875,
        rotationYDeg: 0,
        wireDetectZ: -1.92,
    },
};
```

Any vehicle whose ID contains one of these keys (not case-sensitive) gets a pantograph. Everything else doesn't. Adding a new car is one new entry, nothing else to touch.

## The two helper scripts (not deployed, run locally)

- **WARNING: For now, they only work on files converted from the Blockbench model to OBJ format. They will not work on OBJ files that are not .bbmodel files!**
- You need [Node.js](https://nodejs.org/en/download) for the scripts to run!
- These are the two scripts I mentioned earlier p1, p2 and p3 that solve the pivot issue.

**`objgroupfix.js`** - For some reason, when Blockbench exports in .obj format, it doesn’t split the models into obj groups based on the p1, p2, p3, and pbase folders you’ve placed in the your blockbench model. This script, however, examines the Blockbench model, locates the models in the p1, p2, p3, and pbase folders, and regroup them accordingly. Without this script, the pantograph arm won’t work. And running `pivotfix.js` without performing this step is strongly not recommended.

```bash
node objgroupfix.js model.bbmodel model.obj [output.obj]
```

**`pivotfix.js`** - pulls each part's pivot straight from the `.bbmodel` group origins, patches the `matrices.translate(...)` pairs in your pantograph script to match, and regenerates the inverse kinematics block (arm lengths, base angles) from the same data. Re-run it any time you reshape the model and the script stays accurate no manual math.

```bash
node pivotfix.js model.bbmodel EXAMPLE_pantograph.js [output.js]
```

Both back up the original file before writing (`.bak`), and only touch the specific blocks they generate safe to run repeatedly.

## License

MIT — see [LICENSE](https://github.com/EgEhEw/MTR-EgEhEs-PantoLib/blob/main/LICENSE) in this repo.
