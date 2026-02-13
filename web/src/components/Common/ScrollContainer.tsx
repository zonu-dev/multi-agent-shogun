import type { HTMLAttributes, ReactNode } from 'react';

interface ScrollContainerProps extends HTMLAttributes<HTMLDivElement> {
  heading?: ReactNode;
  contentClassName?: string;
}

const combineClasses = (...classes: Array<string | undefined>): string =>
  classes.filter(Boolean).join(' ');

const ScrollContainer = ({
  title,
  heading,
  className,
  contentClassName,
  children,
  ...rest
}: ScrollContainerProps) => {
  const resolvedHeading = heading ?? title;
  const hasHeading = Boolean(resolvedHeading);

  return (
    <section
      className={combineClasses(
        'flex h-full flex-col rounded-2xl border border-[color:var(--kincha)]/45 bg-gradient-to-br from-[#2d2a22]/95 via-[#232632]/95 to-[#1b1d2c]/95 p-3 shadow-[0_14px_30px_rgba(0,0,0,0.35)]',
        className
      )}
      {...rest}
    >
      {hasHeading ? (
        <header
          className="mb-3 border-b border-[color:var(--kincha)]/30 pb-2 text-sm font-semibold tracking-[0.08em] text-[color:var(--kincha)]"
          style={{ fontFamily: '"Noto Serif JP", serif' }}
        >
          {resolvedHeading}
        </header>
      ) : null}
      <div
        className={combineClasses(
          ['min-h-0 flex-1', 'overflow-y-auto pr-1 text-sm leading-relaxed text-slate-100'].join(
            ' '
          ),
          contentClassName
        )}
      >
        {children}
      </div>
    </section>
  );
};

export default ScrollContainer;
