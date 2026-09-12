import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search, X } from 'lucide-react'

function normalizeOption(option) {
  if (option == null) return { value: '', label: '' }
  if (typeof option === 'string' || typeof option === 'number') {
    const text = String(option)
    return { value: text, label: text }
  }
  const composed = [option.typeLabel, option.title, option.subtitle]
    .filter(Boolean)
    .join(' · ')
  const label =
    option.label ??
    (composed || String(option.value ?? option.record_id ?? option.id ?? ''))
  return {
    value: option.value ?? option.record_id ?? option.id ?? '',
    label,
    typeLabel: option.typeLabel || option.type_label || null,
    title: option.title || null,
    subtitle: option.subtitle || null,
    raw: option,
  }
}

export default function FormSearchSelect({
  value,
  onChange,
  options = [],
  placeholder = 'Select…',
  disabled = false,
  searchable = false,
  search = '',
  onSearchChange,
  loading = false,
  emptyMessage = 'No results',
  selectedLabel = '',
  className = '',
  onOpenChange,
  clearable = true,
  fetchOptions,
  debounceMs = 200,
  mapOption,
  portal = true,
}) {
  const [open, setOpen] = useState(false)
  const [localSearch, setLocalSearch] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [asyncOptions, setAsyncOptions] = useState([])
  const [asyncLoading, setAsyncLoading] = useState(false)
  const [menuStyle, setMenuStyle] = useState(null)
  const wrapRef = useRef(null)
  const dropdownRef = useRef(null)
  const fetchIdRef = useRef(0)

  const isAsync = typeof fetchOptions === 'function'
  const isSearchControlled = onSearchChange != null || isAsync
  const query = isSearchControlled ? (isAsync ? localSearch : search) : localSearch
  const isLoading = loading || asyncLoading

  const normalizedOptions = useMemo(() => {
    const source = isAsync ? asyncOptions : options
    return source.map((option) => normalizeOption(mapOption ? mapOption(option) : option))
  }, [asyncOptions, isAsync, mapOption, options])

  const filteredOptions = useMemo(() => {
    if (isAsync || isSearchControlled) return normalizedOptions
    if (!searchable) return normalizedOptions
    const term = query.trim().toLowerCase()
    if (!term) return normalizedOptions
    return normalizedOptions.filter((opt) => opt.label.toLowerCase().includes(term))
  }, [isAsync, isSearchControlled, normalizedOptions, query, searchable])

  const displayLabel = useMemo(() => {
    if (selectedLabel) return selectedLabel
    const match = normalizedOptions.find((opt) => String(opt.value) === String(value))
    return match?.label || ''
  }, [normalizedOptions, selectedLabel, value])

  const runFetch = useCallback(async (term) => {
    if (!isAsync) return
    const fetchId = ++fetchIdRef.current
    setAsyncLoading(true)
    try {
      const results = await fetchOptions(term)
      if (fetchId !== fetchIdRef.current) return
      setAsyncOptions(Array.isArray(results) ? results : [])
    } catch {
      if (fetchId !== fetchIdRef.current) return
      setAsyncOptions([])
    } finally {
      if (fetchId === fetchIdRef.current) setAsyncLoading(false)
    }
  }, [fetchOptions, isAsync])

  const updateMenuPosition = useCallback(() => {
    if (!portal || !wrapRef.current) return
    const rect = wrapRef.current.getBoundingClientRect()
    const viewportH = window.innerHeight
    const spaceBelow = viewportH - rect.bottom
    const preferUp = spaceBelow < 280 && rect.top > spaceBelow
    const maxHeight = Math.min(320, preferUp ? rect.top - 12 : spaceBelow - 12)
    setMenuStyle({
      position: 'fixed',
      left: rect.left,
      width: Math.max(rect.width, 220),
      top: preferUp ? undefined : rect.bottom + 4,
      bottom: preferUp ? viewportH - rect.top + 4 : undefined,
      maxHeight: Math.max(160, maxHeight),
      zIndex: 4000,
    })
  }, [portal])

  useLayoutEffect(() => {
    if (!open || !portal) {
      setMenuStyle(null)
      return undefined
    }
    updateMenuPosition()
    function handleReposition() {
      updateMenuPosition()
    }
    window.addEventListener('resize', handleReposition)
    window.addEventListener('scroll', handleReposition, true)
    return () => {
      window.removeEventListener('resize', handleReposition)
      window.removeEventListener('scroll', handleReposition, true)
    }
  }, [open, portal, updateMenuPosition])

  useEffect(() => {
    function handleClickOutside(event) {
      const inTrigger = wrapRef.current?.contains(event.target)
      const inDropdown = dropdownRef.current?.contains(event.target)
      if (!inTrigger && !inDropdown) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (!open) {
      setActiveIndex(-1)
      if (!isSearchControlled) setLocalSearch('')
      return undefined
    }

    if (!isAsync) {
      onOpenChange?.(open)
      return undefined
    }

    const timer = setTimeout(() => {
      runFetch(query.trim())
    }, debounceMs)

    onOpenChange?.(open)
    return () => clearTimeout(timer)
  }, [debounceMs, isAsync, isSearchControlled, onOpenChange, open, query, runFetch])

  function setQuery(next) {
    if (isAsync) setLocalSearch(next)
    else if (isSearchControlled) onSearchChange(next)
    else setLocalSearch(next)
  }

  function selectOption(option) {
    onChange(option.value, option.raw ?? option)
    setOpen(false)
    setQuery('')
  }

  function handleKeyDown(event) {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        setOpen(true)
      }
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((prev) => Math.min(prev + 1, filteredOptions.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((prev) => Math.max(prev - 1, 0))
    } else if (event.key === 'Enter' && activeIndex >= 0 && filteredOptions[activeIndex]) {
      event.preventDefault()
      selectOption(filteredOptions[activeIndex])
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  const showSearch = searchable || isSearchControlled || isAsync
  const showDropdown = open && !disabled

  const dropdown = showDropdown ? (
    <div
      ref={dropdownRef}
      className={`global-search-dropdown form-search-select-dropdown${portal ? ' is-ported' : ''}`}
      role="listbox"
      style={portal ? menuStyle || { visibility: 'hidden' } : undefined}
    >
      {showSearch ? (
        <div className="form-search-select-search">
          <div className="global-search-inner">
            <Search size={15} className="global-search-icon" aria-hidden="true" />
            <input
              autoFocus
              type="search"
              className="global-search-input"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              aria-label="Filter options"
            />
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <p className="global-search-status">Loading…</p>
      ) : filteredOptions.length === 0 ? (
        <p className="global-search-status">{emptyMessage}</p>
      ) : (
        filteredOptions.map((option, index) => {
          const isSelected = String(option.value) === String(value)
          const isActive = index === activeIndex
          const rich = !!(option.typeLabel || option.title || option.subtitle)
          return (
            <button
              key={String(option.value)}
              type="button"
              role="option"
              aria-selected={isSelected}
              className={`global-search-result${rich ? '' : ' is-simple'}${isSelected || isActive ? ' is-active' : ''}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectOption(option)}
            >
              {rich ? (
                <>
                  {option.typeLabel ? (
                    <span className="global-search-result-type">{option.typeLabel}</span>
                  ) : null}
                  <span className="global-search-result-title">
                    {option.title || option.label}
                  </span>
                  {option.subtitle ? (
                    <span className="global-search-result-subtitle">{option.subtitle}</span>
                  ) : null}
                </>
              ) : (
                <span className="global-search-result-title">{option.label}</span>
              )}
            </button>
          )
        })
      )}
    </div>
  ) : null

  return (
    <div className={`form-search-select global-search-wrap ${className}`.trim()} ref={wrapRef}>
      <button
        type="button"
        className="form-search-select-trigger global-search-inner"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={showDropdown}
      >
        <span className={`form-search-select-value${displayLabel ? '' : ' is-placeholder'}`}>
          {displayLabel || placeholder}
        </span>
        {clearable && value ? (
          <button
            type="button"
            className="global-search-clear form-search-select-clear"
            onClick={(event) => {
              event.stopPropagation()
              onChange('', null)
            }}
            aria-label="Clear selection"
          >
            <X size={14} />
          </button>
        ) : null}
        <ChevronDown
          size={15}
          className={`form-search-select-chevron${open ? ' is-open' : ''}`}
          aria-hidden="true"
        />
      </button>

      {portal && typeof document !== 'undefined'
        ? dropdown
          ? createPortal(dropdown, document.body)
          : null
        : dropdown}
    </div>
  )
}
