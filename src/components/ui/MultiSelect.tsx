import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { throttle } from 'lodash-es';
import { IconCheck, IconChevronDown } from './icons';
import { type SelectOption } from './Select';
import styles from './Select.module.scss';

interface MultiSelectProps {
  value: string[];
  options: ReadonlyArray<SelectOption>;
  onChange: (value: string[]) => void;
  placeholder?: string;
  selectAllLabel?: string;
  clearLabel?: string;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  fullWidth?: boolean;
  id?: string;
}

const VIEWPORT_MARGIN = 8;
const DROPDOWN_OFFSET = 6;
const DROPDOWN_MAX_HEIGHT = 280;
const DROPDOWN_Z_INDEX = 2010;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const resolveDropdownStyle = (element: HTMLElement): CSSProperties => {
  const rect = element.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(rect.width, Math.max(0, viewportWidth - VIEWPORT_MARGIN * 2));
  const left = clamp(
    rect.left,
    VIEWPORT_MARGIN,
    Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN)
  );
  const spaceBelow = viewportHeight - rect.bottom - VIEWPORT_MARGIN - DROPDOWN_OFFSET;
  const spaceAbove = rect.top - VIEWPORT_MARGIN - DROPDOWN_OFFSET;
  const direction =
    spaceBelow >= DROPDOWN_MAX_HEIGHT || spaceBelow >= spaceAbove ? 'down' : 'up';
  const maxHeight = Math.max(
    0,
    Math.min(DROPDOWN_MAX_HEIGHT, direction === 'down' ? spaceBelow : spaceAbove)
  );

  return direction === 'down'
    ? {
        position: 'fixed',
        top: rect.bottom + DROPDOWN_OFFSET,
        left,
        width,
        maxHeight,
        zIndex: DROPDOWN_Z_INDEX,
      }
    : {
        position: 'fixed',
        bottom: viewportHeight - rect.top + DROPDOWN_OFFSET,
        left,
        width,
        maxHeight,
        zIndex: DROPDOWN_Z_INDEX,
      };
};

const normalizeSelection = (options: ReadonlyArray<SelectOption>, nextValues: Iterable<string>) => {
  const selected = new Set(Array.from(nextValues));
  return options.filter((option) => selected.has(option.value)).map((option) => option.value);
};

export function MultiSelect({
  value,
  options,
  onChange,
  placeholder,
  selectAllLabel = 'Select all',
  clearLabel = 'Clear',
  className,
  disabled = false,
  ariaLabel,
  fullWidth = true,
  id,
}: MultiSelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const listboxId = `${selectId}-listbox`;
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties | null>(null);
  const selectedValues = useMemo(() => new Set(value), [value]);
  const selectedOptions = useMemo(
    () => options.filter((option) => selectedValues.has(option.value)),
    [options, selectedValues]
  );
  const isOpen = open && !disabled;

  useEffect(() => {
    if (!open || disabled) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [disabled, open]);

  const updateDropdownStyle = useCallback(() => {
    if (!wrapRef.current) return;
    setDropdownStyle(resolveDropdownStyle(wrapRef.current));
  }, []);

  const scheduleDropdownStyleUpdate = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      updateDropdownStyle();
    });
  }, [updateDropdownStyle]);

  useLayoutEffect(() => {
    if (!isOpen) {
      if (rafRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    updateDropdownStyle();

    const handleViewportChange = throttle(() => {
      scheduleDropdownStyleUpdate();
    }, 100);

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && wrapRef.current
        ? new ResizeObserver(() => {
            scheduleDropdownStyleUpdate();
          })
        : null;

    if (resizeObserver && wrapRef.current) {
      resizeObserver.observe(wrapRef.current);
    }

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
      resizeObserver?.disconnect();
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isOpen, scheduleDropdownStyleUpdate, updateDropdownStyle]);

  const resolvedHighlightedIndex =
    highlightedIndex >= 0 ? highlightedIndex : options.length > 0 ? 0 : -1;

  const commitSelection = useCallback(
    (nextValues: Iterable<string>) => {
      onChange(normalizeSelection(options, nextValues));
    },
    [onChange, options]
  );

  const toggleSelection = useCallback(
    (nextValue: string) => {
      const next = new Set(value);
      if (next.has(nextValue)) {
        next.delete(nextValue);
      } else {
        next.add(nextValue);
      }
      commitSelection(next);
    },
    [commitSelection, value]
  );

  const moveHighlight = useCallback(
    (direction: 1 | -1) => {
      if (options.length === 0) return;
      const nextIndex = (resolvedHighlightedIndex + direction + options.length) % options.length;
      setHighlightedIndex(nextIndex);
    },
    [options.length, resolvedHighlightedIndex]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          if (!isOpen) {
            setOpen(true);
            return;
          }
          moveHighlight(1);
          return;
        case 'ArrowUp':
          event.preventDefault();
          if (!isOpen) {
            setOpen(true);
            return;
          }
          moveHighlight(-1);
          return;
        case 'Home':
          if (!isOpen || options.length === 0) return;
          event.preventDefault();
          setHighlightedIndex(0);
          return;
        case 'End':
          if (!isOpen || options.length === 0) return;
          event.preventDefault();
          setHighlightedIndex(options.length - 1);
          return;
        case 'Enter':
        case ' ': {
          event.preventDefault();
          if (!isOpen) {
            setOpen(true);
            return;
          }
          const highlighted = options[resolvedHighlightedIndex];
          if (highlighted) {
            toggleSelection(highlighted.value);
          }
          return;
        }
        case 'Escape':
          if (!isOpen) return;
          event.preventDefault();
          setOpen(false);
          return;
        case 'Tab':
          if (isOpen) setOpen(false);
          return;
        default:
          return;
      }
    },
    [disabled, isOpen, moveHighlight, options, resolvedHighlightedIndex, toggleSelection]
  );

  useEffect(() => {
    if (!isOpen || resolvedHighlightedIndex < 0) return;
    const highlightedOption = document.getElementById(`${selectId}-option-${resolvedHighlightedIndex}`);
    highlightedOption?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, resolvedHighlightedIndex, selectId]);

  const dropdown =
    isOpen && dropdownStyle
      ? (
          <div
            ref={dropdownRef}
            className={styles.dropdown}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            aria-multiselectable="true"
            style={dropdownStyle}
          >
            <div className={styles.dropdownActions}>
              <button
                type="button"
                className={styles.dropdownAction}
                onClick={() => commitSelection(options.map((option) => option.value))}
              >
                {selectAllLabel}
              </button>
              <button
                type="button"
                className={styles.dropdownAction}
                onClick={() => commitSelection([])}
              >
                {clearLabel}
              </button>
            </div>
            {options.map((option, index) => {
              const active = selectedValues.has(option.value);
              const highlighted = index === resolvedHighlightedIndex;
              return (
                <button
                  key={option.value}
                  id={`${selectId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`${styles.option} ${active ? styles.optionActive : ''} ${highlighted ? styles.optionHighlighted : ''}`.trim()}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onKeyDown={handleKeyDown}
                  onClick={() => toggleSelection(option.value)}
                >
                  <span className={styles.optionMeta}>
                    <span className={styles.optionCheck}>{active ? <IconCheck size={14} /> : null}</span>
                    <span>{option.label}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )
      : null;

  return (
    <>
      <div
        className={`${styles.wrap} ${fullWidth ? styles.wrapFullWidth : ''} ${className ?? ''}`}
        ref={wrapRef}
      >
        <button
          id={selectId}
          type="button"
          className={`${styles.trigger} ${styles.triggerMulti}`}
          onClick={disabled ? undefined : () => setOpen((prev) => !prev)}
          onKeyDown={handleKeyDown}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={isOpen ? listboxId : undefined}
          aria-activedescendant={
            isOpen && resolvedHighlightedIndex >= 0
              ? `${selectId}-option-${resolvedHighlightedIndex}`
              : undefined
          }
          aria-label={ariaLabel}
          disabled={disabled}
        >
          <span className={styles.triggerTokens}>
            {selectedOptions.length > 0 ? (
              selectedOptions.map((option) => (
                <span key={option.value} className={styles.triggerChip}>
                  {option.label}
                </span>
              ))
            ) : (
              <span className={`${styles.triggerText} ${styles.placeholder}`}>{placeholder ?? ''}</span>
            )}
          </span>
          <span className={styles.triggerIcon} aria-hidden="true">
            <IconChevronDown size={14} />
          </span>
        </button>
      </div>
      {dropdown && (typeof document === 'undefined' ? dropdown : createPortal(dropdown, document.body))}
    </>
  );
}
