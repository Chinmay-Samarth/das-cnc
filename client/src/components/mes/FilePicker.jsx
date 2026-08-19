import { useRef } from 'react';
import { Upload } from 'lucide-react';

export default function FilePicker({
  id,
  accept,
  disabled,
  onChange,
  label = 'Choose file',
  fileName,
}) {
  const inputRef = useRef(null);

  return (
    <div className="mf-file-field">
      {fileName ? <span className="mf-file-chip">{fileName}</span> : null}
      <button
        type="button"
        className="neutral-button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <Upload size={15} style={{ display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} />
        {label}
      </button>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        disabled={disabled}
        style={{ display: 'none' }}
        onChange={(e) => onChange(e.target.files?.[0] || null)}
      />
    </div>
  );
}
