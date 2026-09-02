"use client";

import { useEffect, useId, useRef, useState } from "react";

export type ProjectSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type ProjectSelectProps = {
  ariaLabel: string;
  options: readonly ProjectSelectOption[];
  value?: string;
  defaultValue?: string | undefined;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
};

export function ProjectSelect({
  ariaLabel,
  options,
  value,
  defaultValue = "",
  name,
  placeholder = "Выберите вариант",
  disabled = false,
  onChange,
}: ProjectSelectProps) {
  const [open, setOpen] = useState(false);
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const selectedValue = value ?? uncontrolledValue;
  const selected = options.find((option) => option.value === selectedValue);

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

  function commit(nextValue: string) {
    if (value === undefined) setUncontrolledValue(nextValue);
    onChange?.(nextValue);
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function move(step: 1 | -1) {
    const enabled = options.filter((option) => !option.disabled);
    if (!enabled.length) return;
    const currentIndex = enabled.findIndex(
      (option) => option.value === selectedValue,
    );
    const index = currentIndex < 0 ? (step === 1 ? -1 : 0) : currentIndex;
    const next = enabled[(index + step + enabled.length) % enabled.length];
    if (next) commit(next.value);
  }

  return (
    <div className="project-select" ref={rootRef}>
      {name && <input type="hidden" name={name} value={selectedValue} />}
      <button
        ref={triggerRef}
        type="button"
        className="project-select__trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) setOpen(true);
            else move(event.key === "ArrowDown" ? 1 : -1);
          }
          if (event.key === "Escape") setOpen(false);
        }}
      >
        <span className={selected ? "" : "is-placeholder"}>
          {selected?.label ?? placeholder}
        </span>
        <span className="project-select__chevron" aria-hidden="true">
          ⌄
        </span>
      </button>
      {open && (
        <div
          className="project-select__menu"
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
        >
          {options.map((option) => (
            <button
              className={option.value === selectedValue ? "is-selected" : ""}
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === selectedValue}
              disabled={option.disabled}
              onPointerDown={(event) => {
                event.preventDefault();
                commit(option.value);
              }}
              onClick={() => commit(option.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  move(event.key === "ArrowDown" ? 1 : -1);
                }
                if (event.key === "Escape") {
                  setOpen(false);
                  triggerRef.current?.focus();
                }
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  commit(option.value);
                }
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
