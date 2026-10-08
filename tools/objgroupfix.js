#!/usr/bin/env node
/*
 * MIT License
 * 
 * Copyright (c) 2026 EgEhE
 * 
 */

/**
 * Re-injects group hierarchy ("g <group>") and optional pivot metadata ("# pivot <part>")
 * from a Blockbench .bbmodel file into an exported .obj file so Library
 * can read part groups and pivots dynamically.
 * 
 * !CONTAINS AI-GENERATED CODE!
 * 
 * Usage: node objgroupfix.js model.bbmodel model.obj [output.obj]
 */

const fs = require("fs");

function fail(msg) {
	console.error("ERROR: " + msg);
	process.exit(1);
}

const [, , bbPath, objPath, outPathArg] = process.argv;

if (!bbPath || !objPath) {
	console.log("Usage: node objgroupfix.js model.bbmodel model.obj [output.obj]");
	process.exit(1);
}

if (!fs.existsSync(bbPath)) fail(`.bbmodel not found: ${bbPath}`);
if (!fs.existsSync(objPath)) fail(`.obj not found: ${objPath}`);

const outPath = outPathArg || objPath;
const SCALE = 16; // Blockbench scale (16 units = 1 meter)

function fmt(n) {
	if (Math.abs(n) < 1e-9) return "0";
	let s = n.toFixed(5);
	return s.replace(/0+$/, "").replace(/\.$/, "");
}

// 1. Read bbmodel outliner and groups
const bb = JSON.parse(fs.readFileSync(bbPath, "utf8"));

const groupNameByUuid = new Map();
const originByGroup = new Map();

for (const g of bb.groups || []) {
	if (g.uuid && g.name) {
		groupNameByUuid.set(g.uuid, g.name);
	}
	if (g.name && g.origin) {
		originByGroup.set(g.name, g.origin);
	}
}

// Map each element to its top-level ROOT group
const elementToRootGroup = new Map();

function mapToRoot(node, rootName) {
	if (typeof node === "string") {
		elementToRootGroup.set(node, rootName);
	} else if (typeof node === "object" && node !== null) {
		const gName = rootName || node.name || groupNameByUuid.get(node.uuid);
		for (const child of node.children || []) {
			mapToRoot(child, gName);
		}
	}
}

for (const node of bb.outliner || []) {
	mapToRoot(node, null);
}

// Fallback to bb.groups if some elements were not resolved through outliner
for (const g of bb.groups || []) {
	const gName = g.name;
	for (const child of g.children || []) {
		if (typeof child === "string" && !elementToRootGroup.has(child)) {
			elementToRootGroup.set(child, gName);
		}
	}
}

// Map element names to their root groups
const elementMapByUuid = new Map();
const rootGroupNames = new Set();
const elementsByRootGroup = new Map(); // rootGroupName -> array of element names

for (const el of bb.elements || []) {
	if (!el.uuid) continue;
	elementMapByUuid.set(el.uuid, el);
	const rg = elementToRootGroup.get(el.uuid) || "default";
	rootGroupNames.add(rg);
	if (!elementsByRootGroup.has(rg)) {
		elementsByRootGroup.set(rg, []);
	}
	elementsByRootGroup.get(rg).push(el.name);
}

if (elementMapByUuid.size === 0) fail("No elements found in the bbmodel.");

console.log(`Model root groups: ${Array.from(rootGroupNames).join(", ")}`);
for (const [rg, names] of elementsByRootGroup) {
	console.log(`  Group "${rg}": ${names.length} element(s)`);
}

// Helper: build multiset (frequency map) of names
function toMultiset(arr) {
	const m = new Map();
	for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
	return m;
}

function multisetsEqual(a, b) {
	if (a.size !== b.size) return false;
	for (const [k, v] of a) {
		if (b.get(k) !== v) return false;
	}
	return true;
}

const groupMultisets = new Map();
for (const [rg, names] of elementsByRootGroup) {
	groupMultisets.set(rg, toMultiset(names));
}

// 2. Parse OBJ file, stripping any existing 'g ' declarations and old pivot headers
const objTextOriginal = fs.readFileSync(objPath, "utf8");
const rawLines = objTextOriginal.split(/\r?\n/);

const cleanLines = [];
const oEntries = []; // { lineIdx, name, verts: [] }

let currentEntry = null;

for (let i = 0; i < rawLines.length; i++) {
	const line = rawLines[i];
	// Ignore old/stale 'g ' declarations and previous auto-generated pivot comments
	if (line.startsWith("g ") || line.trim() === "g" || line.startsWith("# pivot ") || line.startsWith("# PANTOGRAPH PIVOT DATA")) {
		continue;
	}
	const lineIdx = cleanLines.length;
	cleanLines.push(line);

	if (line.startsWith("o ")) {
		const objName = line.slice(2).trim();
		currentEntry = { lineIdx, name: objName, verts: [] };
		oEntries.push(currentEntry);
	} else if (line.startsWith("v ") && currentEntry) {
		const parts = line.slice(2).trim().split(/\s+/).map(Number);
		if (parts.length >= 3 && !isNaN(parts[0])) {
			currentEntry.verts.push(parts);
		}
	}
}

if (oEntries.length === 0) fail("No 'o ' (object) declarations found in the OBJ file.");
console.log(`Found ${oEntries.length} object(s) in OBJ file.`);

// 3. Match OBJ object segments to Root Groups
const remainingGroups = new Map(groupMultisets);
const matchedBlocks = []; // { group, lineIdx, count }
let cursor = 0;

while (cursor < oEntries.length) {
	let matched = false;

	// Strategy A: Exact multiset match of object names on contiguous block
	for (const [gName, mset] of remainingGroups) {
		const size = elementsByRootGroup.get(gName).length;
		if (cursor + size <= oEntries.length) {
			const candidateNames = [];
			for (let k = cursor; k < cursor + size; k++) {
				candidateNames.push(oEntries[k].name);
			}
			const candidateMset = toMultiset(candidateNames);
			if (multisetsEqual(candidateMset, mset)) {
				matchedBlocks.push({
					group: gName,
					lineIdx: oEntries[cursor].lineIdx,
					count: size
				});
				remainingGroups.delete(gName);
				cursor += size;
				matched = true;
				break;
			}
		}
	}

	if (matched) continue;

	// Strategy B: If exact multiset match didn't find the block
	const currentName = oEntries[cursor].name;
	const candidateGroups = [];
	for (const [gName, mset] of remainingGroups) {
		if (mset.has(currentName)) {
			candidateGroups.push(gName);
		}
	}

	if (candidateGroups.length === 1) {
		const gName = candidateGroups[0];
		const size = elementsByRootGroup.get(gName).length;
		matchedBlocks.push({
			group: gName,
			lineIdx: oEntries[cursor].lineIdx,
			count: size
		});
		remainingGroups.delete(gName);
		cursor += size;
		matched = true;
		continue;
	}

	// Strategy C: Centroid distance matching
	if (candidateGroups.length > 1) {
		const verts = oEntries[cursor].verts;
		let cx = 0, cy = 0, cz = 0;
		if (verts.length > 0) {
			for (const v of verts) {
				cx += v[0];
				cy += v[1];
				cz += v[2];
			}
			cx = (cx / verts.length) * 16;
			cy = (cy / verts.length) * 16;
			cz = (cz / verts.length) * 16;
		}

		let bestGroup = null;
		let bestDist = Infinity;
		for (const gName of candidateGroups) {
			for (const elName of elementsByRootGroup.get(gName)) {
				if (elName === currentName) {
					for (const el of bb.elements || []) {
						if (el.name === currentName && elementToRootGroup.get(el.uuid) === gName) {
							const elCx = (el.from[0] + el.to[0]) / 2;
							const elCy = (el.from[1] + el.to[1]) / 2;
							const elCz = (el.from[2] + el.to[2]) / 2;
							const d = (cx - elCx) ** 2 + (cy - elCy) ** 2 + (cz - elCz) ** 2;
							if (d < bestDist) {
								bestDist = d;
								bestGroup = gName;
							}
						}
					}
				}
			}
		}

		if (bestGroup) {
			const size = elementsByRootGroup.get(bestGroup).length;
			matchedBlocks.push({
				group: bestGroup,
				lineIdx: oEntries[cursor].lineIdx,
				count: size
			});
			remainingGroups.delete(bestGroup);
			cursor += size;
			matched = true;
			continue;
		}
	}

	console.warn(`WARNING: unable to match object "${currentName}" at index ${cursor} to a group.`);
	cursor++;
}

console.log("\nAssigned Group Blocks:");
for (const b of matchedBlocks) {
	console.log(`  -> "g ${b.group}" at line ${b.lineIdx + 1} (${b.count} objects)`);
}

if (remainingGroups.size > 0) {
	console.warn(`WARNING: unassigned groups: ${Array.from(remainingGroups.keys()).join(", ")}`);
}

// 4. Inject group headers ('g <name>') into cleanLines
matchedBlocks.sort((a, b) => b.lineIdx - a.lineIdx);
for (const b of matchedBlocks) {
	cleanLines.splice(b.lineIdx, 0, `g ${b.group}`);
}

// 5. Calculate and Inject Pivot Metadata Headers into OBJ
const pivotLines = [];

function getOrigin(name) {
	const o = originByGroup.get(name);
	if (!o) return null;
	return { y: o[1] / SCALE, z: o[2] / SCALE };
}

const p1Origin = getOrigin("p1");
const p2Origin = getOrigin("p2");
const p3Origin = getOrigin("p3");

if (p1Origin) pivotLines.push(`# pivot p1 0 ${fmt(p1Origin.y)} ${fmt(p1Origin.z)}`);
if (p2Origin) pivotLines.push(`# pivot p2 0 ${fmt(p2Origin.y)} ${fmt(p2Origin.z)}`);
if (p3Origin) pivotLines.push(`# pivot p3 0 ${fmt(p3Origin.y)} ${fmt(p3Origin.z)}`);

// p4 coupling rod calculation if present
const p4Group = (bb.groups || []).find(g => g.name === "p4");
if (p4Group && originByGroup.has("p4") && p2Origin) {
	function getElementCorners(el) {
		return [
			[el.from[0], el.from[1], el.from[2]],
			[el.to[0], el.from[1], el.from[2]],
			[el.from[0], el.to[1], el.from[2]],
			[el.to[0], el.to[1], el.from[2]],
			[el.from[0], el.from[1], el.to[2]],
			[el.to[0], el.from[1], el.to[2]],
			[el.to[0], el.to[1], el.to[2]],
			[el.to[0], el.to[1], el.to[2]],
		];
	}

	function rotatePoint(p, origin, rotDeg) {
		let x = p[0] - origin[0], y = p[1] - origin[1], z = p[2] - origin[2];
		const rad = deg => deg * Math.PI / 180;
		if (rotDeg[0]) {
			const c = Math.cos(rad(rotDeg[0])), s = Math.sin(rad(rotDeg[0]));
			const ny = y * c - z * s, nz = y * s + z * c;
			y = ny; z = nz;
		}
		if (rotDeg[1]) {
			const c = Math.cos(rad(rotDeg[1])), s = Math.sin(rad(rotDeg[1]));
			const nx = x * c + z * s, nz = -x * s + z * c;
			x = nx; z = nz;
		}
		if (rotDeg[2]) {
			const c = Math.cos(rad(rotDeg[2])), s = Math.sin(rad(rotDeg[2]));
			const nx = x * c - y * s, ny = x * s + y * c;
			x = nx; y = ny;
		}
		return [x + origin[0], y + origin[1], z + origin[2]];
	}

	let p4Uuids = [];
	function findUuids(node) {
		if (typeof node === "string") p4Uuids.push(node);
		else if (node && node.children) node.children.forEach(findUuids);
	}
	for (const o of (bb.outliner || [])) {
		if (o.uuid === p4Group.uuid || o.name === "p4") findUuids(o);
	}
	for (const c of (p4Group.children || [])) {
		if (typeof c === "string" && !p4Uuids.includes(c)) p4Uuids.push(c);
	}

	const p4Verts = [];
	for (const id of p4Uuids) {
		const el = (bb.elements || []).find(e => e.uuid === id);
		if (!el) continue;
		for (const c of getElementCorners(el)) {
			let p = c;
			if (el.rotation && el.origin) p = rotatePoint(p, el.origin, el.rotation);
			p4Verts.push(p);
		}
	}

	const endA = p4Group.origin;
	if (p4Verts.length > 0) {
		p4Verts.sort((a, b) => {
			const da = Math.hypot(a[1] - endA[1], a[2] - endA[2]);
			const db = Math.hypot(b[1] - endA[1], b[2] - endA[2]);
			return db - da;
		});
		const furthest = p4Verts.slice(0, Math.min(8, p4Verts.length));
		let endBY = 0, endBZ = 0;
		for (const p of furthest) { endBY += p[1]; endBZ += p[2]; }
		endBY /= furthest.length;
		endBZ /= furthest.length;
		const endB = [0, endBY, endBZ];

		const p2Raw = originByGroup.get("p2");
		const distAtoP2 = Math.hypot(endA[1] - p2Raw[1], endA[2] - p2Raw[2]);
		const distBtoP2 = Math.hypot(endB[1] - p2Raw[1], endB[2] - p2Raw[2]);

		const p4Elbow = distAtoP2 < distBtoP2 ? endA : endB;
		const p4Base = distAtoP2 < distBtoP2 ? endB : endA;

		const elbowY = p4Elbow[1] / SCALE;
		const elbowZ = p4Elbow[2] / SCALE;
		const baseY = p4Base[1] / SCALE;
		const baseZ = p4Base[2] / SCALE;

		pivotLines.push(`# pivot p4 0 ${fmt(baseY)} ${fmt(baseZ)}`);
		pivotLines.push(`# pivot p4_elbow 0 ${fmt(elbowY)} ${fmt(elbowZ)}`);
	}
}

if (pivotLines.length > 0) {
	// Find insert position right after mtllib or top comments
	let targetIdx = 0;
	for (let i = 0; i < cleanLines.length; i++) {
		if (cleanLines[i].startsWith("mtllib ") || cleanLines[i].startsWith("# Made in Blockbench")) {
			targetIdx = i + 1;
		}
	}
	cleanLines.splice(targetIdx, 0, "", "# PANTOGRAPH PIVOT DATA (auto-generated by objgroupfix.js)", ...pivotLines, "");
	console.log(`Injected ${pivotLines.length} pivot metadata line(s) into OBJ header.`);
}

const newObjText = cleanLines.join("\n");

// 6. Write updated OBJ
if (!outPathArg) {
	const backupPath = objPath + ".bak";
	fs.copyFileSync(objPath, backupPath);
	console.log(`Backup created: ${backupPath}`);
}

fs.writeFileSync(outPath, newObjText, "utf8");
console.log(`\nSuccessfully updated: ${outPath} (${matchedBlocks.length} group headers injected)`);
