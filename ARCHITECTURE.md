# PCF Architecture — Dynamics 365 Patterns

This document explains the non-obvious implementation decisions in this control.
Each section describes a Dynamics constraint and how the code works around it.
Read this before modifying `index.ts` or the React component.

---

## 1. OData `/$ref` for Associate / Disassociate

**Why PCF's `webAPI` is not used:**
PCF's `context.webAPI` exposes `createRecord`, `updateRecord`, `deleteRecord`, and
`retrieveMultipleRecords` — but **not** `associateRecord` or `disassociateRecord`.
These operations require raw HTTP calls.

**How it works:**

Associate (POST):
```
POST /api/data/v9.0/{parentSet}({parentId})/{relationshipName}/$ref
Body: { "@odata.id": "https://org.crm.dynamics.com/api/data/v9.0/{childSet}({childId})" }
```

Disassociate (DELETE):
```
DELETE /api/data/v9.0/{parentSet}({parentId})/{relationshipName}({childId})/$ref
```

Works for both **1:N** (sets/clears the lookup on the child record) and **N:N** (inserts/deletes
a row in the intersect entity). The platform handles the difference transparently.

Required headers on every call:
```
Content-Type: application/json; charset=utf-8
OData-MaxVersion: 4.0
OData-Version: 4.0
Accept: application/json
credentials: include
```

`credentials: include` is required because the PCF iframe is hosted on `apps.powerapps.com`
while the API endpoint is on the org's `dynamics.com` origin. The session cookie must cross origins.

---

## 2. `getEntityMetadata` for EntitySetName

**Why not pluralise the logical name:**
OData collection names (e.g. `cff_taxonomyfieldvalues`) cannot be derived by appending `s` to the
entity logical name. Many entities have irregular collection names. `webAPI.updateRecord` and similar
make this mistake and fail silently on irregular names.

**How it works:**
```typescript
const meta = await context.utils.getEntityMetadata(entityType);
const entitySetName = (meta as any).EntitySetName as string;
```

`getEntityMetadata` is typed in `@types/powerapps-component-framework` but `EntitySetName` is not
exposed in the type definitions — use `as any`. The returned value is authoritative.

Cache in `_childEntitySet` / `_parentEntitySet` after the first call. Never call inside a hot loop.

---

## 3. `context.page` for Parent Record Identity

**Why the standard PCF API is insufficient:**
A subgrid control knows its own dataset but has no official API to discover the parent record's
ID or entity type. Both are required to build the associate/disassociate OData URL.

**How it works:**
```typescript
const parentId   = (context as any).page?.entityId       ?? "";
const parentType = (context as any).page?.entityTypeName ?? "";
```

`context.page` is not in the official type definitions but exists at runtime on model-driven forms.
It is `undefined` in the local test harness (`npm start`) — guard with optional chaining.

---

## 4. `position: fixed` Portal for the Dropdown

**Why `position: absolute` fails in Dynamics:**
Dynamics 365 form sections apply `overflow: hidden` to prevent content overflow. CSS `transform`,
`filter`, or `perspective` on any ancestor re-anchors `position: fixed` to that ancestor instead
of the viewport. Either condition clips or displaces an absolutely-positioned dropdown.

**How it works:**
```typescript
ReactDOM.createPortal(
  <ul style={{ position: "fixed", top: dropdownPos.top, left: dropdownPos.left }} />,
  document.body
)
```

Portalling to `document.body` escapes all ancestor stacking contexts. Position is computed from
`searchInputRef.current.getBoundingClientRect()` (viewport-relative). Recomputed on scroll/resize:

```typescript
window.addEventListener("scroll", update, true);  // capture: catches nested scrollers
window.addEventListener("resize", update);
```

The same portal pattern applies to the confirmation dialog.

---

## 5. FetchXML Injection for Search

**Why not a plain OData `$filter`:**
The subgrid is configured with a specific Dataverse view that may include entity filters, security
filters, or custom FetchXML. A plain `$filter` bypasses all of those, causing the search dropdown
to show records the subgrid itself would never display.

**How it works:**

1. Retrieve the view's FetchXML:
```typescript
const r   = await ctx.webAPI.retrieveRecord("savedquery", viewId, "?$select=fetchxml");
const xml = (r as any).fetchxml as string;
// Falls back to "userquery" for personal views.
```

2. Parse and mutate with the DOM API:
```typescript
const doc  = new DOMParser().parseFromString(fetchXml, "text/xml");
const cond = doc.createElement("condition");
cond.setAttribute("attribute", searchField);
cond.setAttribute("operator",  "like");
cond.setAttribute("value",     `%${text}%`);
```

3. Merge with any existing filter:
- No existing filter → wrap in new `<filter type="and">`
- Existing `AND` filter → append condition inside it
- Existing `OR` filter → wrap in a new `AND` outer filter, add condition alongside the original

4. Cap results and strip paging:
```typescript
fetchEl.setAttribute("count", "10");
fetchEl.removeAttribute("page");
fetchEl.removeAttribute("returntotalrecordcount");
```

5. Re-serialise and encode:
```typescript
const xml = new XMLSerializer().serializeToString(doc);
return `?fetchXml=${encodeURIComponent(xml)}`;
```

Falls back to `?$filter=contains(field,'text')&$top=10` if the view FetchXML cannot be retrieved.

---

## 6. Three-State FetchXML Cache

**Why three states:**
The view FetchXML lookup is async and expensive. Caching `null` as distinct from `undefined`
prevents retrying a failed lookup on every keystroke.

```typescript
private _viewFetchXml: string | null | undefined = undefined;
// undefined  →  not yet attempted; triggers one async lookup
// null       →  unavailable; skip silently, use OData fallback
// string     →  cached XML; use directly
```

Rule: once set to `null`, never reassign to `undefined`.

---

## 7. Search Result Deduplication

**Why the dataset alone is insufficient:**
After an associate operation, the platform dataset refreshes asynchronously. During the gap between
the user's click and the refresh, `dataset.sortedRecordIds` may not yet include the new record. If
the user types again before the refresh completes, the just-added record reappears in the dropdown.

**How it works:**
`_currentRecordIds: Set<string>` is updated optimistically in `_handleAssociate` /
`_handleDisassociate` before the refresh arrives, and rebuilt from `dataset.sortedRecordIds` on
every `updateView`. Search results are filtered against this set:

```typescript
result.entities.filter(e => !this._currentRecordIds.has(e[primaryKey] as string))
```

---

## 8. Confirmation Dialog — Portal + Drag

**Portal reason:** Same as the dropdown (section 4) — must escape `overflow: hidden` and
transform ancestors in the Dynamics form.

**Drag implementation:** Attaches `mousemove` / `mouseup` to `document`, not the dialog element:
```typescript
const onMouseMove = (e: MouseEvent) => {
    if (!dragging.current) return;
    setPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
};
document.addEventListener("mousemove", onMouseMove);
document.addEventListener("mouseup", () => { dragging.current = false; });
```

Attaching to `document` means fast mouse movements that exit the dialog bounds during drag
don't accidentally drop the drag. `dragOffset` stores the distance from the dialog's top-left
to where the mouse first clicked, preventing a position jump on `mousedown`.
