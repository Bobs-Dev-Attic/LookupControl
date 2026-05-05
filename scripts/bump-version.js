#!/usr/bin/env node
// Increments the patch segment of the control version before every rebuild.
// Auto-detects the control folder by looking for ControlManifest.Input.xml.
// Updates:
//   {ControlFolder}/ControlManifest.Input.xml   (version attribute)
//   SolutionPack/Other/Solution.xml              (<Version> element)
//   {ControlFolder}/controlVersion.ts            (CONTROL_VERSION export)

const fs   = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

// ── Auto-detect control folder ────────────────────────────────────────────────

const SKIP_DIRS = new Set(["node_modules", "out", "obj", "pcf_template", ".git", "scripts", "SolutionPack"]);

const controlFolder = fs.readdirSync(root).find(d => {
    if (SKIP_DIRS.has(d)) return false;
    try {
        return (
            fs.statSync(path.join(root, d)).isDirectory() &&
            fs.existsSync(path.join(root, d, "ControlManifest.Input.xml"))
        );
    } catch {
        return false;
    }
});

if (!controlFolder) {
    console.error("bump-version: could not find a folder containing ControlManifest.Input.xml");
    process.exit(1);
}

// ── Read current version from manifest ───────────────────────────────────────

const manifestPath = path.join(root, controlFolder, "ControlManifest.Input.xml");
const manifestSrc  = fs.readFileSync(manifestPath, "utf8");
const match        = manifestSrc.match(/version="(\d+)\.(\d+)\.(\d+)"/);

if (!match) {
    console.error("bump-version: could not find version=\"X.Y.Z\" in ControlManifest.Input.xml");
    process.exit(1);
}

const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
const newPatch        = patch + 1;
const controlVersion  = `${major}.${minor}.${newPatch}`;
const solutionVersion = `${major}.${minor}.${newPatch}.0`;

// ── Update manifest ───────────────────────────────────────────────────────────

fs.writeFileSync(
    manifestPath,
    manifestSrc.replace(/version="\d+\.\d+\.\d+"/, `version="${controlVersion}"`),
    "utf8"
);

// ── Update Solution.xml ───────────────────────────────────────────────────────

const solutionPath = path.join(root, "SolutionPack", "Other", "Solution.xml");
if (fs.existsSync(solutionPath)) {
    const src = fs.readFileSync(solutionPath, "utf8");
    fs.writeFileSync(
        solutionPath,
        src.replace(/<Version>\d+\.\d+\.\d+\.\d+<\/Version>/, `<Version>${solutionVersion}</Version>`),
        "utf8"
    );
}

// ── Write version constant ────────────────────────────────────────────────────

const versionTsPath = path.join(root, controlFolder, "controlVersion.ts");
fs.writeFileSync(
    versionTsPath,
    `export const CONTROL_VERSION = "${controlVersion}";\n`,
    "utf8"
);

console.log(`bump-version: ${major}.${minor}.${patch} → ${controlVersion}`);
