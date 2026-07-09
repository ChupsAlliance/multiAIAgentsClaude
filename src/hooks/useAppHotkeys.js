import { useHotkeys } from 'react-hotkeys-hook'

export const SHORTCUT_GROUPS = [
  {
    group: 'Toàn cục',
    shortcuts: [
      { keys: '?', description: 'Hiện danh sách phím tắt', scope: 'global' },
      { keys: 'Escape', description: 'Đóng modal / overlay', scope: 'global' },
    ],
  },
  {
    group: 'Soạn thảo Plan',
    shortcuts: [
      { keys: 'ctrl+s', description: 'Áp dụng chỉnh sửa plan', scope: 'plan-document' },
      { keys: 'ctrl+e', description: 'Mở menu xuất file', scope: 'plan-document' },
      { keys: '1', description: 'Chuyển sang tab Visual', scope: 'plan-review' },
      { keys: '2', description: 'Chuyển sang tab Document', scope: 'plan-review' },
      { keys: 'r', description: 'Replan (khi không focus input)', scope: 'plan-review' },
    ],
  },
  {
    group: 'Mission',
    shortcuts: [
      { keys: 'ctrl+enter', description: 'Launch mission', scope: 'mission-launcher' },
      { keys: 'ctrl+d', description: 'Deploy plan', scope: 'plan-review' },
    ],
  },
]

/**
 * @param {Object} params
 * @param {string} params.scope - 'global' | 'plan-document' | 'plan-review' | 'mission-launcher'
 * @param {Record<string, () => void>} params.handlers - { 'ctrl+s': fn, ... }
 */
export function useAppHotkeys({ scope, handlers }) {
  const ctrlSHandler = handlers['ctrl+s']
  const questionHandler = handlers['?']
  const escapeHandler = handlers['escape']
  const ctrlEnterHandler = handlers['ctrl+enter']
  const ctrlDHandler = handlers['ctrl+d']
  const ctrlEHandler = handlers['ctrl+e']
  const key1Handler = handlers['1']
  const key2Handler = handlers['2']
  const key3Handler = handlers['3']
  const keyRHandler = handlers['r']

  // ctrl+s fires even inside inputs (saving plan edits)
  useHotkeys('ctrl+s', (e) => { e.preventDefault(); ctrlSHandler?.() },
    { enableOnFormTags: ['INPUT', 'TEXTAREA'], enabled: !!ctrlSHandler })

  // ? only outside inputs
  useHotkeys('shift+/', () => questionHandler?.(),
    { enableOnFormTags: false, enabled: !!questionHandler })

  useHotkeys('escape', () => escapeHandler?.(),
    { enableOnFormTags: false, enabled: !!escapeHandler })

  useHotkeys('ctrl+enter', (e) => { e.preventDefault(); ctrlEnterHandler?.() },
    { enableOnFormTags: false, enabled: !!ctrlEnterHandler })

  useHotkeys('ctrl+d', (e) => { e.preventDefault(); ctrlDHandler?.() },
    { enableOnFormTags: false, enabled: !!ctrlDHandler })

  useHotkeys('ctrl+e', (e) => { e.preventDefault(); ctrlEHandler?.() },
    { enableOnFormTags: false, enabled: !!ctrlEHandler })

  useHotkeys('1', () => key1Handler?.(),
    { enableOnFormTags: false, enabled: !!key1Handler })

  useHotkeys('2', () => key2Handler?.(),
    { enableOnFormTags: false, enabled: !!key2Handler })

  useHotkeys('3', () => key3Handler?.(),
    { enableOnFormTags: false, enabled: !!key3Handler })

  useHotkeys('r', () => keyRHandler?.(),
    { enableOnFormTags: false, enabled: !!keyRHandler })
}
