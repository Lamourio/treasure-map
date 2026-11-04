import { store } from './store';

/** Copies text and confirms with a toast (clipboard needs https or localhost). */
export async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    store.notify(`Copied ${what}`);
  } catch {
    store.notify('Could not copy: the browser blocked clipboard access');
  }
}
