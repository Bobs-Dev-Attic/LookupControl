import * as React from "react";
import * as ReactDOM from "react-dom";

export interface PcfRecord {
    id: string;
    label: string;
    entityType?: string;
    tooltip?: string;
}

export interface SimpleLookupControlProps {
    selectedRecord:     PcfRecord | null;
    entityTypeKnown:    boolean;
    version?:           string;
    isLoading?:         boolean;
    isDisabled?:        boolean;
    onSearch:           (text: string) => Promise<PcfRecord[]>;
    onSelect:           (record: PcfRecord | null) => void;
    onOpenNativeLookup: () => Promise<void>;
}

const LISTBOX_ID = "slc-results-list";

// Minimal inline SVG magnifying-glass that matches Fluent UI's Search icon.
const SearchIcon: React.FC = () => (
    <svg
        className="slc-search-icon-svg"
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        aria-hidden="true"
        focusable="false"
    >
        <circle cx="6" cy="6" r="4.25" stroke="currentColor" strokeWidth="1.5" />
        <line x1="9.5" y1="9.5" x2="13" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
);

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const SimpleLookupControlUI: React.FC<SimpleLookupControlProps> = ({
    selectedRecord,
    entityTypeKnown,
    version: _version,
    isLoading,
    isDisabled,
    onSearch,
    onSelect,
    onOpenNativeLookup,
}) => {
    const [isEditing, setIsEditing]           = React.useState(false);
    const [inputText, setInputText]           = React.useState("");
    const [searchResults, setSearchResults]   = React.useState<PcfRecord[]>([]);
    const [isSearching, setIsSearching]       = React.useState(false);
    const [dropdownOpen, setDropdownOpen]     = React.useState(false);
    const [highlightedIdx, setHighlightedIdx] = React.useState(-1);
    const [dropdownPos, setDropdownPos]       = React.useState<{
        top: number; left: number; width: number;
    } | null>(null);

    const inputRef       = React.useRef<HTMLInputElement>(null);
    const fieldWrapRef   = React.useRef<HTMLDivElement>(null);
    const dropdownRef    = React.useRef<HTMLUListElement>(null);
    const debounceRef    = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const searchSeqRef   = React.useRef(0);
    // Prevents the focus event and the wrapper mousedown from both triggering
    // enterEditing when the user clicks directly on the input element.
    const activatingRef  = React.useRef(false);

    const isDropdownVisible = dropdownOpen && searchResults.length > 0;

    // ── Click-outside: close dropdown when user clicks elsewhere ─────────────

    React.useEffect(() => {
        const handler = (e: MouseEvent) => {
            const target = e.target as Node;
            const inField    = fieldWrapRef.current?.contains(target);
            const inDropdown = dropdownRef.current?.contains(target);
            if (!inField && !inDropdown) exitEditing();
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    // ── Cleanup on unmount ────────────────────────────────────────────────────

    React.useEffect(() => {
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, []);

    // ── Portal repositioning ──────────────────────────────────────────────────

    React.useLayoutEffect(() => {
        if (isDropdownVisible && inputRef.current) {
            const r = inputRef.current.getBoundingClientRect();
            setDropdownPos({ top: r.bottom + 1, left: r.left, width: r.width });
        }
    }, [isDropdownVisible, searchResults]);

    React.useEffect(() => {
        if (!isDropdownVisible) return;
        const reposition = () => {
            if (!inputRef.current) return;
            const r = inputRef.current.getBoundingClientRect();
            setDropdownPos({ top: r.bottom + 1, left: r.left, width: r.width });
        };
        window.addEventListener("scroll", reposition, true);
        window.addEventListener("resize", reposition);
        return () => {
            window.removeEventListener("scroll", reposition, true);
            window.removeEventListener("resize", reposition);
        };
    }, [isDropdownVisible]);

    // ── Editing helpers ───────────────────────────────────────────────────────

    const exitEditing = () => {
        setIsEditing(false);
        setInputText("");
        setSearchResults([]);
        setDropdownOpen(false);
        setHighlightedIdx(-1);
        if (debounceRef.current) clearTimeout(debounceRef.current);
    };

    const enterEditing = async () => {
        if (activatingRef.current || isEditing) return;
        activatingRef.current = true;
        setIsEditing(true);
        setInputText("");
        setHighlightedIdx(-1);

        const seq = ++searchSeqRef.current;
        setIsSearching(true);
        try {
            const results = await onSearch("");
            if (seq !== searchSeqRef.current) return;
            setSearchResults(results);
            setDropdownOpen(results.length > 0);
        } catch {
            if (seq === searchSeqRef.current) {
                setSearchResults([]);
                setDropdownOpen(false);
            }
        } finally {
            if (seq === searchSeqRef.current) setIsSearching(false);
            // Delay reset by one tick so the concurrent mousedown+focus pair
            // both see activatingRef=true and only one triggers enterEditing.
            setTimeout(() => { activatingRef.current = false; }, 0);
        }
    };

    // ── Event handlers ────────────────────────────────────────────────────────

    // Wrapper mousedown: fires for clicks on the wrapper background (not the
    // input itself) and for clicks when entity type is unknown (native dialog).
    const handleWrapperMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        if (isDisabled) return;
        const target = e.target as HTMLElement;
        // Let the input's own focus event handle clicks that land on it.
        if (target === inputRef.current) return;
        // Clear/search buttons handle themselves.
        if (target.closest(".slc-clear-btn, .slc-search-btn")) return;

        if (!entityTypeKnown) {
            e.preventDefault(); // don't focus the (readonly) input
            onOpenNativeLookup();
        } else if (!isEditing) {
            // Focusing the input triggers handleInputFocus → enterEditing.
            e.preventDefault();
            inputRef.current?.focus();
        }
    };

    // Input focus: the single entry point for Tab-navigation and direct clicks.
    const handleInputFocus = async () => {
        if (isDisabled || isEditing) return;
        if (!entityTypeKnown) {
            // In native mode the input must not stay focused — blur immediately
            // so there is no blinking cursor, then open the platform dialog.
            requestAnimationFrame(() => inputRef.current?.blur());
            await onOpenNativeLookup();
        } else {
            await enterEditing();
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const text = e.target.value;
        setInputText(text);
        setHighlightedIdx(-1);
        if (debounceRef.current) clearTimeout(debounceRef.current);

        debounceRef.current = setTimeout(async () => {
            const seq = ++searchSeqRef.current;
            setIsSearching(true);
            try {
                const results = await onSearch(text);
                if (seq !== searchSeqRef.current) return;
                setSearchResults(results);
                setDropdownOpen(results.length > 0);
            } catch {
                if (seq !== searchSeqRef.current) return;
                setSearchResults([]);
                setDropdownOpen(false);
            } finally {
                if (seq === searchSeqRef.current) setIsSearching(false);
            }
        }, 200);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Escape") { exitEditing(); return; }
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlightedIdx((i) => Math.min(i + 1, searchResults.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlightedIdx((i) => Math.max(i - 1, -1));
        } else if (e.key === "Enter") {
            if (highlightedIdx >= 0 && highlightedIdx < searchResults.length) {
                selectRecord(searchResults[highlightedIdx]);
            }
        }
    };

    const selectRecord = (record: PcfRecord) => {
        exitEditing();
        onSelect(record);
    };

    const handleClear = (e: React.MouseEvent) => {
        e.stopPropagation();
        onSelect(null);
    };

    const handleSearchBtnClick = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isDisabled) return;
        if (!entityTypeKnown) {
            await onOpenNativeLookup();
        } else if (!isEditing) {
            inputRef.current?.focus();
        }
    };

    // ── Render ────────────────────────────────────────────────────────────────

    if (isLoading) {
        return (
            <div className="slc-root">
                <div className={`slc-field-wrap slc-field-wrap--disabled`}>
                    <span className="slc-input slc-input--placeholder">Loading…</span>
                </div>
            </div>
        );
    }

    const displayText    = isEditing ? inputText : (selectedRecord?.label ?? "");
    const showPlaceholder = !isEditing && !selectedRecord;
    const showClear      = !!selectedRecord && !isDisabled;

    return (
        <div className="slc-root">
            {/* ── Field wrapper: text input + search icon ───────────────────── */}
            <div
                ref={fieldWrapRef}
                className={[
                    "slc-field-wrap",
                    isEditing              ? "slc-field-wrap--editing"  : "",
                    isDisabled             ? "slc-field-wrap--disabled" : "",
                ].filter(Boolean).join(" ")}
                onMouseDown={handleWrapperMouseDown}
            >
                <input
                    ref={inputRef}
                    type="text"
                    className={`slc-input${isSearching ? " slc-input--busy" : ""}`}
                    value={displayText}
                    placeholder={showPlaceholder ? "---" : ""}
                    readOnly={!isEditing || isDisabled}
                    disabled={false}
                    onChange={handleInputChange}
                    onFocus={handleInputFocus}
                    onKeyDown={handleKeyDown}
                    role="combobox"
                    aria-label="Lookup field"
                    aria-expanded={isDropdownVisible}
                    aria-haspopup="listbox"
                    aria-controls={LISTBOX_ID}
                    aria-autocomplete="list"
                    aria-activedescendant={
                        highlightedIdx >= 0 ? `slc-item-${highlightedIdx}` : undefined
                    }
                    autoComplete="off"
                />

                {/* Search button — decorative when editing, opens native dialog when entity unknown */}
                <button
                    className="slc-search-btn"
                    tabIndex={-1}
                    title="Search"
                    aria-label="Search for a record"
                    disabled={isDisabled}
                    onMouseDown={(e) => e.preventDefault()} // prevent input blur on click
                    onClick={handleSearchBtnClick}
                >
                    <SearchIcon />
                </button>

                {/* Portalled dropdown — position:fixed to escape overflow:hidden ancestors */}
                {isDropdownVisible && dropdownPos && ReactDOM.createPortal(
                    <ul
                        ref={dropdownRef}
                        id={LISTBOX_ID}
                        className="slc-dropdown"
                        role="listbox"
                        aria-label="Search results"
                        style={{
                            position: "fixed",
                            top:      dropdownPos.top,
                            left:     dropdownPos.left,
                            width:    dropdownPos.width,
                        }}
                    >
                        {searchResults.map((result, idx) => (
                            <li
                                key={result.id}
                                id={`slc-item-${idx}`}
                                className={[
                                    "slc-dropdown-item",
                                    idx === highlightedIdx ? "slc-dropdown-item--highlighted" : "",
                                ].filter(Boolean).join(" ")}
                                role="option"
                                aria-selected={idx === highlightedIdx}
                                title={result.tooltip ?? result.label}
                                onMouseEnter={() => setHighlightedIdx(idx)}
                                onMouseDown={(e) => {
                                    e.preventDefault(); // keep input focused
                                    selectRecord(result);
                                }}
                            >
                                {result.label}
                            </li>
                        ))}
                    </ul>,
                    document.body
                )}
            </div>

            {/* ── Clear button — sits outside the field border, like D365 ────── */}
            {showClear && (
                <button
                    className="slc-clear-btn"
                    tabIndex={-1}
                    title={`Clear ${selectedRecord!.label}`}
                    aria-label={`Clear ${selectedRecord!.label}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleClear}
                >
                    ×
                </button>
            )}
        </div>
    );
};
