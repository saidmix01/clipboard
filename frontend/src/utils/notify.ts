/**
 * Wrapper para notificaciones nativas del sistema operativo.
 * Reemplaza react-hot-toast con Electron Notification API.
 */

const electronAPI = (window as any).electronAPI

export function notify(body: string, title = 'CopyFy++') {
  electronAPI?.showNotification?.({ title, body })
}

export function notifySuccess(body: string) {
  notify(body)
}

export function notifyError(body: string) {
  notify(body, 'CopyFy++ - Error')
}
