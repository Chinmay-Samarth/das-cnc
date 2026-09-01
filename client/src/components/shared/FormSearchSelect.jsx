import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'

function normalizeOption(option) {
  if (option == null) return { value: '', label: '' }
  if (typeof option === 'string' || typeof option === 'number') {
    const text = String(option)
    return { value: text, label: text }
  }
  return {
    value: option.value ?? option.record_id ?? option.id ?? '',
    label: option.label ?? String(option.value ?? option.record_id ?? option.id ?? ''),
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
}) {
  const [open, setOpen] = useState(false)
  const [localSearch, setLocalSearch] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [asyncOptions, setAsyncOptions] = useState([])
  const [asyncLoading, setAsyncLoading] = useState(false)
  const wrapRef = useRef(null)
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

  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) {
        setOpen(false)
      }
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

      {showDropdown ? (
        <div className="global-search-dropdown form-search-select-dropdown" role="listbox">
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
              return (
                <button
                  key={String(option.value)}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`global-search-result is-simple${isSelected || isActive ? ' is-active' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectOption(option)}
                >
                  <span className="global-search-result-title">{option.label}</span>
                </button>
              )
            })
          )}
        </div>
      ) : null}
    </div>
  )
}
