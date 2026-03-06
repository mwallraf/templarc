import { useEffect } from 'react'

export type ToastVariant = 'success' | 'error' | 'info'

export interface ToastState {
  message: string
  variant: ToastVariant
  detail?: string
}

interface ToastProps {
  toast: ToastState
  onDismiss: () => void
}

const VARIANTS = {
  success: 'bg-green-50 border-green-300 text-green-800',
  error: 'bg-red-50 border-red-300 text-red-800',
  info: 'bg-blue-50 border-blue-300 text-blue-800',
}

const ICONS = {
  success: '✓',
  error: '✗',
  info: 'ℹ',
}

export function Toast({ toast, onDismiss }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(onDismiss, toast.variant === 'error' ? 6000 : 3500)
    return () => clearTimeout(t)
  }, [toast, onDismiss])

  return (
    <div
      className={`fixed bottom-6 right-6 z-50 flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg max-w-sm ${VARIANTS[toast.variant]}`}
    >
      <span className="font-bold text-lg leading-none mt-0.5">{ICONS[toast.variant]}</span>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm">{toast.message}</p>
        {toast.detail && <p className="text-xs mt-0.5 opacity-75 font-mono">{toast.detail}</p>}
      </div>
      <button onClick={onDismiss} className="opacity-50 hover:opacity-100 text-lg leading-none">
        ×
      </button>
    </div>
  )
}
