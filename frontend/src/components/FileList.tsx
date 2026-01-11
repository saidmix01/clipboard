import { 
  DocumentIcon, 
  TrashIcon, 
  ArrowDownTrayIcon, 
  PhotoIcon, 
  MusicalNoteIcon, 
  VideoCameraIcon, 
  CodeBracketIcon, 
  ArchiveBoxIcon,
  DocumentTextIcon,
  ChevronLeftIcon,
  ChevronRightIcon
} from '@heroicons/react/24/outline'

type FileItem = {
  id: string
  originalName: string
  mimeType: string
  size: number
  path: string
  createdAt: string
}

type StorageInfo = {
  usedBytes: number
  availableBytes: number
  quotaBytes: number
}

type Props = {
  items: FileItem[]
  storage: StorageInfo | null
  currentPage?: number
  totalPages?: number
  totalItems?: number
  limit?: number
  onPageChange?: (page: number) => void
  onLimitChange?: (limit: number) => void
  onDelete: (item: FileItem) => void
  onDownload: (item: FileItem) => void
}

const formatBytes = (bytes: number, decimals = 2) => {
  if (!+bytes) return '0 B'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

const FileIcon = ({ filename }: { filename: string }) => {
  const ext = filename?.split('.').pop()?.toLowerCase() || ''
  const className = "w-6 h-6 text-[color:var(--color-primary)] opacity-90"
  
  if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp'].includes(ext)) return <PhotoIcon className={className} />
  if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) return <MusicalNoteIcon className={className} />
  if (['mp4', 'avi', 'mov', 'webm', 'mkv'].includes(ext)) return <VideoCameraIcon className={className} />
  if (['json', 'js', 'ts', 'tsx', 'jsx', 'html', 'css', 'py', 'java', 'c', 'cpp', 'sql'].includes(ext)) return <CodeBracketIcon className={className} />
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return <ArchiveBoxIcon className={className} />
  if (['txt', 'md', 'rtf', 'log'].includes(ext)) return <DocumentTextIcon className={className} />
  if (['pdf'].includes(ext)) return <DocumentTextIcon className={className} />
  
  return <DocumentIcon className={className} />
}

export default function FileList({ 
  items, 
  storage, 
  currentPage = 1,
  totalPages = 1,
  totalItems = 0,
  limit = 50,
  onPageChange,
  onLimitChange,
  onDelete, 
  onDownload 
}: Props) {
  const percent = storage ? Math.min(100, Math.max(0, (storage.usedBytes / storage.quotaBytes) * 100)) : 0
  const hasPagination = totalItems > 0 && totalPages > 0
  
  const handlePrevious = () => {
    if (currentPage > 1 && onPageChange) {
      onPageChange(currentPage - 1)
    }
  }
  
  const handleNext = () => {
    if (currentPage < totalPages && onPageChange) {
      onPageChange(currentPage + 1)
    }
  }
  
  const handlePageClick = (page: number) => {
    if (page >= 1 && page <= totalPages && onPageChange) {
      onPageChange(page)
    }
  }
  
  const getVisiblePages = () => {
    const pages: (number | string)[] = []
    const maxVisible = 5
    
    if (totalPages <= maxVisible) {
      // Mostrar todas las páginas
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i)
      }
    } else {
      // Mostrar páginas con ellipsis
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) pages.push(i)
        pages.push('...')
        pages.push(totalPages)
      } else if (currentPage >= totalPages - 2) {
        pages.push(1)
        pages.push('...')
        for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i)
      } else {
        pages.push(1)
        pages.push('...')
        for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i)
        pages.push('...')
        pages.push(totalPages)
      }
    }
    
    return pages
  }
  
  const shouldShowPagination = hasPagination && totalItems > 0
  
  return (
    <div className="flex-1 flex flex-col relative overflow-hidden">
      {/* Contenedor scrollable de items */}
      <div className="flex-1 flex flex-col gap-2 p-2 overflow-y-auto scrollbar-hide" style={{ paddingBottom: shouldShowPagination ? '100px' : '0.5rem' }}>
         {storage && (
           <div className="mb-2 px-1">
             <div className="flex justify-between text-[10px] text-[color:var(--color-muted)] mb-1">
               <span>Almacenamiento</span>
               <span>{formatBytes(storage.usedBytes)} de {formatBytes(storage.quotaBytes)}</span>
             </div>
             <div className="h-1.5 w-full bg-[color:var(--color-bg)] rounded-full overflow-hidden border border-[color:var(--color-border)]">
               <div 
                 className="h-full bg-[color:var(--color-primary)] transition-all duration-500"
                 style={{ width: `${percent}%` }}
               />
             </div>
           </div>
         )}

         {(!items || items.length === 0) ? (
            <div className="flex-1 flex items-center justify-center text-[color:var(--color-muted)] text-xs min-h-[100px]">No hay documentos</div>
         ) : (
            <>
              {items.map(item => (
                <div key={item.id} className="glass p-2 rounded-xl flex items-center justify-between group hover:bg-[color:var(--color-surface)] transition border border-transparent hover:border-[color:var(--color-border)]">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="p-2 bg-[color:var(--color-bg)] rounded-lg flex-shrink-0">
                        <FileIcon filename={item.originalName} />
                      </div>
                      <div className="flex flex-col overflow-hidden min-w-0">
                          <span className="text-sm font-medium truncate text-[color:var(--color-text)]" title={item.originalName}>{item.originalName}</span>
                          <span className="text-[10px] text-[color:var(--color-muted)] truncate">{(item.size / 1024).toFixed(1)} KB • {new Date(item.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition flex-shrink-0 pl-2">
                      <button onClick={(e) => { e.stopPropagation(); onDownload(item) }} className="p-2 hover:bg-[color:var(--color-bg)] rounded-lg text-[color:var(--color-text)] transition" title="Descargar">
                          <ArrowDownTrayIcon className="w-4 h-4" />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); onDelete(item) }} className="p-2 hover:bg-red-500/10 text-red-400 rounded-lg transition" title="Eliminar">
                          <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                </div>
              ))}
            </>
         )}
      </div>
      
      {/* Controles de paginación fijos en la parte inferior */}
      {shouldShowPagination && (
        <div className="absolute bottom-0 left-0 right-0 bg-[color:var(--color-bg)] border-t border-[color:var(--color-border)] px-3 py-2 flex flex-col gap-2 shadow-lg">
          {/* Información de paginación */}
          <div className="flex items-center justify-between text-[11px] text-[color:var(--color-muted)]">
            <div>
              Página {currentPage} de {totalPages}
            </div>
            {onLimitChange && (
              <div className="flex items-center gap-2">
                <span>Por página:</span>
                <select
                  value={limit}
                  onChange={(e) => onLimitChange(Number(e.target.value))}
                  className="px-2 py-1 rounded border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-text)] text-[11px] outline-none focus:border-[color:var(--color-primary)]"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
              </div>
            )}
          </div>
          
          {/* Botones de navegación */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1">
              <button
                onClick={handlePrevious}
                disabled={currentPage === 1}
                className={`p-1.5 rounded border transition ${
                  currentPage === 1
                    ? 'border-[color:var(--color-border)] opacity-40 cursor-not-allowed'
                    : 'border-[color:var(--color-border)] bg-[color:var(--color-surface)] hover:bg-[color:var(--color-bg)] cursor-pointer'
                }`}
                title="Página anterior"
              >
                <ChevronLeftIcon className="w-4 h-4 text-[color:var(--color-text)]" />
              </button>
              
              {getVisiblePages().map((page, idx) => {
                if (page === '...') {
                  return (
                    <span key={`ellipsis-${idx}`} className="px-2 text-[color:var(--color-muted)] text-xs">
                      ...
                    </span>
                  )
                }
                const pageNum = page as number
                const isActive = pageNum === currentPage
                return (
                  <button
                    key={pageNum}
                    onClick={() => handlePageClick(pageNum)}
                    className={`px-2.5 py-1 rounded text-xs transition ${
                      isActive
                        ? 'bg-[color:var(--color-primary)] text-white font-medium'
                        : 'border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-text)] hover:bg-[color:var(--color-bg)]'
                    }`}
                  >
                    {pageNum}
                  </button>
                )
              })}
              
              <button
                onClick={handleNext}
                disabled={currentPage === totalPages}
                className={`p-1.5 rounded border transition ${
                  currentPage === totalPages
                    ? 'border-[color:var(--color-border)] opacity-40 cursor-not-allowed'
                    : 'border-[color:var(--color-border)] bg-[color:var(--color-surface)] hover:bg-[color:var(--color-bg)] cursor-pointer'
                }`}
                title="Página siguiente"
              >
                <ChevronRightIcon className="w-4 h-4 text-[color:var(--color-text)]" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
