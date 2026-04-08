"use client";

import type { SelectOption } from "@/types/imf";
import { useDeferredValue, useEffect, useRef, useState } from "react";

const MAX_VISIBLE_RESULTS = 120;
const PAGE_STEP = 8;

interface CommonSearchableDropdownProps<T extends SelectOption> {
  disabled?: boolean;
  emptyMessage: string;
  extraText?: (option: T) => string;
  helperText: string;
  id: string;
  label: string;
  options: T[];
  placeholder: string;
  query: string;
  setQuery: (value: string) => void;
}

interface SingleSearchableDropdownProps<T extends SelectOption> extends CommonSearchableDropdownProps<T> {
  onChange: (value: string) => void;
  selectedValue: string;
  selectionMode?: "single";
}

interface MultipleSearchableDropdownProps<T extends SelectOption> extends CommonSearchableDropdownProps<T> {
  onChange: (values: string[]) => void;
  selectedValues: string[];
  selectionMode: "multiple";
}

type SearchableDropdownProps<T extends SelectOption> = SingleSearchableDropdownProps<T> | MultipleSearchableDropdownProps<T>;

const normalizeSearchText = (value: string): string => value.trim().toLowerCase();

const filterOptions = <T extends SelectOption>(
  options: T[],
  query: string,
  selectedValues: string[],
  extraText?: (option: T) => string,
): T[] => {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) {
    const selectedValueSet = new Set(selectedValues);
    const prioritizedSelected = options.filter((option) => selectedValueSet.has(option.value));
    const prioritizedRemaining = options.filter((option) => !selectedValueSet.has(option.value));
    return [...prioritizedSelected, ...prioritizedRemaining].slice(0, MAX_VISIBLE_RESULTS);
  }

  const queryParts = normalizedQuery.split(/\s+/).filter(Boolean);
  return options
    .filter((option) => {
      const searchText = `${option.label} ${option.value} ${extraText ? extraText(option) : ""}`.toLowerCase();
      return queryParts.every((part) => searchText.includes(part));
    })
    .slice(0, MAX_VISIBLE_RESULTS);
};

export function SearchableDropdown<T extends SelectOption>(props: SearchableDropdownProps<T>) {
  const {
    disabled = false,
    emptyMessage,
    extraText,
    helperText,
    id,
    label,
    options,
    placeholder,
    query,
    setQuery,
  } = props;
  const isMultiple = props.selectionMode === "multiple";
  const selectionMode = isMultiple ? "multiple" : "single";
  const selectedValues = isMultiple ? props.selectedValues : [props.selectedValue].filter(Boolean);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const toggleButtonRef = useRef<HTMLButtonElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const shouldAutoScrollRef = useRef(false);
  const suppressNextFocusOpenRef = useRef(false);
  const deferredQuery = useDeferredValue(query);
  const selectedValueSet = new Set(selectedValues);

  const filteredOptions = filterOptions(options, deferredQuery, selectedValues, extraText);
  const selectedOptions = options.filter((option) => selectedValueSet.has(option.value));
  const selectedOption = isMultiple ? null : (selectedOptions[0] ?? null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent): void => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
        if (selectionMode === "single" && selectedOption) {
          setQuery(selectedOption.label);
        }
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [selectedOption, selectionMode, setQuery]);

  useEffect(() => {
    if (selectionMode === "single" && !isOpen && selectedOption && query !== selectedOption.label) {
      setQuery(selectedOption.label);
    }
  }, [isOpen, query, selectedOption, selectionMode, setQuery]);

  useEffect(() => {
    if (!filteredOptions.length) {
      setActiveIndex(0);
      return;
    }

    if (selectionMode === "multiple") {
      setActiveIndex((current) => Math.min(current, filteredOptions.length - 1));
      return;
    }

    const nextIndex = filteredOptions.findIndex((option) => option.value === selectedOption?.value);
    setActiveIndex(nextIndex >= 0 ? nextIndex : 0);
  }, [filteredOptions, selectedOption?.value, selectionMode]);

  useEffect(() => {
    const activeOption = optionRefs.current[activeIndex];
    if (isOpen && activeOption && shouldAutoScrollRef.current) {
      activeOption.scrollIntoView({
        block: "nearest",
      });
      shouldAutoScrollRef.current = false;
    }
  }, [activeIndex, isOpen]);

  const moveIndex = (nextIndex: number): void => {
    const maxIndex = Math.max(filteredOptions.length - 1, 0);
    setActiveIndex(Math.min(Math.max(nextIndex, 0), maxIndex));
  };

  const moveIndexFromKeyboard = (nextIndex: number): void => {
    shouldAutoScrollRef.current = true;
    moveIndex(nextIndex);
  };

  const openDropdown = (): void => {
    if (disabled) {
      return;
    }

    if (suppressNextFocusOpenRef.current) {
      suppressNextFocusOpenRef.current = false;
      return;
    }

    setIsOpen(true);
  };

  const closeDropdown = (): void => {
    setIsOpen(false);
    if (selectionMode === "single" && selectedOption) {
      setQuery(selectedOption.label);
    }
  };

  const handleToggle = (): void => {
    if (disabled) {
      return;
    }

    const nextIsOpen = !isOpen;
    setIsOpen(nextIsOpen);

    if (nextIsOpen) {
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
      return;
    }

    suppressNextFocusOpenRef.current = true;
    window.requestAnimationFrame(() => {
      if (document.activeElement === inputRef.current) {
        inputRef.current?.blur();
      }
      toggleButtonRef.current?.focus();
    });
  };

  const handleSelect = (option: T): void => {
    if (props.selectionMode === "multiple") {
      const nextValues = selectedValueSet.has(option.value)
        ? props.selectedValues.filter((value) => value !== option.value)
        : [...props.selectedValues, option.value];
      props.onChange(nextValues);
      setQuery("");
      const nextActiveIndex = filteredOptions.findIndex((entry) => entry.value === option.value);
      setActiveIndex(nextActiveIndex >= 0 ? nextActiveIndex : 0);
      inputRef.current?.focus();
      return;
    }

    props.onChange(option.value);
    const nextActiveIndex = filteredOptions.findIndex((entry) => entry.value === option.value);
    setActiveIndex(nextActiveIndex >= 0 ? nextActiveIndex : 0);
    setQuery(option.label);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div className="fieldGroup">
      <div className="fieldHeading">
        <label className="fieldLabel" htmlFor={id}>
          {label}
        </label>
        <span className="resultBadge">{filteredOptions.length} shown</span>
      </div>

      <div className="dropdownWrap" ref={wrapperRef}>
        <div className={`dropdownShell${isOpen ? " dropdownShell-open" : ""}${disabled ? " dropdownShell-disabled" : ""}`}>
          <span className="dropdownIcon" aria-hidden="true">
            <svg viewBox="0 0 20 20">
              <circle cx="8.5" cy="8.5" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.7" />
              <path d="m12.5 12.5 4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
            </svg>
          </span>

          <input
            autoComplete="off"
            autoCorrect="off"
            className="dropdownInput"
            disabled={disabled}
            id={id}
            placeholder={placeholder}
            ref={inputRef}
            spellCheck={false}
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              openDropdown();
            }}
            onClick={openDropdown}
            onFocus={openDropdown}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeDropdown();
                return;
              }

              if (props.selectionMode === "multiple" && event.key === "Backspace" && !query && props.selectedValues.length) {
                event.preventDefault();
                props.onChange(props.selectedValues.slice(0, -1));
                return;
              }

              if (event.key === "ArrowDown") {
                event.preventDefault();
                openDropdown();
                moveIndexFromKeyboard(activeIndex + 1);
                return;
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                openDropdown();
                moveIndexFromKeyboard(activeIndex - 1);
                return;
              }

              if (event.key === "PageDown") {
                event.preventDefault();
                openDropdown();
                moveIndexFromKeyboard(activeIndex + PAGE_STEP);
                return;
              }

              if (event.key === "PageUp") {
                event.preventDefault();
                openDropdown();
                moveIndexFromKeyboard(activeIndex - PAGE_STEP);
                return;
              }

              if (event.key === "Home") {
                event.preventDefault();
                openDropdown();
                moveIndexFromKeyboard(0);
                return;
              }

              if (event.key === "End") {
                event.preventDefault();
                openDropdown();
                moveIndexFromKeyboard(filteredOptions.length - 1);
                return;
              }

              if (event.key === "Enter" && filteredOptions.length) {
                event.preventDefault();
                handleSelect(filteredOptions[activeIndex] ?? filteredOptions[0]);
              }
            }}
          />

          <button
            aria-label={`Toggle ${label.toLowerCase()} results`}
            className="dropdownToggle"
            disabled={disabled}
            ref={toggleButtonRef}
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={handleToggle}
          >
            <svg
              aria-hidden="true"
              className={`dropdownChevron${isOpen ? " dropdownChevron-open" : ""}`}
              viewBox="0 0 20 20"
            >
              <path d="M5.25 7.5 10 12.25 14.75 7.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
            </svg>
          </button>
        </div>

        {isOpen ? (
          <div className="dropdownPopover">
            <div className="dropdownMetaRow">
              <span className="searchHint">{helperText}</span>
              <span className="searchHintBadge">{filteredOptions.length} matches</span>
            </div>

            <div className="resultList" role="listbox" aria-label={label} aria-multiselectable={selectionMode === "multiple"}>
              {filteredOptions.length ? (
                filteredOptions.map((option, index) => {
                  const isSelected = selectedValueSet.has(option.value);
                  const isActive = index === activeIndex;
                  const metaText = extraText ? extraText(option).replace(/\s+/g, " ").trim() : "";

                  return (
                    <button
                      key={option.value}
                      ref={(element) => {
                        optionRefs.current[index] = element;
                      }}
                      className={`resultOption${isSelected ? " resultOption-selected" : ""}${
                        isActive ? " resultOption-active" : ""
                      }`}
                      role="option"
                      type="button"
                      aria-selected={isSelected}
                      onClick={() => handleSelect(option)}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => moveIndex(index)}
                    >
                      <span className={`resultIndex${isSelected ? " resultIndex-selected" : ""}`}>
                        {selectionMode === "multiple" && isSelected ? "OK" : index + 1}
                      </span>

                      <span className="resultContent">
                        <span className="resultTitle">{option.label}</span>
                        <span className="resultMeta">{metaText ? `${option.value} | ${metaText}` : option.value}</span>
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="comboEmpty">{emptyMessage}</div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
