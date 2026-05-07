import type { PropsWithChildren, ReactNode } from 'react';

interface CardProps {
  title?: ReactNode;
  extra?: ReactNode;
  className?: string;
  icon?: ReactNode;
  variant?: 'default' | 'glass';
}

export function Card({ title, extra, children, className, icon, variant = 'default' }: PropsWithChildren<CardProps>) {
  const variantClass = variant === 'glass' ? 'card-glass' : '';

  return (
    <div className={['card', className, variantClass].filter(Boolean).join(' ')}>
      {(title || extra) && (
        <div className="card-header">
          <div className="title">
            {icon && <span className="card-icon">{icon}</span>}
            {title}
          </div>
          {extra}
        </div>
      )}
      {children}
    </div>
  );
}
