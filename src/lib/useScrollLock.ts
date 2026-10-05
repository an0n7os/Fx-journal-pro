import { useEffect } from 'react';

/**
 * Global counter to handle nested or consecutive modals without prematurely
 * unlocking the document body when one modal closes while another remains open.
 */
let lockCount = 0;

/**
 * Prevents background scrolling when a modal, dialog, or overlay is open.
 * Works across desktop and mobile browsers (iOS Safari, Android Chrome).
 *
 * @param isLocked Whether the background should be locked from scrolling
 */
export function useScrollLock(isLocked: boolean) {
  useEffect(() => {
    if (!isLocked) return;

    if (lockCount === 0) {
      document.body.classList.add('scroll-locked');
      document.documentElement.classList.add('scroll-locked');
    }

    lockCount++;

    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        document.body.classList.remove('scroll-locked');
        document.documentElement.classList.remove('scroll-locked');
      }
    };
  }, [isLocked]);
}
