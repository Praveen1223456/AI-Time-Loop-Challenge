import { useEffect } from 'react';

/** Gives each route a distinct, descriptive document title (WCAG 2.4.2). */
export function usePageTitle(title) {
  useEffect(() => {
    if (title) document.title = `${title} · AI Time-Loop Challenge`;
  }, [title]);
}
