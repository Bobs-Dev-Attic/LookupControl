# PCF Template — Guide for Claude Code and Codex

## What This Is

A working PowerApps Component Framework (PCF) control that renders a Dataverse subgrid as
keyword/tag chips. Records associated with the parent entity record appear as removable chips;
a search field lets you find and associate new records. Works for both 1:N and N:N relationships.

Use this as a starting point for any PCF control that needs to read a subgrid dataset and perform
associate/disassociate operations against the Dataverse API.

See `ARCHITECTURE.md` for the non-obvious Dynamics-specific implementation patterns (why OData
`/$ref`, why portalled dropdowns, why FetchXML injection). Read it before modifying `index.ts`
or the React component.

---

## Step 0: Token Replacement (do this before any build command)

Replace all five tokens across every file in this folder, then rename the physical files and
folder listed below. The tokens are chosen to be globally unique strings — a simple
project-wide find-and-replace is safe.

| Token | Meaning | Example |
|---|---|---|
| `MYNAMESPACE` | Publisher namespace, uppercase | `CFF` |
| `mynamespace` | Customization prefix, lowercase | `cff` |
| `MyPcfControl` | Class/folder/file name, PascalCase | `SubgridKeywordControl` |
| `my-pcf-control` | npm package name, lowercase-hyphen | `subgridkeywordcontrol` |
| `myc` | CSS selector prefix, 3–5 unique chars | `skc` |

**Files and folders to rename after token replacement:**
- `MyPcfControl/ControlManifest.Input.xml.template` → `MyPcfControl/ControlManifest.Input.xml`
  *(The `.template` extension prevents the parent project's build tools from discovering this file
  before setup is complete. Rename it first — all other steps depend on it.)*
- Folder: `MyPcfControl/` → `YourControlName/`
- `MyPcfControl/MyPcfControl.pcfproj` → `YourControlName/YourControlName.pcfproj`
- `MyPcfControl/components/MyPcfControl.tsx` → `YourControlName/components/YourControlName.tsx`
- `MyPcfControl/css/MyPcfControl.css` → `YourControlName/css/YourControlName.css`

**References that update automatically from token replacement:**
- `ControlManifest.Input.xml` `constructor=` attribute
- `SolutionPack/Other/Solution.xml` `<UniqueName>`, `<CustomizationPrefix>`, `schemaName`
- All `console.error` messages in `index.ts`

**References that require a manual file-content edit after renaming:**
- `tsconfig.json` → `"outDir": "out/controls/YourControlName"` and `"include": ["YourControlName/**/*"]`
- `ControlManifest.Input.xml` → `<css path="css/YourControlName.css" />`
- `index.ts` → `import { MyPcfControlUI, PcfRecord } from "./components/YourControlName";`

---

## Dependency Versions

These are pinned intentionally. Do not upgrade without reading the reason column.

| Package | Version | Reason |
|---|---|---|
| `react` / `react-dom` | `16.14.0` (exact) | PCF platform bundles React 16 in the model-driven form host. Using React 17+ causes a duplicate-React runtime error (`Cannot read property 'ReactCurrentBatchConfig'`). |
| `typescript` | `4.9.5` (exact) | `pcf-scripts` is not tested against TypeScript 5.x. Silent emit differences in TS 5 can produce a bundle that compiles but fails at runtime. |
| `pcf-scripts` | `1.3.6` (exact) | Build harness. Must match `pcf-start` minor version exactly. |
| `pcf-start` | `1.3.6` (exact) | Dev server. Mismatched minor version with `pcf-scripts` causes `start watch` to hang or crash without a useful error. |
| `@types/powerapps-component-framework` | `1.3.4` (exact) | Provides all `ComponentFramework.*` type definitions. Upgrading may introduce breaking changes that mask real runtime behaviour. |
| `Microsoft.PowerApps.MSBuild.Pcf` | `2.6.4` (in `.pcfproj`) | MSBuild SDK required by `pac solution pack` to locate build outputs. |
| `tsconfig "jsx"` | `"react"` | Must be `"react"`, NOT `"react-jsx"`. PCF does not ship `react/jsx-runtime`. Using `"react-jsx"` produces a bundle that crashes on load. |

---

## Build Commands

Run `npm install` first — there is no `node_modules/` in this template.

| Command | What it does |
|---|---|
| `npm install` | Install all dependencies. Required before any other command. |
| `npm run refreshTypes` | Generates `MyPcfControl/generated/ManifestTypes.d.ts` from `ControlManifest.Input.xml`. **Run this once after `npm install`** — `index.ts` imports from this file and TypeScript will error until it exists. |
| `npm start` | Starts the local PCF test harness at `http://localhost:8181`. No Dynamics environment needed. |
| `npm run rebuild` | Bumps patch version in manifest, `Solution.xml`, and `controlVersion.ts`, then clean-builds. |
| `npm run pack` | Copies `out/controls/MyPcfControl/` artifacts into `SolutionPack/Controls/MYNAMESPACE.MyPcfControl/`, runs `pac solution pack`, writes `MyPcfControl_X_Y_Z.zip`. |
| `npm run release` | Runs `rebuild` then `pack` in one step. Use for a complete release. |

---

## Deployment Prerequisites

1. **Install PAC CLI:** `npm install -g @microsoft/powerplatform-cli`
2. **Verify:** `pac --version`
3. **Authenticate:** `pac auth create --url https://yourorg.crm.dynamics.com`
4. **Import:** `pac solution import --path MyPcfControl_X_Y_Z.zip`
   — or via Power Apps portal: **Solutions → Import → choose zip**

**After import — add the control to a form:**
1. Open the form editor for the target entity in Power Apps
2. Add a **Subgrid** component bound to the desired related entity view
3. In the subgrid's **Controls** tab, add `MYNAMESPACE.MyPcfControl`
4. Set `displayField` to the logical column name to use as the chip label (e.g. `mynamespace_name`)
5. Set `relationshipName` to the relationship schema name (e.g. `mynamespace_parententity_relatedentity`)

---

## Project File Roles

| File | Role |
|---|---|
| `MyPcfControl/ControlManifest.Input.xml` | Declares the control namespace, constructor name, input properties (`data-set`, text inputs), resource paths, and required platform features (`WebAPI`, `Utility`). The platform reads this at import time. |
| `MyPcfControl/index.ts` | The PCF class. Implements `init`, `updateView`, `getOutputs`, `destroy`. Owns all Dataverse API calls (associate, disassociate, search, metadata lookup). Renders the React component via `ReactDOM.render`. |
| `MyPcfControl/components/MyPcfControl.tsx` | Pure React component. Receives records and async callbacks as props. Owns all UI state (search text, dropdown open/close, confirmation dialog). No direct Dataverse calls. |
| `MyPcfControl/css/MyPcfControl.css` | Scoped styles. All selectors prefixed `myc-` to avoid collision with Dynamics host page styles. |
| `MyPcfControl/controlVersion.ts` | Exports `CONTROL_VERSION` constant. Auto-updated by `scripts/bump-version.js` on every rebuild. |
| `MyPcfControl/MyPcfControl.pcfproj` | MSBuild project file. Sets `PcfBuildMode` to `production`. Required by `pac solution pack`. |
| `scripts/bump-version.js` | Node.js script. Increments the patch segment of the version across the manifest, `Solution.xml`, and `controlVersion.ts`. Auto-detects the control folder — no hardcoded paths. |
| `scripts/pack.ps1` | PowerShell script. Reads `Solution.xml` to derive control name and version, copies build artifacts to `SolutionPack/Controls/`, runs `pac solution pack`, writes the `.zip`. |
| `SolutionPack/Other/Solution.xml` | Dataverse solution manifest. Declares solution name, publisher (namespace + prefix), version, and the root component `MYNAMESPACE.MyPcfControl`. |
| `SolutionPack/Other/Customizations.xml` | Required by the solution packager. Contains `<CustomControls />`. Do not modify. |

---

## Common Mistakes

- **Wrong React version.** `react@17` or `react@18` in a model-driven form causes a duplicate-React
  runtime crash. Pin to `react@16.14.0` and `react-dom@16.14.0`.

- **Wrong `jsx` tsconfig value.** `"jsx": "react-jsx"` requires `react/jsx-runtime` which PCF does
  not bundle. The control loads then crashes. Use `"jsx": "react"`.

- **Committing `SolutionPack/Controls/`.** This directory is written fresh by `pack.ps1`. It is in
  `.gitignore`. Committing it may cause imports to use stale artifacts.

- **`pac` not on PATH.** `pack.ps1` calls `pac solution pack` directly. If the script fails with
  "pac is not recognized", install the CLI: `npm install -g @microsoft/powerplatform-cli`.

- **`outDir` / `pack.ps1` mismatch.** `tsconfig.json` sets `outDir` to `out/controls/MyPcfControl`.
  `pack.ps1` reads from `out\controls\$ControlName` where `$ControlName` comes from `Solution.xml`.
  All three must agree on the same control name after token replacement.

- **Wrong `Solution.xml` schemaName format.** The `RootComponent schemaName` must be exactly
  `MYNAMESPACE.MyPcfControl` (namespace dot PascalCase name). `pack.ps1` strips the prefix to get
  `$ControlName`. A wrong format silently produces a zip named after the wrong control.
