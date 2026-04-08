"use client";

import type { SelectOption } from "@/types/imf";
import { useEffect, useRef, useState } from "react";

const PAGE_STEP = 8;

interface SelectDropdownProps<T extends SelectOption> {
  disabled?: boolean;
  emptyMessage: string;
  helperText: string;
  id: string;
  label: string;
  onChange: (value: string) => void;
  options: T[];
  placeholder: string;
  selectedValue: string;
}

export function SelectDropdown<T extends SelectOption>({
  disabled = false,
  emptyMessage,
  helperText,
  id,
  label,
  onChange,
  options,
  placeholder,
  selectedValue,
}: SelectDropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const shouldAutoScrollRef = useRef(false);

  const selectedOption = options.find((option) => option.value === selectedValue) ?? null;

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent): void => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, []);

  useEffect(() => {
    const nextIndex = options.findIndex((option) => option.value === selectedValue);
    setActiveIndex(nextIndex >= 0 ? nextIndex : 0);
  }, [options, selectedValue]);

  useEffect(() => {
    const activeOption = optionRefs.current[activeIndex];
    if (isOpen && activeOption && shouldAutoScrollRef.current) {
      activeOption.scrollIntoView({ block: "nearest" });
      shouldAutoScrollRef.current = false;
    }
  }, [activeIndex, isOpen]);

  const moveIndex = (nextIndex: number): void => {
    const maxIndex = Math.max(options.length - 1, 0);
    setActiveIndex(Math.min(Math.max(nextIndex, 0), maxIndex));
  };

  const moveIndexFromKeyboard = (nextIndex: number): void => {
    shouldAutoScrollRef.current = true;
    moveIndex(nextIndex);
  };

  const handleSelect = (option: T): void => {
    onChange(option.value);
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div className="fieldGroup">
      <div className="fieldHeading">
        <label className="fieldLabel" htmlFor={id}>
          {label}
        </label>
      </div>

      <div className="dropdownWrap" ref={wrapperRef}>
        <div className={`dropdownShell${isOpen ? " dropdownShell-open" : ""}${disabled ? " dropdownShell-disabled" : ""}`}>
          <button
            id={id}
            ref={buttonRef}
            aria-expanded={isOpen}
            aria-haspopup="listbox"
            className="dropdownButtonTrigger"
            disabled={disabled}
            type="button"
            onClick={() => {
              if (disabled) {
                return;
              }
              setIsOpen((current) => !current);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setIsOpen(false);
                return;
              }

              if (event.key === "ArrowDown") {
                event.preventDefault();
                setIsOpen(true);
                moveIndexFromKeyboard(activeIndex + 1);
                return;
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                setIsOpen(true);
                moveIndexFromKeyboard(activeIndex - 1);
                return;
              }

              if (event.key === "PageDown") {
                event.preventDefault();
                setIsOpen(true);
                moveIndexFromKeyboard(activeIndex + PAGE_STEP);
                return;
              }

              if (event.key === "PageUp") {
                event.preventDefault();
                setIsOpen(true);
                moveIndexFromKeyboard(activeIndex - PAGE_STEP);
                return;
              }

              if (event.key === "Home") {
                event.preventDefault();
                setIsOpen(true);
                moveIndexFromKeyboard(0);
                return;
              }

              if (event.key === "End") {
                event.preventDefault();
                setIsOpen(true);
                moveIndexFromKeyboard(options.length - 1);
                return;
              }

              if ((event.key === "Enter" || event.key === " ") && !isOpen) {
                event.preventDefault();
                setIsOpen(true);
                return;
              }

              if ((event.key === "Enter" || event.key === " ") && isOpen && options.length) {
                event.preventDefault();
                handleSelect(options[activeIndex] ?? options[0]);
              }
            }}
          >
            <span className={`dropdownButtonValue${selectedOption ? "" : " dropdownButtonValue-placeholder"}`}>
              {selectedOption?.label ?? placeholder}
            </span>
          </button>

          <button
            aria-label={`Toggle ${label.toLowerCase()} options`}
            className="dropdownToggle"
            disabled={disabled}
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              if (disabled) {
                return;
              }
              setIsOpen((current) => !current);
              buttonRef.current?.focus();
            }}
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
              <span className="searchHintBadge">{options.length} options</span>
            </div>

            <div className="resultList" role="listbox" aria-label={label}>
              {options.length ? (
                options.map((option, index) => {
                  const isSelected = option.value === selectedValue;
                  const isActive = index === activeIndex;

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
                      <span className={`resultIndex${isSelected ? " resultIndex-selected" : ""}`}>{index + 1}</span>

                      <span className="resultContent">
                        <span className="resultTitle">{option.label}</span>
                        <span className="resultMeta">{option.value}</span>
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
