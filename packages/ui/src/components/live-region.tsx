import type { ReactElement } from 'react';

export type LiveRegionProps = {
  politeness?: 'polite' | 'assertive';
  message: string;
};

export function LiveRegion({ politeness = 'polite', message }: LiveRegionProps): ReactElement {
  return (
    <div
      role={politeness === 'assertive' ? 'alert' : 'status'}
      aria-live={politeness}
      aria-atomic="true"
      className="sr-only"
    >
      {message}
    </div>
  );
}
