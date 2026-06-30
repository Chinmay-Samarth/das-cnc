import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import api from '../../api/client';

export default function GlobalSearch() {
  const navigate = useNavigate();
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const runSearch = useCallback(async (value) => {
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.get('/search', {
        params: { q: trimmed, limit: 5 },
      });
      setResults(data.results || []);
      setActiveIndex(-1);
    } catch (err) {
      console.error('Global search failed', err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const timer = setTimeout(() => {
      runSearch(query);
    }, 280);

    return () => clearTimeout(timer);
  }, [query, open, runSearch]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function selectResult(result) {
    if (!result?.path) return;
    setOpen(false);
    setQuery('');
    setResults([]);
    navigate(result.path);
  }

  function handleKeyDown(event) {
    if (!open && event.key !== 'Escape') return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, -1));
    } else if (event.key === 'Enter' && activeIndex >= 0 && results[activeIndex]) {
      event.preventDefault();
      selectResult(results[activeIndex]);
    } else if (event.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  const showDropdown = open && (loading || results.length > 0 || query.trim().length >= 2);

  return (
    <div className="global-search">
      <div className="global-search-wrap" ref={containerRef}>
        <div className="global-search-inner">
        <Search size={15} className="global-search-icon" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          className="global-search-input"
          placeholder="Search employees, suppliers, invoices, GIRNs…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          aria-label="Global search"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          role="combobox"
        />
        {query ? (
          <button
            type="button"
            className="global-search-clear"
            onClick={() => {
              setQuery('');
              setResults([]);
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      {showDropdown ? (
        <div className="global-search-dropdown" role="listbox">
          {loading ? (
            <p className="global-search-status">Searching…</p>
          ) : results.length === 0 ? (
            <p className="global-search-status">No results for &ldquo;{query.trim()}&rdquo;</p>
          ) : (
            results.map((result, index) => (
              <button
                key={`${result.type}-${result.id}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`global-search-result${index === activeIndex ? ' is-active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectResult(result)}
              >
                <span className="global-search-result-type">{result.typeLabel}</span>
                <span className="global-search-result-title">{result.title}</span>
                {result.subtitle ? (
                  <span className="global-search-result-subtitle">{result.subtitle}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
        ) : null}
      </div>
    </div>
  );
}
