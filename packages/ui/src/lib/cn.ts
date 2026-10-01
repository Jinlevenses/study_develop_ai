import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// 기본 twMerge는 우리 토큰 이름(text-read·font-book·shadow-panel…)을 모르면 색 클래스로 오인해 지운다.
// 테마 값을 등록해 같은 그룹끼리만 병합되게 한다.
const twMergeFathom = extendTailwindMerge({
  extend: {
    theme: {
      text: ['2xs', 'read', 'body', 'read-adaptive', 'display'],
      'font-weight': ['regular', 'book', 'strong'],
      font: ['display'],
      radius: ['inline', 'control', 'panel', 'popover', 'modal', 'pill'],
      shadow: ['panel', 'popover', 'modal'],
      blur: ['glass'],
      ease: ['standard', 'exit', 'emphasized'],
      animate: ['fade-in', 'fade-out', 'tag-in', 'panel-in'],
    },
  },
});

export function cn(...inputs: readonly ClassValue[]): string {
  return twMergeFathom(clsx(inputs));
}
