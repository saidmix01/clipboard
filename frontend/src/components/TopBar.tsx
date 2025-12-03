import { Cog6ToothIcon, ArrowRightStartOnRectangleIcon, ArrowLeftEndOnRectangleIcon, UserCircleIcon, UserPlusIcon, XMarkIcon } from '@heroicons/react/24/outline'

type Props = {
  title?: string
  token: string | null
  userAvatar: string | null
  onLogin: () => void
  onLogout: () => void
  onRegister: () => void
  onUserModal: () => void
  onSettingsToggle: () => void
}

export default function TopBar({ title = '📋 Copyfy++', token, userAvatar, onLogin, onLogout, onRegister, onUserModal, onSettingsToggle }: Props) {
  return (
    <div className="relative z-[2000] w-full">
      <div className="flex items-center justify-between px-3 py-2 select-none" style={{ WebkitAppRegion: 'drag' as any }}>
        <h5 className="m-0 text-[15px] font-semibold text-[color:var(--color-text)]">{title}</h5>
        <div className="flex gap-2" style={{ WebkitAppRegion: 'no-drag' as any }}>
          {token ? (
            <button className="px-2 py-1 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text)] hover:bg-[color:var(--color-surface)] transition" title="Cerrar sesión" onClick={onLogout}>
              <ArrowRightStartOnRectangleIcon className="w-5 h-5" />
            </button>
          ) : (
            <button className="px-2 py-1 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text)] hover:bg-[color:var(--color-surface)] transition" title="Iniciar sesión" onClick={onLogin}>
              <ArrowLeftEndOnRectangleIcon className="w-5 h-5" />
            </button>
          )}
          {!token && (
            <button className="px-2 py-1 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text)] hover:bg-[color:var(--color-surface)] transition" title="Registrarse" onClick={onRegister}>
              <UserPlusIcon className="w-5 h-5" />
            </button>
          )}
          {token && (
            <button className="px-2 py-1 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text)] hover:bg-[color:var(--color-surface)] transition" title="Datos del usuario" onClick={onUserModal}>
              {userAvatar ? (
                <img src={userAvatar} className="w-[22px] h-[22px] rounded-full object-cover" />
              ) : (
                <UserCircleIcon className="w-5 h-5" />
              )}
            </button>
          )}
          <button className="px-2 py-1 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text)] hover:bg-[color:var(--color-surface)] transition" title="Configuración" onClick={onSettingsToggle}>
            <Cog6ToothIcon className="w-5 h-5" />
          </button>
          <button className="px-2 py-1 rounded-md border border-[color:var(--color-border)] text-[color:var(--color-text)] hover:bg-[color:var(--color-surface)] transition" title="Ocultar ventana" onClick={() => (window as any).electronAPI?.hideWindow?.()}>
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  )
}
