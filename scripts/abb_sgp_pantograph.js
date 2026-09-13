/*
 * MIT License
 * 
 * Copyright (c) 2026 EgEhE
 * Includes embedded utilities & dynamic panto library by HarryTheCat
 * 
 */

include(Resources.idRelative("mtr:panto/scripts/dynamic_panto_lib.js"));

// ============================================================================
// GENERAL PANTOGRAPH CONFIG
// ============================================================================
var PANTO_MODEL_PATH = "mtr:panto/abb_panto.obj"; // Pantograph OBJ file path Example: var PANTO_MODEL_PATH = "mtr:panto/abb_panto.obj"
var PANTO_MODEL_NAME = "ABB SGP Panto";           // Display label (can be any string) Example: var PANTO_MODEL_NAME = "ABB SGP Panto"

var WIRE_TRACKING_REFERENCE = 1.4851; // REFERENCE - wire tracking is calculated relative to this value
var NO_WIRE_PARK_HEIGHT = 1.366;      // Fixed height the pantograph rests at when there's no wire

var ENABLE_DEPOT_PARK = true;         // Enables or disables depot parking mode
var DEPOT_PARK_HEIGHT = 0.4;          // Lowered pantograph height when train is parked in depot (not on route)

// ============================================================================
// PANTOGRAPH VEHICLE CONFIG
// 
// DO NOT FORGET TO ADD "scriptId" TO YOUR VEHICLES IN custom_resources.json!
//
// Only vehicles whose ID matches one of the keys below get a pantograph.
// Adding a new train car that needs a pantograph is just adding one more
// entry here - nothing else in this file needs to change.
//
// Key: a substring to look for in the vehicle ID (case-insensitive).
//   mountHeight   - height (Y) of the panto's roof mounting point, in meters
//   mountX        - left/right offset (X) of the mounting point, in meters
//   mountZ        - forward/back offset (Z) of the mounting point, in meters
//   rotationYDeg  - which way the panto faces: 0 or 180 (rotation around
//                   the vertical Y axis, in degrees)
//   wireDetectZ   - Z offset used when searching for the catenary wire
//                   above this car (usually close to mountZ, but kept
//                   separate since it's measured at the pantograph head,
//                   not the roof mount)
// ============================================================================
var PANTO_VEHICLE_CONFIG = {
    "ABB_SGP_TRAILER_1": {
        mountHeight: 2.53,
        mountX: 0,
        mountZ: 1.875,
        rotationYDeg: 180,
        wireDetectZ: 1.92,
    },
    "ABB_SGP_TRAILER_2": {
        mountHeight: 2.53,
        mountX: 0,
        mountZ: -1.875,
        rotationYDeg: 0,
        wireDetectZ: -1.92,
    },
};

// ============================================================================
// MODEL LOADING
// ============================================================================
var rawPanto = ModelManager.loadModelParts(Resources.idRelative(PANTO_MODEL_PATH), true);
var pantoModels = uploadPartedModels(rawPanto, true, false, false, PANTO_MODEL_NAME);

// Catenary wire detection bounds
var pantoUpperTreshold = 3.0;  
var pantoLowerTreshold = -3.0; 

function getPantoConfigForVehicle(vehicleId) {
    if (!vehicleId) return null;

    var cleanId = String(vehicleId).toLowerCase();

    if (cleanId.indexOf("1np") !== -1) {
        return null;
    }

    for (var key in PANTO_VEHICLE_CONFIG) {
        if (cleanId.indexOf(key.toLowerCase()) !== -1) {
            return PANTO_VEHICLE_CONFIG[key];
        }
    }

    return null;
}

function isTrainInDepot(train) {
    if (typeof train.getIsOnRoute === "function") {
        return !train.getIsOnRoute();
    }
    if (typeof train.isOnRoute === "function") {
        return !train.isOnRoute();
    }
    try {
        var mtrVehicle = train.getMtrVehicle();
        if (mtrVehicle && typeof mtrVehicle.getIsOnRoute === "function") {
            return !mtrVehicle.getIsOnRoute();
        }
    } catch (e) {}
    return false;
}

function create(ctx, state, train) {
    if (!state.dynPantoCached) state.dynPantoCached = {};
    if (!state.pantoRateLimit) state.pantoRateLimit = new RateLimit(0.1);
    if (!state.smoothPantoHeight) state.smoothPantoHeight = {};
}

function render(ctx, state, train) {
    if (!pantoModels) return;
    if (!state.dynPantoCached) state.dynPantoCached = {};
    if (!state.pantoRateLimit) state.pantoRateLimit = new RateLimit(0.1);
    if (!state.smoothPantoHeight) state.smoothPantoHeight = {};

    var cars = ctx.getMyCars();
    for (var carIndex in cars) {
        var i = cars[carIndex];
        var config = getPantoConfigForVehicle(train.getVehicleId(i));
        
        if (!config) continue;

        updateCachedCatenaryPerCar(train, state, i, config);
        renderPanto(ctx, state, train, i, config);
    }
}

function renderPanto(ctx, state, train, i, config) {
    var matrices = new Matrices();

    var targetHeight = NO_WIRE_PARK_HEIGHT;

    if (ENABLE_DEPOT_PARK && isTrainInDepot(train)) {
        targetHeight = DEPOT_PARK_HEIGHT;
    } else if (state.dynPantoCached && state.dynPantoCached[i]) {
        targetHeight = WIRE_TRACKING_REFERENCE + state.dynPantoCached[i].signedDistance;
    }

    // Smooth transition (LERP)
    var dt = Timing.delta();
    if (state.smoothPantoHeight[i] === undefined) {
        state.smoothPantoHeight[i] = targetHeight;
    } else {
        var lerpSpeed = dt > 0 ? Math.min(1.0, dt * 18.0) : 1.0;
        state.smoothPantoHeight[i] += (targetHeight - state.smoothPantoHeight[i]) * lerpSpeed;
    }

    var currentHeight = state.smoothPantoHeight[i];

    // --- EXACT INVERSE KINEMATICS CALCULATION ---
    // --- REAL 2-LINK INVERSE KINEMATICS START (auto-generated by pivotfix.js, do not edit by hand) ---
    const pantoL1 = 1.30241;
    const pantoL2 = 1.4586;
    const pantoBaseAngle1 = 2.69358;
    const pantoRestTheta2 = -2.26739;
    let pantoAngle1 = 0, pantoAngle2 = 0;
    {
        let ik = tryFind2dInverseKinematicsPanto(0.01763, 0.27174, 0.17188, currentHeight, pantoL1, pantoL2);
        if (ik) {
            let v = (Math.sign(ik[0].theta2) === Math.sign(pantoRestTheta2)) ? ik[0] : ik[1];
            pantoAngle1 = -(v.theta1 - pantoBaseAngle1);
            pantoAngle2 = -(v.theta2 - pantoRestTheta2);
        }
    }
    // --- REAL 2-LINK INVERSE KINEMATICS END ---

    matrices.pushPose();
    matrices.translate(config.mountX, config.mountHeight, config.mountZ);

    if (config.rotationYDeg !== 0) {
        matrices.rotateY(config.rotationYDeg / 180.0 * Math.PI);
    }

    // 1. Base (fixed)
    if (pantoModels["p_base"]) {
        ctx.drawCarModel(pantoModels["p_base"], i, matrices);
    }

    // 2. Lower arm (p1)
    matrices.pushPose();
    matrices.translate(0, 0.27174, 0.01763);
    matrices.rotateX(pantoAngle1);
    matrices.translate(0, -0.27174, -0.01763);
    if (pantoModels["p1"]) {
        ctx.drawCarModel(pantoModels["p1"], i, matrices);
    }

    // 3. Upper arm (p2)
    {
        matrices.pushPose();
        matrices.translate(0, 0.83591, -1.15625);
        matrices.rotateX(pantoAngle2);
        matrices.translate(0, -0.83591, 1.15625);
        if (pantoModels["p2"]) {
            ctx.drawCarModel(pantoModels["p2"], i, matrices);
        }

        // 4. Contact shoe / skid (p3)
        {
            matrices.pushPose();
            matrices.translate(0, 1.4389, 0.17188);
            matrices.rotateX(-pantoAngle1 - pantoAngle2);
            matrices.translate(0, -1.4389, -0.17188);
            if (pantoModels["p3"]) {
                ctx.drawCarModel(pantoModels["p3"], i, matrices);
            }
            matrices.popPose();
        }
        matrices.popPose();
    }
    matrices.popPose();

    matrices.popPose();
}

function updateCachedCatenaryPerCar(train, state, i, config) {
    var p1 = new Vector3f(-1.0, 4.12, config.wireDetectZ);
    var p2 = new Vector3f(1.0, 4.12, config.wireDetectZ);

    if (state.dynPantoCached && state.dynPantoCached[i]) {
        var trainCarRotations = train.lastCarRotation[i];
        var projectPlaneNormal = new Vector3f(0, 1, 0)
            .rotZ(trainCarRotations.z())
            .rotX(trainCarRotations.x())
            .rotY(trainCarRotations.y());

        var pantoVec1Glob = getGlobalPosFromLocalCoords(train, p1, i);
        var pantoVec2Glob = getGlobalPosFromLocalCoords(train, p2, i);

        var vecA = state.dynPantoCached[i].vecA;
        var vecB = state.dynPantoCached[i].vecB;
        var projectedIntersection = tryGetProjectedIntersection(vecA, vecB, 
            pantoVec1Glob, pantoVec2Glob, projectPlaneNormal);

        if (!projectedIntersection) {
            state.dynPantoCached[i] = getLowestPossibleIntersectionCombined(train, i, p1, p2, pantoLowerTreshold, pantoUpperTreshold);
        } else if ((projectedIntersection[0] < 0 || projectedIntersection[0] > 1) ||
                 (projectedIntersection[1] < 0 || projectedIntersection[1] > 1) || 
                 (projectedIntersection[2] < pantoLowerTreshold || projectedIntersection[2] > pantoUpperTreshold)) {
            state.dynPantoCached[i] = getLowestPossibleIntersectionCombined(train, i, p1, p2, pantoLowerTreshold, pantoUpperTreshold);
        } else {
            state.dynPantoCached[i].wireCoef = projectedIntersection[0];
            state.dynPantoCached[i].pantoCoef = projectedIntersection[1];
            state.dynPantoCached[i].signedDistance = projectedIntersection[2];
        }
    } else if (state.pantoRateLimit && state.pantoRateLimit.shouldUpdate()) {
        state.dynPantoCached[i] = getLowestPossibleIntersectionCombined(train, i, p1, p2, pantoLowerTreshold, pantoUpperTreshold);
    }
}

// ============================================================================
// EMBEDDED UTILS (Formerly from harrys_lib.js)
// ============================================================================
function uploadPartedModels(rawModels, removeRenderType, invertV, invertU, packName) {
    invertU = invertU ?? false;
    invertV = invertV ?? false;

    var result = {};
    for (var it = rawModels.entrySet().iterator(); it.hasNext(); ) {
        var entry = it.next();

        var jsStringKey = "" + entry.getKey(); 
        if (jsStringKey.includes("__int__")) {
            entry.getValue().setAllRenderType("interior");
            if (removeRenderType) jsStringKey = jsStringKey.replace("__int__", '');

        } else if (jsStringKey.includes("__light__")) {
            entry.getValue().setAllRenderType("light");
            if (removeRenderType) jsStringKey = jsStringKey.replace("__light__", '');

        } else if (jsStringKey.includes("__window__")) {
            entry.getValue().setAllRenderType("exteriortranslucent");
            if (removeRenderType) jsStringKey = jsStringKey.replace("__window__", '');

        } else if (jsStringKey.includes("__windowint__")) {
            entry.getValue().setAllRenderType("interiortranslucent");
            if (removeRenderType) jsStringKey = jsStringKey.replace("__windowint__", '');

        } 

        print((packName == undefined ? "" : packName + ": " )+ "registering part " + jsStringKey + "...");
        entry.getValue().applyUVMirror(invertU, invertV);
        result[jsStringKey] = ModelManager.upload(entry.getValue());
    }
    return result;
}

function getGlobalPosFromLocalCoords(train, posLoc, i) {
    var tr = train.lastCarRotation[i];
    var tp = train.lastCarPosition[i];
    return posLoc.copy().add(new Vector3f(0, 1, 0)).rotZ(tr.z()).rotX(-tr.x()).rotY(tr.y()).add(tp);
}