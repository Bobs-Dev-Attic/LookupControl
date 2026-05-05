import { IInputs, IOutputs } from "./generated/ManifestTypes";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { SimpleLookupControlUI, PcfRecord } from "./components/SimpleLookupControl";
import { CONTROL_VERSION } from "./controlVersion";

export class SimpleLookupControl
    implements ComponentFramework.StandardControl<IInputs, IOutputs>
{
    private _container!: HTMLDivElement;
    private _context!: ComponentFramework.Context<IInputs>;
    private _notifyOutputChanged!: () => void;

    // Pending lookup value to emit on the next getOutputs() call.
    // null means no output is queued; [] means "clear the field".
    private _pendingOutput: ComponentFramework.LookupValue[] | null = null;

    // Entity metadata for the target entity, populated lazily on first search.
    private _entityMeta: {
        primaryNameAttr: string;
        primaryIdAttr:   string;
        objectTypeCode:  number;
    } | null = null;

    // Default-view FetchXML cache.
    // undefined = not yet fetched; null = unavailable; string = cached XML.
    private _defaultViewFetchXml: string | null | undefined = undefined;

    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        _state: ComponentFramework.Dictionary,
        container: HTMLDivElement
    ): void {
        this._container = container;
        this._notifyOutputChanged = notifyOutputChanged;
        context.mode.trackContainerResize(true);
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        this._context = context;
        // pcf-scripts v1.3 generates ManifestTypes with the generic Property type
        // for Lookup fields; cast to LookupValue[] which is the actual runtime shape.
        const raw = (context.parameters.lookupField as any).raw as
            ComponentFramework.LookupValue[] | null | undefined;
        const selectedRecord = this._rawToRecord(raw);

        ReactDOM.render(
            React.createElement(SimpleLookupControlUI, {
                selectedRecord,
                entityTypeKnown: selectedRecord !== null,
                version:         CONTROL_VERSION,
                isLoading:       (context.parameters.lookupField as any).loading ?? false,
                isDisabled:      context.mode.isControlDisabled,
                onSearch:        this._handleSearch,
                onSelect:        this._handleSelect,
                onOpenNativeLookup: this._handleNativeLookup,
            }),
            this._container
        );
    }

    public getOutputs(): IOutputs {
        if (this._pendingOutput === null) return {};
        const out = this._pendingOutput;
        this._pendingOutput = null;
        return { lookupField: out };
    }

    public destroy(): void {
        ReactDOM.unmountComponentAtNode(this._container);
    }

    // ---------------------------------------------------------------------------
    // Select / Clear
    // ---------------------------------------------------------------------------

    private _handleSelect = (record: PcfRecord | null): void => {
        this._pendingOutput = record
            ? [{ id: record.id, name: record.label, entityType: record.entityType ?? "" }]
            : [];
        this._notifyOutputChanged();
    };

    // ---------------------------------------------------------------------------
    // Native lookup dialog — fallback when no value is currently selected and
    // the entity type is therefore unknown. The platform resolves the target
    // entity types from the field's relationship metadata automatically.
    // ---------------------------------------------------------------------------

    private _handleNativeLookup = async (): Promise<void> => {
        try {
            const selected = await (this._context.utils as any).lookupObjects({
                allowMultiSelect: false,
                disableMru:       false,
            });
            if (selected && selected.length > 0) {
                const v = selected[0] as ComponentFramework.LookupValue;
                this._handleSelect({
                    id:         this._normaliseId(v.id),
                    label:      v.name ?? "",
                    entityType: v.entityType,
                });
            }
        } catch {
            // User dismissed the dialog — no action required.
        }
    };

    // ---------------------------------------------------------------------------
    // Search
    //
    // Empty text  → load top 10 records from the entity's default view (shown
    //               immediately when the field is focused).
    // Non-empty   → inject a "like %text%" condition into the default view's
    //               FetchXML so view-level filters are respected. Falls back to
    //               a plain OData contains() query if the view cannot be loaded.
    // ---------------------------------------------------------------------------

    private _handleSearch = async (text: string): Promise<PcfRecord[]> => {
        const ctx        = this._context;
        const raw        = (ctx.parameters.lookupField as any).raw as
            ComponentFramework.LookupValue[] | null | undefined;
        const entityType = raw?.[0]?.entityType ?? "";
        if (!entityType) return [];

        const meta = await this._getEntityMeta(entityType);
        if (!meta) return [];

        const viewXml = await this._getDefaultViewFetchXml(meta.objectTypeCode);
        const trimmed = text.trim();

        let query: string;
        if (trimmed) {
            query =
                (viewXml && this._injectSearchIntoFetchXml(
                    viewXml, meta.primaryNameAttr, meta.primaryIdAttr, trimmed
                )) ??
                this._buildBasicQuery(meta.primaryNameAttr, meta.primaryIdAttr, trimmed);
        } else {
            // No search text — show top records from the default view unfiltered.
            query =
                (viewXml && this._stripToTopN(viewXml, meta.primaryNameAttr, meta.primaryIdAttr)) ??
                `?$select=${meta.primaryNameAttr},${meta.primaryIdAttr}&$top=10`;
        }

        try {
            const result = await ctx.webAPI.retrieveMultipleRecords(entityType, query);
            return result.entities.map((e) => ({
                id:         e[meta.primaryIdAttr]    as string,
                label:      (e[meta.primaryNameAttr] as string) ?? "",
                entityType,
            }));
        } catch (err) {
            console.error("SimpleLookupControl search failed:", err);
            return [];
        }
    };

    // ---------------------------------------------------------------------------
    // FetchXML helpers
    // ---------------------------------------------------------------------------

    private async _getDefaultViewFetchXml(objectTypeCode: number): Promise<string | null> {
        if (this._defaultViewFetchXml !== undefined) return this._defaultViewFetchXml;

        try {
            const result = await this._context.webAPI.retrieveMultipleRecords(
                "savedquery",
                `?$filter=returnedtypecode eq ${objectTypeCode}` +
                ` and querytype eq 0 and isdefault eq true` +
                `&$select=fetchxml&$top=1`
            );
            const xml = (result.entities[0] as any)?.fetchxml as string | undefined;
            this._defaultViewFetchXml = xml ?? null;
        } catch {
            this._defaultViewFetchXml = null;
        }

        return this._defaultViewFetchXml;
    }

    // Strip to top N with no extra filter — used when search text is empty.
    private _stripToTopN(fetchXml: string, nameAttr: string, idAttr: string): string | null {
        return this._injectSearchIntoFetchXml(fetchXml, nameAttr, idAttr, null);
    }

    // Inject an optional "like" condition and enforce count=10.
    // text = null  → just enforce the count and ensure name/id attributes are present.
    private _injectSearchIntoFetchXml(
        fetchXml: string,
        nameAttr: string,
        idAttr: string,
        text: string | null
    ): string | null {
        try {
            const doc = new DOMParser().parseFromString(fetchXml, "text/xml");
            if (doc.querySelector("parsererror")) return null;

            const fetchEl  = doc.querySelector("fetch");
            const entityEl = fetchEl?.querySelector("entity") ?? null;
            if (!fetchEl || !entityEl) return null;

            fetchEl.setAttribute("count", "10");
            fetchEl.removeAttribute("page");
            fetchEl.removeAttribute("returntotalrecordcount");

            if (!entityEl.querySelector(":scope > all-attributes")) {
                const ensureAttr = (name: string) => {
                    if (!entityEl.querySelector(`:scope > attribute[name="${name}"]`)) {
                        const a = doc.createElement("attribute");
                        a.setAttribute("name", name);
                        entityEl.appendChild(a);
                    }
                };
                ensureAttr(nameAttr);
                ensureAttr(idAttr);
            }

            if (text) {
                const cond = doc.createElement("condition");
                cond.setAttribute("attribute", nameAttr);
                cond.setAttribute("operator",  "like");
                cond.setAttribute("value",     `%${text}%`);

                const existing = entityEl.querySelector(":scope > filter");
                if (!existing) {
                    const f = doc.createElement("filter");
                    f.setAttribute("type", "and");
                    f.appendChild(cond);
                    entityEl.appendChild(f);
                } else {
                    const filterType = (existing.getAttribute("type") ?? "and").toLowerCase();
                    if (filterType === "and") {
                        existing.appendChild(cond);
                    } else {
                        // Existing OR filter: wrap both in a new AND so they compose.
                        const wrapper = doc.createElement("filter");
                        wrapper.setAttribute("type", "and");
                        entityEl.replaceChild(wrapper, existing);
                        wrapper.appendChild(existing);
                        wrapper.appendChild(cond);
                    }
                }
            }

            return `?fetchXml=${encodeURIComponent(new XMLSerializer().serializeToString(doc))}`;
        } catch {
            return null;
        }
    }

    private _buildBasicQuery(nameAttr: string, idAttr: string, text: string): string {
        const safe = text.replace(/'/g, "''");
        return `?$select=${nameAttr},${idAttr}&$filter=contains(${nameAttr},'${safe}')&$top=10`;
    }

    // ---------------------------------------------------------------------------
    // Entity metadata (cached after first successful call)
    // ---------------------------------------------------------------------------

    private async _getEntityMeta(entityType: string): Promise<{
        primaryNameAttr: string;
        primaryIdAttr:   string;
        objectTypeCode:  number;
    } | null> {
        if (this._entityMeta) return this._entityMeta;
        try {
            const meta = await this._context.utils.getEntityMetadata(entityType);
            this._entityMeta = {
                primaryNameAttr: (meta as any).PrimaryNameAttribute as string,
                primaryIdAttr:   (meta as any).PrimaryIdAttribute   as string,
                objectTypeCode:  (meta as any).ObjectTypeCode       as number,
            };
            return this._entityMeta;
        } catch (err) {
            console.error("SimpleLookupControl: failed to fetch entity metadata:", err);
            return null;
        }
    }

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    private _rawToRecord(
        raw: ComponentFramework.LookupValue[] | null | undefined
    ): PcfRecord | null {
        if (!raw || raw.length === 0) return null;
        const v = raw[0];
        return {
            id:         this._normaliseId(v.id),
            label:      v.name ?? "",
            entityType: v.entityType,
        };
    }

    private _normaliseId(id: string): string {
        return id.replace(/^\{|\}$/g, "");
    }
}
