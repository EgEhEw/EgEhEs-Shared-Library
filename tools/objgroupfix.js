#!/usr/bin/env node
/*
 * MIT License
 * 
 * Copyright (c) 2026 EgEhE
 * 
 */

/**
 * Re-injects group hierarchy ("g <group>") from a Blockbench .bbmodel file
 * into an exported .obj file so ModelManager can read part groups properly.
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

// 1. Read bbmodel outliner and groups
const bb = JSON.parse(fs.readFileSync(bbPath, "utf8"));

const groupNameByUuid = new Map();
for (const g of bb.groups || []) {
	groupNameByUuid.set(g.uuid, g.name);
}

const elementNameByUuid = new Map();
for (const e of bb.elements || []) {
	elementNameByUuid.set(e.uuid, e.name);
}

function leafNames(node) {
	if (typeof node === "string") {
		const name = elementNameByUuid.get(node);
		if (name === undefined) {
			console.warn(`WARNING: unknown element uuid in outliner: ${node}`);
			return [];
		}
		return [name];
	}
	let names = [];
	for (const child of node.children || []) {
		names = names.concat(leafNames(child));
	}
	return names;
}

const rootGroups = (bb.outliner || []).map((node) => ({
	name: groupNameByUuid.get(node.uuid) || node.uuid,
	names: leafNames(node),
}));

const totalFromBb = rootGroups.reduce((s, g) => s + g.names.length, 0);
if (totalFromBb === 0) fail("No elements found in the bbmodel outliner.");

console.log(
	"Groups read from bbmodel: " +
	rootGroups.map((g) => `${g.name}(${g.names.length})`).join(", ")
);

// 2. Parse OBJ file for object definitions
const objTextOriginal = fs.readFileSync(objPath, "utf8");
const lines = objTextOriginal.split(/\r?\n/);

const oLineIndices = [];
const oNames = [];
for (let i = 0; i < lines.length; i++) {
	if (lines[i].startsWith("o ")) {
		oLineIndices.push(i);
		oNames.push(lines[i].slice(2).trim());
	}
}

if (oLineIndices.length === 0) fail("No 'o ' (object) declarations found in the obj file.");

if (oLineIndices.length !== totalFromBb) {
	console.warn(
		`WARNING: count mismatch (OBJ: ${oLineIndices.length}, BBModel: ${totalFromBb}). Check exported model pair.`
	);
}

// 3. Match objects with bbmodel groups
function toMultiset(arr) {
	const m = new Map();
	for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
	return m;
}

function multisetsEqual(a, b) {
	if (a.size !== b.size) return false;
	for (const [k, v] of a) if (b.get(k) !== v) return false;
	return true;
}

const insertions = [];
let cursor = 0;

for (const g of rootGroups) {
	const size = g.names.length;
	if (size === 0) continue;

	if (cursor >= oLineIndices.length) {
		console.warn(`WARNING: insufficient object entries for group "${g.name}".`);
		break;
	}

	const blockObjNames = oNames.slice(cursor, cursor + size);
	const expected = toMultiset(g.names);
	const got = toMultiset(blockObjNames);
	if (!multisetsEqual(expected, got)) {
		console.warn(`WARNING: elements mismatch for group "${g.name}".`);
	}

	insertions.push({ atLineIndex: oLineIndices[cursor], text: `g ${g.name}` });
	cursor += size;
}

// 4. Inject group headers back to front
insertions.sort((a, b) => b.atLineIndex - a.atLineIndex);
for (const ins of insertions) {
	lines.splice(ins.atLineIndex, 0, ins.text);
}

const newObjText = lines.join("\n");

// 5. Write updated OBJ
if (!outPathArg) {
	const backupPath = objPath + ".bak";
	fs.copyFileSync(objPath, backupPath);
	console.log(`Backup created: ${backupPath}`);
}

fs.writeFileSync(outPath, newObjText, "utf8");
console.log(`Done: added ${insertions.length} group declaration(s) -> ${outPath}`);