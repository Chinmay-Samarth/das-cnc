/**
 * Shimmer bone primitives. Use layout helpers in SkeletonLayouts for page shells.
 */
export function Skeleton({
  width,
  height = 14,
  radius,
  circle = false,
  className = '',
  style,
  ...rest
}) {
  const sizeStyle = {
    width: width ?? (circle ? height : '100%'),
    height,
    borderRadius: circle ? '50%' : radius,
    ...style,
  };

  return (
    <div
      className={`skeleton${circle ? ' skeleton-circle' : ''}${className ? ` ${className}` : ''}`}
      style={sizeStyle}
      aria-hidden="true"
      {...rest}
    />
  );
}

export function SkeletonText({ lines = 1, lastWidth = '72%', gap = 10, className = '' }) {
  const count = Math.max(1, Number(lines) || 1);
  return (
    <div className={`skeleton-text${className ? ` ${className}` : ''}`} style={{ gap }}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton
          key={i}
          height={12}
          width={i === count - 1 && count > 1 ? lastWidth : '100%'}
        />
      ))}
    </div>
  );
}

export function SkeletonCircle({ size = 40, className = '', ...rest }) {
  return <Skeleton circle height={size} width={size} className={className} {...rest} />;
}

export default Skeleton;
