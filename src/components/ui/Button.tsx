import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon';
type ButtonSize = 'md' | 'sm';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  icon,
  className = '',
  disabled,
  ...rest
}: PropsWithChildren<ButtonProps>) {
  const hasChildren = children !== null && children !== undefined && children !== false;
  const classes = [
    'btn',
    `btn-${variant}`,
    size === 'sm' ? 'btn-sm' : '',
    fullWidth ? 'btn-full' : '',
    className
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading && <span className="loading-spinner" aria-hidden="true" />}
      {!loading && icon && <span className="btn-icon">{icon}</span>}
      {hasChildren && <span>{children}</span>}
    </button>
  );
}
