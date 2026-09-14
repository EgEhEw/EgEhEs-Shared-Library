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
print("PAW catenary system: " + (PAW_POSSIBILITY_FLAG ? "found, active" : "not found, disabled"));

if (!PAW_POSSIBILITY_FLAG) {
	try {
		MinecraftClient.displayMessage(
			"[Pantograph] 'Pantographs & Wires' mod isn't installed, or JCM's script restrictions are blocking it. If you need PAW support, set disableScriptRestrictions = true in config/jsblock/client.toml and restart.",
			false
		);
	} catch (e) {}
}

function checkIfPawDoable() {
	try {
		let check = Packages.de.mrjulsen.wires.graph.WireGraphManager.getClient;
		return typeof(check) == 'function';
	} catch (e) {
		return false;
	}
}

// This pack runs on Forge/NeoForge (also loads Fabric mods via Connector).
// In a Forge production environment the vanilla Minecraft class's METHODS are
// named with SRG (obfuscated) names - not "getInstance" but "m_91087_", not
// "level" but "f_91073_". Try SRG first, then fall back to the clean names /
// Yarn in case of a different loader/mapping. Whichever works gets cached,
// so subsequent calls use it directly without re-probing.
var _mcClientLevelGetter = null;

function getMcClientLevel() {
	if (_mcClientLevelGetter !== null) {
		return _mcClientLevelGetter();
	}

	try {
		let inst = Packages.net.minecraft.client.Minecraft.m_91087_();
		if (inst) {
			_mcClientLevelGetter = function() { return Packages.net.minecraft.client.Minecraft.m_91087_().f_91073_; };
			return _mcClientLevelGetter();
		}
	} catch (e) {}

	try {
		let inst = Packages.net.minecraft.client.Minecraft.getInstance();
		if (inst) {
			_mcClientLevelGetter = function() { return Packages.net.minecraft.client.Minecraft.getInstance().level; };
			return _mcClientLevelGetter();
		}
	} catch (e) {}

	try {
		let inst = Packages.net.minecraft.client.MinecraftClient.getInstance();
		if (inst) {
			_mcClientLevelGetter = function() { return Packages.net.minecraft.client.MinecraftClient.getInstance().world; };
			return _mcClientLevelGetter();
		}
	} catch (e) {}

	print("PAW ERROR: could not obtain client level by any method (SRG, Mojmap, Yarn all failed).");
	_mcClientLevelGetter = function() { return null; };
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
					let blockPos = new Packages.net.minecraft.core.BlockPos(x, y, z);
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
