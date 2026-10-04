/*
 * MIT License
 * 
 * Dynamic Panto Library for JCM/MTR4
 * - Base Library: Created by HarryTheCat
 * - PAW (Create: Pantographs & Wires) Support & Fallback: Added by EgEhE
 * 
 * Copyright (c) HarryTheCat
 * Copyright (c) 2026 EgEhE
 */

var POSSIBILITY_FLAG = checkIfDoable();

function checkIfDoable() {
	let check = Packages.top.mcmtr.mod.client.MSDMinecraftClientData.getInstance;
	return typeof(check) == 'function';
}

/// CATENARY MATH STUFF

/**
 * Get the lowest point of train pantograph and catenary intersection. 
 * Minecraft Station Decoration mod required
 * 
 * You can save it in state and use tryGetProjectedIntersection until it returns null
 * to avoid searching the same catenary wire multiple times
 * 
 * @param train - JCM VehicleWrapper object
 * @param index - current car index
 * @param pantoVec1Local - End of pantograph slide 
 * @param pantoVec2Local - Opposite end of pantograph slide
 * @param upperBound - Upper bound of intersection relative to the pantograph slide
 * @param lowerBound - Lower bound of intersection relative to the pantograph slide
 * @returns { wireCoef, pantoCoef, signedDistance, vecA, vecB, catenaryRef } if found, null else
 * 
 *  
 **/ 
function getLowestPossibleIntersection(train, index, pantoVec1Local, pantoVec2Local, lowerBound, upperBound) {
	if (!POSSIBILITY_FLAG) return null; 

	let allPossible = getAllPossibleIntersections(train, index, pantoVec1Local, pantoVec2Local, lowerBound, upperBound);

	if (allPossible.length == 0) {
		return null;
	}

	return allPossible.reduce((min, current) => min.signedDistance < current.signedDistance ? min : current)  
}

/**
 * 
 * Get all possible intersections
 * 
 * wireCoef - number from 0 to 1 if intersetion somewhere between the wire nodes
 * more than 1 or less than 1 - intersection exist but it's out of wire's nodes
 * same with pantocoef
 * distance is signed along the train's "up" normal in worl
 * vecA, vecB - wire nodes in Vector3f
 * catenaryRef - reference to catenary object
 * 
 */
function getAllPossibleIntersections(train, index, pantoVec1Local, pantoVec2Local, lowerBound, upperBound) {
	
	if (!POSSIBILITY_FLAG) return []; 

	let pantoVec1Glob = getGlobalPosFromLocalCoords(train, pantoVec1Local, index);
	let pantoVec2Glob = getGlobalPosFromLocalCoords(train, pantoVec2Local, index);

	let trainCarRotations = train.lastCarRotation[index];
	let projectPlaneNormal = new Vector3f(0, 1, 0)
		.rotZ(trainCarRotations.z())
		.rotX(trainCarRotations.x())
		.rotY(trainCarRotations.y());

	let msdData = Packages.top.mcmtr.mod.client.MSDMinecraftClientData.getInstance();
    let catenaryWrapperList = msdData.catenaryWrapperList;
    let iterator = catenaryWrapperList.object2ObjectEntrySet().iterator();

    let result = [];

    while (iterator.hasNext()) {
        let entry = iterator.next();
        let key = entry.getKey();        
        let wrapper = entry.getValue();  
        let catenary = wrapper.getCatenary();
    
        let vecA = new Vector3f(catenary.getPosition1().getX() + 0.5, catenary.getPosition1().getY(), catenary.getPosition1().getZ() + 0.5)
        let vecB = new Vector3f(catenary.getPosition2().getX() + 0.5, catenary.getPosition2().getY(), catenary.getPosition2().getZ() + 0.5)
        
        let vecAoffset = new Vector3f(catenary.getOffsetPositionStart().getX(), catenary.getOffsetPositionStart().getY(), catenary.getOffsetPositionStart().getZ())
        let vecBoffset = new Vector3f(catenary.getOffsetPositionEnd().getX(), catenary.getOffsetPositionEnd().getY(), catenary.getOffsetPositionEnd().getZ())
    
        vecA.add(vecAoffset);
        vecB.add(vecBoffset);
    	
    	let pantoIntersects = tryGetProjectedIntersection(vecA, vecB, pantoVec1Glob, pantoVec2Glob, projectPlaneNormal);

    	if (pantoIntersects && pantoIntersects[2] < upperBound && pantoIntersects[2] > lowerBound) {
    		result.push({
    			wireCoef: pantoIntersects[0],
    			pantoCoef: pantoIntersects[1],
    			signedDistance: pantoIntersects[2],
    			vecA: vecA,
    			vecB: vecB,
    			catenaryRef: catenary 
    		});
    	}
    }

    return result;
}

/**
 * 
 * finds projected intersection 
 * 
 */ 

function tryGetProjectedIntersection(a1, a2, b1, b2, projectPlaneNormal) {

	projectPlaneNormal = projectPlaneNormal.copy().normalize();

	let u = a2.copy().sub(a1);
	let v = b2.copy().sub(b1);
	let w = b1.copy().sub(a1);

	let determinant = dot(u, v.copy().cross(projectPlaneNormal))

	if (Math.abs(determinant) < 0.1e-3) {
		return null;
	}

	let t = dot(w, v.copy().cross(projectPlaneNormal)) / determinant;
	let s = dot(w, u.copy().cross(projectPlaneNormal)) / determinant;

	if (t < 0 || t > 1) return null;
	if (s < 0 || s > 1) return null;


	let p1 = a1.copy().add(u.copy().mul(t))
	let p2 = b1.copy().add(v.copy().mul(s))

	let delta = p1.copy().sub(p2);
	let signedDistance = dot(delta, projectPlaneNormal);

	return [t, s, signedDistance]
}

// PANTO RENDERING STUFF

/**
 * Inverse kinematic for 4 sided pantograph  
 * If your panto has 2 moving parts it's better to use a simplier math 
 *
 **/
function tryFind2dInverseKinematicsPanto(zBase, yBase, zTarget, yTarget, l1, l2) {
    const x = zTarget - zBase;
    const y = yTarget - yBase;

    const r2 = x * x + y * y;
    const r = Math.sqrt(r2);

    if (r > (l1 + l2) || r < Math.abs(l1 - l2)) {
        return null; // point unreacheable
    }

    let cosTheta2 = (r2 - l1 * l1 - l2 * l2) / (2 * l1 * l2);
    cosTheta2 = Math.max(-1, Math.min(1, cosTheta2));

    // theta2 Variants
    const theta2_Variant1 = Math.acos(cosTheta2);
    const theta2_Variant2 = -Math.acos(cosTheta2);

    
    const alpha = Math.atan2(y, x);

    // Variant 1
    const beta1 = Math.atan2(l2 * Math.sin(theta2_Variant1), l1 + l2 * Math.cos(theta2_Variant1));
    const theta1_Variant1 = alpha - beta1;

    // Variant 2
    const beta2 = Math.atan2(l2 * Math.sin(theta2_Variant2), l1 + l2 * Math.cos(theta2_Variant2));
    const theta1_Variant2 = alpha - beta2;

    return [
        { theta1: theta1_Variant1, theta2: theta2_Variant1 },
        { theta1: theta1_Variant2, theta2: theta2_Variant2 }
   	]
}

// GENERAL MATH STUFF

function dot(vec1, vec2) {
	return vec1.x() * vec2.x() + vec1.y() * vec2.y() + vec1.z() * vec2.z()
}

function getGlobalPosFromLocalCoords(train, posLoc, i) {
	// Global world pos from local model pos (kinda approximated)
	let tr = train.lastCarRotation[i];
	let tp = train.lastCarPosition[i];
	return posLoc.copy().add(new Vector3f(0,1,0)).rotZ(tr.z()).rotX(-tr.x()).rotY(tr.y()).add(tp);;
}

// ============================================================================
// PAW (Create: Pantographs & Wires) CATENARY DETECTION - FALLBACK WHEN MSD FAILS
// appended to the end of dynamic_panto_lib.js
// ============================================================================

var PAW_POSSIBILITY_FLAG = checkIfPawDoable();
print("PAW catenary system: " + (PAW_POSSIBILITY_FLAG ? "found, active" : "not found, disabled") + " (is1.20.1: " + isMinecraft1201() + ")");

var _pawWarningShown = false;

function checkAndWarnPawSupport() {
	if (_pawWarningShown) return;
	if (!PAW_POSSIBILITY_FLAG && isMinecraft1201()) {
		try {
			if (typeof MinecraftClient !== "undefined") {
				var player = null;
				try {
					if (typeof MinecraftClient.localPlayer === "function") {
						player = MinecraftClient.localPlayer();
					}
				} catch (e) {}
				if (player == null) {
					try {
						var mc = Packages.org.mtr.mapping.holder.MinecraftClient.getInstance();
						if (mc && mc.getPlayerMapped() != null) {
							player = mc.getPlayerMapped();
						}
					} catch (e) {}
				}

				if (player != null) {
					MinecraftClient.displayMessage(
						"[Pantograph] 'Pantographs & Wires' mod isn't installed, or JCM's script restrictions are blocking it. If you need PAW support, set disableScriptRestrictions = true in config/jsblock/client.toml (or JCM in-game settings) and restart.",
						false
					);
					_pawWarningShown = true;
					print("[Pantograph] PAW warning displayed in chat.");
				}
			}
		} catch (e) {
			print("[Pantograph] Error displaying PAW warning: " + e);
		}
	}
}

// Initial check when script loads
checkAndWarnPawSupport();

function isMinecraft1201() {
	// 1. JCM Resources API (Whitelisted & ALWAYS accessible even when script restrictions are active)
	try {
		if (typeof Resources !== "undefined") {
			if (typeof Resources.getAddonVersion === "function") {
				var jcmVer = Resources.getAddonVersion("jcm");
				if (jcmVer && String(jcmVer).indexOf("1.20.1") !== -1) return true;
			}
			if (typeof Resources.getNTEVersion === "function") {
				var nteVer = Resources.getNTEVersion();
				if (nteVer && String(nteVer).indexOf("1.20.1") !== -1) return true;
			}
			if (typeof Resources.getMTRVersion === "function") {
				var mtrVer = Resources.getMTRVersion();
				if (mtrVer && String(mtrVer).indexOf("1.20.1") !== -1) return true;
			}
		}
	} catch (e) {}

	// 2. MTR Keys API (Whitelisted org.mtr.* packages in JCM ClassShutter, works on both Forge & Fabric)
	try {
		if (typeof Packages !== "undefined" && Packages.org && Packages.org.mtr && Packages.org.mtr.mod && Packages.org.mtr.mod.Keys) {
			var mtrModVer = Packages.org.mtr.mod.Keys.MOD_VERSION;
			if (mtrModVer && String(mtrModVer).indexOf("1.20.1") !== -1) return true;
		}
	} catch (e) {}

	// 3. Fabric Loader API (when script restrictions are disabled)
	try {
		var fl = Packages.net.fabricmc.loader.api.FabricLoader.getInstance();
		if (fl) {
			var mc = fl.getModContainer("minecraft");
			if (mc && mc.isPresent()) {
				var v = String(mc.get().getMetadata().getVersion().getFriendlyString());
				return v === "1.20.1";
			}
		}
	} catch (e) {}

	// 4. Forge Loader API (FMLLoader - when script restrictions are disabled)
	try {
		var fml = Packages.net.minecraftforge.fml.loading.FMLLoader.versionInfo().mcVersion();
		if (fml) {
			return String(fml) === "1.20.1";
		}
	} catch (e) {}

	// 5. NeoForge Loader API
	try {
		var neo = Packages.net.neoforged.fml.loading.FMLLoader.versionInfo().mcVersion();
		if (neo) {
			return String(neo) === "1.20.1";
		}
	} catch (e) {}

	// 6. Vanilla SharedConstants fallback
	try {
		var sc = Packages.net.minecraft.SharedConstants.getCurrentVersion().getName();
		if (sc) {
			return String(sc) === "1.20.1";
		}
	} catch (e) {}

	return false;
}

function checkIfPawDoable() {
	try {
		let check = Packages.de.mrjulsen.wires.graph.WireGraphManager.getClient;
		return typeof(check) == 'function';
	} catch (e) {
		return false;
	}
}

// Level and BlockPos helpers supporting both Forge (SRG/Mojmap) and Fabric (Intermediary/Yarn)
var _mcClientLevelGetter = null;
var _blockPosFactory = null;

function getMcClientLevel() {
	if (_mcClientLevelGetter !== null) {
		return _mcClientLevelGetter();
	}

	// 1. MTR Mapping layer (Works on BOTH Fabric & Forge, returns unwrapped Minecraft World/Level via .data)
	try {
		var mtrClient = Packages.org.mtr.mapping.holder.MinecraftClient.getInstance();
		if (mtrClient && mtrClient.getWorldMapped()) {
			_mcClientLevelGetter = function() {
				return Packages.org.mtr.mapping.holder.MinecraftClient.getInstance().getWorldMapped().data;
			};
			return _mcClientLevelGetter();
		}
	} catch (e) {}

	// 2. Fabric Intermediary (Production Fabric: class_310.method_1551().field_1687)
	try {
		var fInst = Packages.net.minecraft.class_310.method_1551();
		if (fInst && fInst.field_1687) {
			_mcClientLevelGetter = function() {
				return Packages.net.minecraft.class_310.method_1551().field_1687;
			};
			return _mcClientLevelGetter();
		}
	} catch (e) {}

	// 3. Forge SRG (Production Forge: Minecraft.m_91087_().f_91073_)
	try {
		var srgInst = Packages.net.minecraft.client.Minecraft.m_91087_();
		if (srgInst) {
			_mcClientLevelGetter = function() {
				return Packages.net.minecraft.client.Minecraft.m_91087_().f_91073_;
			};
			return _mcClientLevelGetter();
		}
	} catch (e) {}

	// 4. Mojang mappings / NeoForge (Minecraft.getInstance().level)
	try {
		var mojInst = Packages.net.minecraft.client.Minecraft.getInstance();
		if (mojInst && mojInst.level) {
			_mcClientLevelGetter = function() {
				return Packages.net.minecraft.client.Minecraft.getInstance().level;
			};
			return _mcClientLevelGetter();
		}
	} catch (e) {}

	// 5. Yarn mappings (MinecraftClient.getInstance().world)
	try {
		var yarnInst = Packages.net.minecraft.client.MinecraftClient.getInstance();
		if (yarnInst && yarnInst.world) {
			_mcClientLevelGetter = function() {
				return Packages.net.minecraft.client.MinecraftClient.getInstance().world;
			};
			return _mcClientLevelGetter();
		}
	} catch (e) {}

	print("PAW ERROR: could not obtain client level by any method (MTR, Fabric, SRG, Mojmap, Yarn all failed).");
	_mcClientLevelGetter = function() { return null; };
	return null;
}

function createBlockPos(x, y, z) {
	if (_blockPosFactory !== null) {
		return _blockPosFactory(x, y, z);
	}

	// 1. MTR Mapping layer (Works on BOTH Fabric & Forge, returns unwrapped BlockPos via .data)
	try {
		new Packages.org.mtr.mapping.holder.BlockPos(0, 0, 0);
		_blockPosFactory = function(bx, by, bz) {
			return new Packages.org.mtr.mapping.holder.BlockPos(bx, by, bz).data;
		};
		return _blockPosFactory(x, y, z);
	} catch (e) {}

	// 2. Fabric Intermediary (class_2338)
	try {
		new Packages.net.minecraft.class_2338(0, 0, 0);
		_blockPosFactory = function(bx, by, bz) {
			return new Packages.net.minecraft.class_2338(bx, by, bz);
		};
		return _blockPosFactory(x, y, z);
	} catch (e) {}

	// 3. Forge / Mojmap / NeoForge (net.minecraft.core.BlockPos)
	try {
		new Packages.net.minecraft.core.BlockPos(0, 0, 0);
		_blockPosFactory = function(bx, by, bz) {
			return new Packages.net.minecraft.core.BlockPos(bx, by, bz);
		};
		return _blockPosFactory(x, y, z);
	} catch (e) {}

	return null;
}

function getAllPossibleIntersectionsPAW(train, index, pantoVec1Local, pantoVec2Local, lowerBound, upperBound) {
	if (!PAW_POSSIBILITY_FLAG) return [];

	let result = [];

	try {
		let pantoVec1Glob = getGlobalPosFromLocalCoords(train, pantoVec1Local, index);
		let pantoVec2Glob = getGlobalPosFromLocalCoords(train, pantoVec2Local, index);

		let trainCarRotations = train.lastCarRotation[index];
		let projectPlaneNormal = new Vector3f(0, 1, 0)
			.rotZ(trainCarRotations.z())
			.rotX(trainCarRotations.x())
			.rotY(trainCarRotations.y());

		let mcLevel = getMcClientLevel();
		if (!mcLevel) return [];

		let net = Packages.de.mrjulsen.wires.graph.WireGraphManager.getClient(
			mcLevel,
			Packages.de.mrjulsen.wires.WiresApi.PAW_CATENARY_WIRES
		);
		if (!net) return [];

		let minX = Math.floor(Math.min(pantoVec1Glob.x(), pantoVec2Glob.x())) - 1;
		let maxX = Math.ceil(Math.max(pantoVec1Glob.x(), pantoVec2Glob.x())) + 1;
		let baseY = Math.min(pantoVec1Glob.y(), pantoVec2Glob.y());
		let minY = Math.floor(baseY + lowerBound) - 1;
		let maxY = Math.ceil(baseY + upperBound) + 1;
		let minZ = Math.floor(Math.min(pantoVec1Glob.z(), pantoVec2Glob.z())) - 1;
		let maxZ = Math.ceil(Math.max(pantoVec1Glob.z(), pantoVec2Glob.z())) + 1;

		let seen = {};

		for (let x = minX; x <= maxX; x++) {
			for (let y = minY; y <= maxY; y++) {
				for (let z = minZ; z <= maxZ; z++) {
					let blockPos = createBlockPos(x, y, z);
					if (!blockPos) continue;
					let wireCollisions = net.getCollisionsInBlock(blockPos);
					let it = wireCollisions.iterator();

					while (it.hasNext()) {
						let wireCollision = it.next();
						let blockCollisions = wireCollision.collisionsInBlock(blockPos);
						let it2 = blockCollisions.iterator();

						while (it2.hasNext()) {
							let c = it2.next();
							let inV = c.getAbsoluteInVector();
							let outV = c.getAbsoluteOutVector();

							let key = inV.x + "," + inV.y + "," + inV.z + "|" + outV.x + "," + outV.y + "," + outV.z;
							if (seen[key]) continue;
							seen[key] = true;

							let vecA = new Vector3f(inV.x, inV.y, inV.z);
							let vecB = new Vector3f(outV.x, outV.y, outV.z);

							let pantoIntersects = tryGetProjectedIntersection(vecA, vecB, pantoVec1Glob, pantoVec2Glob, projectPlaneNormal);

							if (pantoIntersects && pantoIntersects[2] < upperBound && pantoIntersects[2] > lowerBound) {
								result.push({
									wireCoef: pantoIntersects[0],
									pantoCoef: pantoIntersects[1],
									signedDistance: pantoIntersects[2],
									vecA: vecA,
									vecB: vecB,
									catenaryRef: null,
									source: "PAW"
								});
							}
						}
					}
				}
			}
		}
	} catch (e) {
		print("PAW catenary detection error: " + e);
		return [];
	}

	return result;
}

function getLowestPossibleIntersectionCombined(train, index, pantoVec1Local, pantoVec2Local, lowerBound, upperBound) {
	checkAndWarnPawSupport();

	let msdResults;
	try {
		msdResults = getAllPossibleIntersections(train, index, pantoVec1Local, pantoVec2Local, lowerBound, upperBound);
	} catch (e) {
		msdResults = [];
	}

	if (msdResults.length > 0) {
		return msdResults.reduce((min, current) => min.signedDistance < current.signedDistance ? min : current);
	}

	let pawResults = getAllPossibleIntersectionsPAW(train, index, pantoVec1Local, pantoVec2Local, lowerBound, upperBound);

	if (pawResults.length > 0) {
		return pawResults.reduce((min, current) => min.signedDistance < current.signedDistance ? min : current);
	}

	return null;
}

// ============================================================================
// EgEhE's Shared Lib Pantograph Utilities
// ============================================================================

/**
 * Upload parted OBJ models and set render types based on group names.
 */
function uploadPartedModels(rawModels, removeRenderType, invertV, invertU, packName) {
	if (!rawModels) return {};
	invertU = invertU ?? false;
	invertV = invertV ?? false;

	var result = {};
	for (var it = rawModels.entrySet().iterator(); it.hasNext(); ) {
		var entry = it.next();

		var jsStringKey = "" + entry.getKey(); 
		if (jsStringKey.includes("__int__")) {
			entry.getValue().setAllRenderType("interior");
			if (removeRenderType) jsStringKey = jsStringKey.replace("__int__", "");
		} else if (jsStringKey.includes("__light__")) {
			entry.getValue().setAllRenderType("light");
			if (removeRenderType) jsStringKey = jsStringKey.replace("__light__", "");
		} else if (jsStringKey.includes("__window__")) {
			entry.getValue().setAllRenderType("exteriortranslucent");
			if (removeRenderType) jsStringKey = jsStringKey.replace("__window__", "");
		} else if (jsStringKey.includes("__windowint__")) {
			entry.getValue().setAllRenderType("interiortranslucent");
			if (removeRenderType) jsStringKey = jsStringKey.replace("__windowint__", "");
		} 

		print((packName == undefined ? "" : packName + ": ") + "registering part " + jsStringKey + "...");
		entry.getValue().applyUVMirror(invertU, invertV);
		result[jsStringKey] = ModelManager.upload(entry.getValue());
	}
	return result;
}

/**
 * Checks whether the train is currently parked in a depot (not on route).
 */
function isTrainInDepot(train) {
	if (!train) return false;
	try {
		if (train.getIsOnRoute) {
			return !train.getIsOnRoute();
		}
	} catch (e1) {}
	try {
		if (train.isOnRoute) {
			return !train.isOnRoute();
		}
	} catch (e2) {}
	try {
		var mtrVehicle = train.getMtrVehicle();
		if (mtrVehicle && mtrVehicle.getIsOnRoute) {
			return !mtrVehicle.getIsOnRoute();
		}
	} catch (e3) {}
	return false;
}

/**
 * Resolves the pantograph configuration for a given vehicle ID from a config dictionary.
 */
function getPantoConfigForVehicle(vehicleId, configMap) {
	if (!vehicleId) return null;
	var cfg = configMap || (typeof PANTO_VEHICLE_CONFIG !== "undefined" ? PANTO_VEHICLE_CONFIG : null);
	if (!cfg) return null;

	var cleanId = String(vehicleId).toLowerCase();
	if (cleanId.indexOf("1np") !== -1) {
		return null;
	}

	for (var key in cfg) {
		if (cleanId.indexOf(key.toLowerCase()) !== -1) {
			return cfg[key];
		}
	}
	return null;
}

/**
 * Searches and caches catenary wire intersection for a single car.
 */
function updateCachedCatenaryPerCar(train, state, i, config, lowerBound, upperBound) {
	var lower = lowerBound ?? (typeof pantoLowerTreshold !== "undefined" ? pantoLowerTreshold : -3.0);
	var upper = upperBound ?? (typeof pantoUpperTreshold !== "undefined" ? pantoUpperTreshold : 3.0);

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
			state.dynPantoCached[i] = getLowestPossibleIntersectionCombined(train, i, p1, p2, lower, upper);
		} else if ((projectedIntersection[0] < 0 || projectedIntersection[0] > 1) ||
				 (projectedIntersection[1] < 0 || projectedIntersection[1] > 1) || 
				 (projectedIntersection[2] < lower || projectedIntersection[2] > upper)) {
			state.dynPantoCached[i] = getLowestPossibleIntersectionCombined(train, i, p1, p2, lower, upper);
		} else {
			state.dynPantoCached[i].wireCoef = projectedIntersection[0];
			state.dynPantoCached[i].pantoCoef = projectedIntersection[1];
			state.dynPantoCached[i].signedDistance = projectedIntersection[2];
		}
	} else if (state.pantoRateLimit && state.pantoRateLimit.shouldUpdate()) {
		state.dynPantoCached[i] = getLowestPossibleIntersectionCombined(train, i, p1, p2, lower, upper);
	}
}


// ============================================================================
// DYNAMIC OBJ PANTOGRAPH RIG & KINEMATICS ENGINE
// ============================================================================

/**
 * Loads and constructs a self-solving pantograph rig from an OBJ model file.
 * Auto-detects pivot joints from "# pivot <part>" headers or pure 3D vertex clustering.
 * Automatically computes 2-link IK and optional 4-bar coupling linkage (p4).
 * 
 * @param {string|Identifier} modelPath - Model path identifier (e.g. "mtr:panto/abb_panto.obj")
 * @param {Object} [overrides] - Optional overrides { base: [y, z], elbow: [y, z], tip: [y, z], p4_base: [y, z], p4_elbow: [y, z] }
 * @returns {Object|null} PantoRig instance
 */
function loadPantoRigFromObj(modelPath, overrides) {
	if (!modelPath) return null;

	var objText = null;
	try {
		if (typeof Resources !== "undefined" && typeof Resources.readString === "function") {
			var id = null;
			if (typeof modelPath === "string") {
				if (modelPath.indexOf(":") !== -1) {
					id = Resources.id(modelPath);
				} else if (typeof Resources.idRelative === "function") {
					id = Resources.idRelative(modelPath);
				} else {
					id = Resources.id(modelPath);
				}
			} else {
				id = modelPath;
			}

			if (id && typeof Resources.exist === "function" && Resources.exist(id)) {
				objText = Resources.readString(id);
			}
		}
	} catch (e) {
		print("[PantoRig] Failed to read OBJ model via Resources: " + e);
	}

	if (!objText) {
		print("[PantoRig] Warning: OBJ text could not be loaded for: " + modelPath);
		return null;
	}

	return createPantoRigFromText(String(objText), overrides);
}

function createPantoRigFromText(objText, overrides) {
	overrides = overrides || {};
	var raw = "" + objText;
	raw = raw.replace(/\r/g, "");
	var lines = raw.split("\n");
	var explicitPivots = {};
	var groupVerts = {};
	var curGroup = null;

	for (var i = 0; i < lines.length; i++) {
		var line = ("" + lines[i]).trim();
		if (line.length === 0) continue;
		if (line.charAt(0) === "#") {
			var m = line.match(/^#\s*pivot\s+(\w+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/i);
			if (m) {
				explicitPivots[("" + m[1]).toLowerCase()] = {
					x: parseFloat(m[2]),
					y: parseFloat(m[3]),
					z: parseFloat(m[4])
				};
			}
			continue;
		}
		if (line.indexOf("g ") === 0) {
			curGroup = ("" + line.substring(2)).trim();
			if (!groupVerts[curGroup]) groupVerts[curGroup] = [];
			continue;
		}
		if (curGroup && line.indexOf("v ") === 0) {
			var parts = ("" + line.substring(2)).trim().split(/\s+/);
			if (parts.length >= 3) {
				groupVerts[curGroup].push([parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2])]);
			}
		}
	}

	function getCenter(verts) {
		var y = 0, z = 0;
		for (var k = 0; k < verts.length; k++) {
			y += verts[k][1];
			z += verts[k][2];
		}
		return { y: y / verts.length, z: z / verts.length };
	}

	function findClosestCluster(vListA, vListB, maxDist) {
		if (!vListA || !vListB || vListA.length === 0 || vListB.length === 0) return { y: 0, z: 0 };
		maxDist = maxDist || 0.15;
		var pairs = [];
		for (var a = 0; a < vListA.length; a++) {
			var va = vListA[a];
			for (var b = 0; b < vListB.length; b++) {
				var vb = vListB[b];
				var dy = va[1] - vb[1], dz = va[2] - vb[2], dx = va[0] - vb[0];
				var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
				if (d <= maxDist) {
					pairs.push({ va: va, vb: vb, d: d });
				}
			}
		}
		pairs.sort(function(p1, p2) { return p1.d - p2.d; });
		if (pairs.length === 0) {
			var bestDist = Infinity, bestA = vListA[0], bestB = vListB[0];
			for (var a2 = 0; a2 < vListA.length; a2++) {
				for (var b2 = 0; b2 < vListB.length; b2++) {
					var v1 = vListA[a2], v2 = vListB[b2];
					var d2 = Math.sqrt((v1[0]-v2[0])*(v1[0]-v2[0]) + (v1[1]-v2[1])*(v1[1]-v2[1]) + (v1[2]-v2[2])*(v1[2]-v2[2]));
					if (d2 < bestDist) { bestDist = d2; bestA = v1; bestB = v2; }
				}
			}
			return { y: (bestA[1] + bestB[1]) / 2, z: (bestA[2] + bestB[2]) / 2 };
		}
		var topCount = Math.min(12, pairs.length);
		var sy = 0, sz = 0;
		for (var t = 0; t < topCount; t++) {
			sy += (pairs[t].va[1] + pairs[t].vb[1]) / 2;
			sz += (pairs[t].va[2] + pairs[t].vb[2]) / 2;
		}
		return { y: sy / topCount, z: sz / topCount };
	}

	var base = overrides.base ? { y: overrides.base[0], z: overrides.base[1] }
		: (explicitPivots.p1 ? { y: explicitPivots.p1.y, z: explicitPivots.p1.z } : null);

	var elbow = overrides.elbow ? { y: overrides.elbow[0], z: overrides.elbow[1] }
		: (explicitPivots.p2 ? { y: explicitPivots.p2.y, z: explicitPivots.p2.z } : null);

	var tip = overrides.tip ? { y: overrides.tip[0], z: overrides.tip[1] }
		: (explicitPivots.p3 ? { y: explicitPivots.p3.y, z: explicitPivots.p3.z } : null);

	var p4_base = overrides.p4_base ? { y: overrides.p4_base[0], z: overrides.p4_base[1] }
		: (explicitPivots.p4 ? { y: explicitPivots.p4.y, z: explicitPivots.p4.z } : null);

	var p4_elbow = overrides.p4_elbow ? { y: overrides.p4_elbow[0], z: overrides.p4_elbow[1] }
		: (explicitPivots.p4_elbow ? { y: explicitPivots.p4_elbow.y, z: explicitPivots.p4_elbow.z } : null);

	if (!elbow && groupVerts.p1 && groupVerts.p2) {
		elbow = findClosestCluster(groupVerts.p1, groupVerts.p2, 0.15);
	}
	if (!tip && groupVerts.p2 && groupVerts.p3) {
		tip = findClosestCluster(groupVerts.p2, groupVerts.p3, 0.15);
	}
	if (!base && groupVerts.p1) {
		var p1Copy = groupVerts.p1.slice().sort(function(a, b) { return a[1] - b[1]; });
		var lowP1 = p1Copy.slice(0, Math.min(8, p1Copy.length));
		if (groupVerts.p_base) {
			base = findClosestCluster(lowP1, groupVerts.p_base, 0.25);
		} else {
			base = getCenter(lowP1);
		}
	}

	if ((!p4_base || !p4_elbow) && groupVerts.p4 && groupVerts.p4.length > 0 && elbow) {
		var p4Verts = groupVerts.p4;
		var maxD = 0, pA = p4Verts[0], pB = p4Verts[0];
		for (var i1 = 0; i1 < p4Verts.length; i1++) {
			for (var i2 = 0; i2 < p4Verts.length; i2++) {
				var d12 = Math.sqrt(
					(p4Verts[i1][0] - p4Verts[i2][0]) * (p4Verts[i1][0] - p4Verts[i2][0]) +
					(p4Verts[i1][1] - p4Verts[i2][1]) * (p4Verts[i1][1] - p4Verts[i2][1]) +
					(p4Verts[i1][2] - p4Verts[i2][2]) * (p4Verts[i1][2] - p4Verts[i2][2])
				);
				if (d12 > maxD) { maxD = d12; pA = p4Verts[i1]; pB = p4Verts[i2]; }
			}
		}
		var clA = [], clB = [];
		for (var k1 = 0; k1 < p4Verts.length; k1++) {
			var vK = p4Verts[k1];
			if (Math.sqrt((vK[1]-pA[1])*(vK[1]-pA[1]) + (vK[2]-pA[2])*(vK[2]-pA[2])) < 0.2) clA.push(vK);
			if (Math.sqrt((vK[1]-pB[1])*(vK[1]-pB[1]) + (vK[2]-pB[2])*(vK[2]-pB[2])) < 0.2) clB.push(vK);
		}
		var ptA = getCenter(clA), ptB = getCenter(clB);
		var distA = Math.sqrt((ptA.y - elbow.y)*(ptA.y - elbow.y) + (ptA.z - elbow.z)*(ptA.z - elbow.z));
		var distB = Math.sqrt((ptB.y - elbow.y)*(ptB.y - elbow.y) + (ptB.z - elbow.z)*(ptB.z - elbow.z));
		if (!p4_elbow) p4_elbow = distA < distB ? ptA : ptB;
		if (!p4_base) p4_base = distA < distB ? ptB : ptA;
	}

	if (!base || !elbow || !tip) {
		print("[PantoRig] ERROR: Unable to resolve essential pivots. base=" + (base ? ("y=" + base.y.toFixed(4) + " z=" + base.z.toFixed(4)) : "MISSING") + " elbow=" + (elbow ? ("y=" + elbow.y.toFixed(4) + " z=" + elbow.z.toFixed(4)) : "MISSING") + " tip=" + (tip ? ("y=" + tip.y.toFixed(4) + " z=" + tip.z.toFixed(4)) : "MISSING"));
		return null;
	}

	var l1 = Math.sqrt((elbow.z - base.z) * (elbow.z - base.z) + (elbow.y - base.y) * (elbow.y - base.y));
	var l2 = Math.sqrt((tip.z - elbow.z) * (tip.z - elbow.z) + (tip.y - elbow.y) * (tip.y - elbow.y));
	var baseAngle1 = Math.atan2(elbow.y - base.y, elbow.z - base.z);
	var restAngle2Abs = Math.atan2(tip.y - elbow.y, tip.z - elbow.z);
	var restTheta2 = restAngle2Abs - baseAngle1;
	var hasP4 = !!p4_base && !!p4_elbow;
	var p4RestAngle = hasP4 ? Math.atan2(p4_elbow.y - p4_base.y, p4_elbow.z - p4_base.z) : 0;

	print("[PantoRig] Rig configured successfully from OBJ:");
	print("  Base Pivot:  y=" + base.y.toFixed(5) + " z=" + base.z.toFixed(5));
	print("  Elbow Pivot: y=" + elbow.y.toFixed(5) + " z=" + elbow.z.toFixed(5));
	print("  Tip Pivot:   y=" + tip.y.toFixed(5) + " z=" + tip.z.toFixed(5));
	if (hasP4) {
		print("  p4 Coupling: base=[y=" + p4_base.y.toFixed(5) + ", z=" + p4_base.z.toFixed(5) + "] elbow=[y=" + p4_elbow.y.toFixed(5) + ", z=" + p4_elbow.z.toFixed(5) + "]");
	}

	return {
		pivots: {
			base: base,
			elbow: elbow,
			tip: tip,
			p4_base: p4_base,
			p4_elbow: p4_elbow
		},
		kinematics: {
			l1: l1,
			l2: l2,
			baseAngle1: baseAngle1,
			restTheta2: restTheta2,
			hasP4: hasP4,
			p4RestAngle: p4RestAngle
		},
		calculate: function(currentHeight) {
			var pantoAngle1 = 0, pantoAngle2 = 0, pantoAngle4 = 0;
			var ik = tryFind2dInverseKinematicsPanto(base.z, base.y, tip.z, currentHeight, l1, l2);
			if (ik) {
				var v = (Math.sign(ik[0].theta2) === Math.sign(restTheta2)) ? ik[0] : ik[1];
				pantoAngle1 = -(v.theta1 - baseAngle1);
				pantoAngle2 = -(v.theta2 - restTheta2);

				if (hasP4) {
					var dy_CB = p4_elbow.y - elbow.y;
					var dz_CB = p4_elbow.z - elbow.z;
					var cy2 = elbow.y + dy_CB * Math.cos(pantoAngle2) - dz_CB * Math.sin(pantoAngle2);
					var cz2 = elbow.z + dy_CB * Math.sin(pantoAngle2) + dz_CB * Math.cos(pantoAngle2);

					var dy_BA = cy2 - base.y;
					var dz_BA = cz2 - base.z;
					var cy_world = base.y + dy_BA * Math.cos(pantoAngle1) - dz_BA * Math.sin(pantoAngle1);
					var cz_world = base.z + dy_BA * Math.sin(pantoAngle1) + dz_BA * Math.cos(pantoAngle1);

					var currentAngle4 = Math.atan2(cy_world - p4_base.y, cz_world - p4_base.z);
					pantoAngle4 = -(currentAngle4 - p4RestAngle);
				}
			}
			return {
				angle1: pantoAngle1,
				angle2: pantoAngle2,
				angle4: pantoAngle4,
				reachable: !!ik
			};
		},
		render: function(ctx, a2, a3, a4, a5, a6, a7) {
			var state, train, carIndex, vehicleConfig, pantoModels, currentHeight, matrices;

			if (typeof a2 === "object" && a2 !== null && (typeof a4 === "number" || typeof a4 === "string")) {
				// Unified signature: render(ctx, state, train, i, config, pantoModels, [optionalHeight])
				state = a2;
				train = a3;
				carIndex = a4;
				vehicleConfig = a5;
				pantoModels = a6;

				if (!pantoModels || !vehicleConfig) return;

				if (a7 !== undefined && a7 !== null) {
					currentHeight = a7;
				} else {
					var wireRef = typeof WIRE_TRACKING_REFERENCE !== "undefined" ? WIRE_TRACKING_REFERENCE : 1.4851;
					var noWireHeight = typeof NO_WIRE_PARK_HEIGHT !== "undefined" ? NO_WIRE_PARK_HEIGHT : 1.366;
					var depotPark = typeof ENABLE_DEPOT_PARK !== "undefined" ? ENABLE_DEPOT_PARK : true;
					var depotHeight = typeof DEPOT_PARK_HEIGHT !== "undefined" ? DEPOT_PARK_HEIGHT : 0.4;

					var targetHeight = noWireHeight;
					if (depotPark && typeof isTrainInDepot === "function" && isTrainInDepot(train)) {
						targetHeight = depotHeight;
					} else if (state.dynPantoCached && state.dynPantoCached[carIndex]) {
						targetHeight = wireRef + state.dynPantoCached[carIndex].signedDistance;
					}

					if (!state.smoothPantoHeight) state.smoothPantoHeight = {};
					var dt = (typeof Timing !== "undefined" && typeof Timing.delta === "function") ? Timing.delta() : 0.05;
					if (state.smoothPantoHeight[carIndex] === undefined) {
						state.smoothPantoHeight[carIndex] = targetHeight;
					} else {
						var lerpSpeed = dt > 0 ? Math.min(1.0, dt * 18.0) : 1.0;
						state.smoothPantoHeight[carIndex] += (targetHeight - state.smoothPantoHeight[carIndex]) * lerpSpeed;
					}
					currentHeight = state.smoothPantoHeight[carIndex];
				}
				matrices = new Matrices();
			} else {
				// Explicit signature: render(ctx, carIndex, matrices, vehicleConfig, pantoModels, currentHeight)
				carIndex = a2;
				matrices = a3;
				vehicleConfig = a4;
				pantoModels = a5;
				currentHeight = a6;
				if (!pantoModels || !matrices || !vehicleConfig) return;
			}

			var angles = this.calculate(currentHeight);

			matrices.pushPose();
			matrices.translate(vehicleConfig.mountX, vehicleConfig.mountHeight, vehicleConfig.mountZ);

			if (vehicleConfig.rotationYDeg !== 0) {
				matrices.rotateY(vehicleConfig.rotationYDeg / 180.0 * Math.PI);
			}

			// 1. Base (fixed)
			if (pantoModels["p_base"]) {
				ctx.drawCarModel(pantoModels["p_base"], carIndex, matrices);
			}

			// 2. Lower arm (p1)
			matrices.pushPose();
			matrices.translate(0, base.y, base.z);
			matrices.rotateX(angles.angle1);
			matrices.translate(0, -base.y, -base.z);
			if (pantoModels["p1"]) {
				ctx.drawCarModel(pantoModels["p1"], carIndex, matrices);
			}

			// 3. Upper arm (p2)
			{
				matrices.pushPose();
				matrices.translate(0, elbow.y, elbow.z);
				matrices.rotateX(angles.angle2);
				matrices.translate(0, -elbow.y, -elbow.z);
				if (pantoModels["p2"]) {
					ctx.drawCarModel(pantoModels["p2"], carIndex, matrices);
				}

				// 4. Contact shoe / skid (p3)
				{
					matrices.pushPose();
					matrices.translate(0, tip.y, tip.z);
					matrices.rotateX(-angles.angle1 - angles.angle2);
					matrices.translate(0, -tip.y, -tip.z);
					if (pantoModels["p3"]) {
						ctx.drawCarModel(pantoModels["p3"], carIndex, matrices);
					}
					matrices.popPose();
				}
				matrices.popPose();
			}
			matrices.popPose();

			// 5. Guide / coupling rod (p4) [Optional]
			if (hasP4 && pantoModels["p4"]) {
				matrices.pushPose();
				matrices.translate(0, p4_base.y, p4_base.z);
				matrices.rotateX(angles.angle4);
				matrices.translate(0, -p4_base.y, -p4_base.z);
				ctx.drawCarModel(pantoModels["p4"], carIndex, matrices);
				matrices.popPose();
			}

			matrices.popPose();
		}
	};
}
