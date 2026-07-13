export default function TruncatedText({ children, className = '', as: Tag = 'span', ...rest }) {
  const text = children == null ? '' : String(children);
  return (
    <Tag className={`mes-truncate ${className}`.trim()} title={text || undefined} {...rest}>
      {text || '—'}
    </Tag>
  );
}
