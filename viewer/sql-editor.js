const { ipcRenderer } = require('electron')

let queryHistory = []
let tables = []
let currentTable = null
let currentTablePrimaryKey = null
let currentColumns = []
let currentRows = []
let editForm = null // Variable global para el formulario

// Cargar tablas al inicio
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM cargado, inicializando editor SQL')
  
  // Verificar que el modal existe
  const editModalCheck = document.getElementById('edit-modal')
  console.log('Modal en DOM:', !!editModalCheck)
  if (editModalCheck) {
    console.log('Modal encontrado, estado inicial:', window.getComputedStyle(editModalCheck).display)
  } else {
    console.error('ERROR CRÍTICO: Modal no encontrado en el DOM')
  }
  
  loadTables()
  
  const editor = document.getElementById('editor')
  const execBtn = document.getElementById('exec-btn')
  const clearBtn = document.getElementById('clear-btn')
  const refreshBtn = document.getElementById('refresh-tables-btn')
  const closeBtn = document.getElementById('close')
  const minimizeBtn = document.getElementById('minimize')
  const gutter = document.getElementById('gutter')
  
  // Event listeners
  execBtn.addEventListener('click', executeQuery)
  clearBtn.addEventListener('click', clearEditor)
  refreshBtn.addEventListener('click', loadTables)
  closeBtn.addEventListener('click', () => {
    ipcRenderer.send('window-close')
  })
  minimizeBtn.addEventListener('click', () => {
    ipcRenderer.send('window-minimize')
  })
  
  // Atajo de teclado: Ctrl+Enter para ejecutar
  editor.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      executeQuery()
    }
    updateGutter()
  })
  
  editor.addEventListener('input', updateGutter)
  editor.addEventListener('scroll', () => {
    gutter.scrollTop = editor.scrollTop
  })
  
  // Modal handlers
  const editModal = document.getElementById('edit-modal')
  const modalCloseBtn = document.getElementById('modal-close-btn')
  const cancelEditBtn = document.getElementById('cancel-edit-btn')
  editForm = document.getElementById('edit-form') // Asignar a variable global
  
  if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeEditModal)
  if (cancelEditBtn) cancelEditBtn.addEventListener('click', closeEditModal)
  if (editForm) editForm.addEventListener('submit', saveEdit)
  
  // Cerrar modal con ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && editModal.classList.contains('show')) {
      closeEditModal()
    }
  })
  
  // IPC listeners
  ipcRenderer.on('query-result', (_, result) => {
    displayResult(result)
  })
  
  ipcRenderer.on('query-error', (_, error) => {
    displayError(error)
  })
  
  ipcRenderer.on('tables-list', (_, tablesList) => {
    tables = tablesList
    renderTables()
  })
  
  ipcRenderer.on('table-info', (_, info) => {
    displayTableInfo(info)
  })
  
  // Cargar contenido inicial si viene en query string
  const urlParams = new URLSearchParams(window.location.search)
  const initialQuery = urlParams.get('query')
  if (initialQuery) {
    editor.value = decodeURIComponent(initialQuery)
    updateGutter()
  }
})

function updateGutter() {
  const editor = document.getElementById('editor')
  const gutter = document.getElementById('gutter')
  const lines = editor.value.split('\n')
  const lineCount = lines.length || 1
  gutter.textContent = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')
}

function clearEditor() {
  const editor = document.getElementById('editor')
  editor.value = ''
  updateGutter()
  hideResult()
}

function hideResult() {
  const resultContainer = document.getElementById('result-container')
  resultContainer.style.display = 'none'
}

function setStatus(message, isError = false) {
  const status = document.getElementById('status')
  status.textContent = message
  status.style.color = isError ? '#f44336' : '#999'
}

async function loadTables() {
  setStatus('Cargando tablas...')
  try {
    const result = await ipcRenderer.invoke('sql-list-tables')
    if (result.success && result.tables) {
      tables = result.tables
      renderTables()
    } else {
      setStatus('Error al cargar tablas', true)
    }
  } catch (err) {
    setStatus('Error al cargar tablas', true)
    console.error(err)
    // Fallback: intentar con el listener
    ipcRenderer.send('sql-list-tables')
  }
}

function renderTables() {
  const tablesList = document.getElementById('tables-list')
  if (!tables || tables.length === 0) {
    tablesList.innerHTML = '<div class="empty-state">No hay tablas</div>'
    return
  }
  
  tablesList.innerHTML = tables.map(table => `
    <div class="table-item" data-table="${table.name}">
      <div class="table-name">${escapeHtml(table.name)}</div>
      <div class="table-row-count">${table.rowCount} filas</div>
    </div>
  `).join('')
  
  // Event listeners para las tablas
  tablesList.querySelectorAll('.table-item').forEach(item => {
    item.addEventListener('click', () => {
      const tableName = item.dataset.table
      selectTable(tableName)
    })
  })
  
  setStatus(`${tables.length} tabla(s) cargada(s)`)
}

async function selectTable(tableName) {
  currentTable = tableName
  
  // Actualizar UI
  document.querySelectorAll('.table-item').forEach(item => {
    item.classList.remove('active')
    if (item.dataset.table === tableName) {
      item.classList.add('active')
    }
  })
  
  // Generar query SELECT
  const editor = document.getElementById('editor')
  editor.value = `SELECT * FROM ${tableName} LIMIT 50;`
  updateGutter()
  
  // Obtener información de la tabla para detectar clave primaria
  try {
    const result = await ipcRenderer.invoke('sql-get-table-info', tableName)
    if (result.success && result.info) {
      displayTableInfo(result.info)
      // Usar la clave primaria detectada por la función
      currentTablePrimaryKey = result.info.primaryKey || 'id'
    } else {
      currentTablePrimaryKey = 'id'
    }
  } catch (e) {
    ipcRenderer.send('sql-get-table-info', tableName)
    // Fallback: asumir 'id' como clave primaria
    currentTablePrimaryKey = 'id'
  }
}

function displayTableInfo(info) {
  // Mostrar información de la tabla en el sidebar si es necesario
  // Por ahora solo actualizamos el status
  if (info) {
    setStatus(`Tabla: ${info.name} - ${info.columnCount} columnas`)
  }
}

async function executeQuery() {
  const editor = document.getElementById('editor')
  const query = editor.value.trim()
  
  if (!query) {
    setStatus('Escribe una consulta SQL', true)
    return
  }
  
  setStatus('Ejecutando consulta...')
  
  // Agregar a historial
  if (!queryHistory.includes(query)) {
    queryHistory.unshift(query)
    if (queryHistory.length > 10) {
      queryHistory.pop()
    }
  }
  
  try {
    // Ejecutar query a través de IPC
    ipcRenderer.invoke('sql-execute-query', query).then(result => {
      if (result.success) {
        displayResult(result.result)
      } else {
        displayError(result.error || 'Error al ejecutar consulta')
        setStatus('Error', true)
      }
    }).catch(err => {
      displayError(err.message || 'Error al ejecutar consulta')
      setStatus('Error', true)
      // Fallback: usar listener
      ipcRenderer.send('sql-execute-query', query)
    })
  } catch (err) {
    displayError(err.message || 'Error al ejecutar consulta')
    setStatus('Error', true)
  }
}

function displayResult(result) {
  const resultContainer = document.getElementById('result-container')
  const resultContent = document.getElementById('result-content')
  const resultInfo = document.getElementById('result-info')
  
  resultContainer.style.display = 'flex'
  
  if (result.rowsAffected !== undefined) {
    // Query de modificación (INSERT, UPDATE, DELETE)
    resultInfo.textContent = `${result.rowsAffected} fila(s) afectada(s)`
    resultContent.innerHTML = `
      <div class="success-message">
        ✓ Consulta ejecutada exitosamente<br>
        ${result.rowsAffected} fila(s) afectada(s)
      </div>
    `
    setStatus(`Consulta ejecutada: ${result.rowsAffected} fila(s) afectada(s)`)
  } else if (result.columns && result.rows) {
    // Query SELECT - mostrar tabla
    const columns = result.columns
    const rows = result.rows
    
    resultInfo.textContent = `${rows.length} fila(s)`
    
    // Guardar datos actuales para edición/eliminación
    currentColumns = columns
    currentRows = rows
    
    // Si no hay tabla actual, intentar detectarla de la consulta
    if (!currentTable) {
      const editor = document.getElementById('editor')
      const query = editor.value.trim().toUpperCase()
      const match = query.match(/FROM\s+(\w+)/i)
      if (match && match[1]) {
        currentTable = match[1]
        console.log('Tabla detectada automáticamente:', currentTable)
        // Obtener información de la tabla para la clave primaria
        ipcRenderer.invoke('sql-get-table-info', currentTable).then(result => {
          if (result.success && result.info && result.info.primaryKey) {
            currentTablePrimaryKey = result.info.primaryKey
            console.log('Clave primaria detectada:', currentTablePrimaryKey)
          }
        }).catch(() => {
          currentTablePrimaryKey = 'id'
        })
      }
    }
    
    if (rows.length === 0) {
      resultContent.innerHTML = '<div class="empty-state">No se encontraron resultados</div>'
    } else {
      let tableHtml = '<table id="result-table"><thead><tr>'
      columns.forEach(col => {
        tableHtml += `<th>${escapeHtml(col)}</th>`
      })
      tableHtml += '<th>Acciones</th></tr></thead><tbody>'
      
      rows.forEach((row, rowIndex) => {
        tableHtml += `<tr data-row-index="${rowIndex}">`
        columns.forEach(col => {
          const value = row[col] !== null && row[col] !== undefined ? String(row[col]) : '(NULL)'
          // Truncar valores largos
          const displayValue = value.length > 100 ? value.substring(0, 100) + '...' : value
          tableHtml += `<td title="${escapeHtml(value)}">${escapeHtml(displayValue)}</td>`
        })
        // Botones de acción con data attributes en lugar de onclick
        tableHtml += '<td><div class="action-buttons">'
        tableHtml += `<button class="action-btn edit-btn" data-action="edit" data-row-index="${rowIndex}">Editar</button>`
        tableHtml += `<button class="action-btn delete-btn" data-action="delete" data-row-index="${rowIndex}">Eliminar</button>`
        tableHtml += '</div></td>'
        tableHtml += '</tr>'
      })
      
      tableHtml += '</tbody></table>'
      resultContent.innerHTML = tableHtml
      
          // Agregar event listeners después de insertar el HTML
      setTimeout(() => {
        attachTableActionListeners()
      }, 100)
    }
    
    setStatus(`Consulta ejecutada: ${rows.length} fila(s) encontrada(s)`)
  } else {
    resultInfo.textContent = ''
    resultContent.innerHTML = '<div class="success-message">✓ Consulta ejecutada exitosamente</div>'
    setStatus('Consulta ejecutada exitosamente')
  }
  
  // Recargar tablas después de modificaciones
  setTimeout(() => loadTables(), 500)
}

function displayError(error) {
  const resultContainer = document.getElementById('result-container')
  const resultContent = document.getElementById('result-content')
  const resultInfo = document.getElementById('result-info')
  
  resultContainer.style.display = 'flex'
  resultInfo.textContent = 'Error'
  resultContent.innerHTML = `<div class="error-message">${escapeHtml(error)}</div>`
  setStatus('Error al ejecutar consulta', true)
}

function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// Variable global para evitar múltiples listeners
let tableActionListenerAttached = false

// Función para agregar event listeners a los botones de acción de la tabla
function attachTableActionListeners() {
  const resultContent = document.getElementById('result-content')
  if (!resultContent) {
    console.error('result-content no encontrado')
    return
  }
  
  console.log('Agregando event listeners a la tabla')
  
  // Remover listener anterior si existe
  if (tableActionListenerAttached) {
    const newResultContent = resultContent.cloneNode(true)
    resultContent.parentNode.replaceChild(newResultContent, resultContent)
    tableActionListenerAttached = false
  }
  
  // Usar event delegation para manejar los clics
  const newContent = document.getElementById('result-content')
  if (!newContent) {
    console.error('No se pudo obtener result-content después del clone')
    return
  }
  
  newContent.addEventListener('click', (e) => {
    console.log('=== CLICK DETECTADO ===')
    console.log('Target:', e.target)
    
    const button = e.target.closest('button[data-action]')
    console.log('Botón encontrado:', !!button)
    
    if (!button) {
      return
    }
    
    const action = button.getAttribute('data-action')
    const rowIndexStr = button.getAttribute('data-row-index')
    const rowIndex = parseInt(rowIndexStr)
    
    console.log('Acción:', action)
    console.log('Fila:', rowIndex)
    
    if (isNaN(rowIndex)) {
      console.error('Índice de fila inválido:', rowIndexStr)
      alert('Error: Índice de fila inválido: ' + rowIndexStr)
      return
    }
    
    e.preventDefault()
    e.stopPropagation()
    
    if (action === 'edit') {
      console.log('>>> LLAMANDO A editRow CON ÍNDICE:', rowIndex, '<<<')
      try {
        editRow(rowIndex)
      } catch (err) {
        console.error('Error al llamar editRow:', err)
        alert('Error: ' + err.message)
      }
    } else if (action === 'delete') {
      console.log('>>> LLAMANDO A deleteRow CON ÍNDICE:', rowIndex, '<<<')
      try {
        deleteRow(rowIndex)
      } catch (err) {
        console.error('Error al llamar deleteRow:', err)
        alert('Error: ' + err.message)
      }
    }
  })
  
  tableActionListenerAttached = true
  console.log('Event listeners agregados correctamente')
}

// Funciones para editar y eliminar filas
function editRow(rowIndex) {
  console.log('editRow llamado con índice:', rowIndex)
  console.log('currentTable:', currentTable)
  console.log('currentRows.length:', currentRows.length)
  
  if (rowIndex < 0 || rowIndex >= currentRows.length) {
    console.error('Índice de fila inválido')
    alert('Error: Índice de fila inválido')
    return
  }
  
  const row = currentRows[rowIndex]
  const editModal = document.getElementById('edit-modal')
  const editFields = document.getElementById('edit-fields')
  
  if (!editModal || !editFields) {
    console.error('No se encontró el modal o los campos de edición')
    alert('Error: No se pudo encontrar el formulario de edición')
    return
  }
  
  // Si no hay tabla actual, intentar detectarla de la consulta
  let tableName = currentTable
  if (!tableName) {
    const editor = document.getElementById('editor')
    const query = editor.value.trim().toUpperCase()
    // Intentar extraer el nombre de la tabla de la consulta SELECT
    const match = query.match(/FROM\s+(\w+)/i)
    if (match && match[1]) {
      tableName = match[1]
      currentTable = tableName
      console.log('Tabla detectada de la consulta:', tableName)
    } else {
      alert('Error: No se pudo identificar la tabla. Por favor, selecciona una tabla primero o ejecuta una consulta SELECT FROM nombre_tabla')
      return
    }
  }
  
  // Limpiar campos anteriores
  editFields.innerHTML = ''
  
  // Crear campos de formulario
  currentColumns.forEach(col => {
    const formGroup = document.createElement('div')
    formGroup.className = 'form-group'
    
    const label = document.createElement('label')
    label.textContent = col
    label.setAttribute('for', `field-${col}`)
    
        // Usar input para campos cortos, textarea para campos largos
        const value = row[col] !== null && row[col] !== undefined ? String(row[col]) : ''
        const isLongField = value.length > 100 || col.toLowerCase().includes('value') || col.toLowerCase().includes('text') || col.toLowerCase().includes('data')
        
        const input = isLongField ? document.createElement('textarea') : document.createElement('input')
        input.id = `field-${col}`
        input.name = col
        input.value = value
        
        if (!isLongField) {
          input.type = 'text'
        }
        
        // Marcar clave primaria como solo lectura
        if (col === currentTablePrimaryKey || col.toLowerCase() === 'id') {
          input.readOnly = true
          input.title = 'Este campo no se puede editar (clave primaria)'
        }
    
    formGroup.appendChild(label)
    formGroup.appendChild(input)
    editFields.appendChild(formGroup)
  })
  
  // Guardar índice de fila actual
  const form = document.getElementById('edit-form')
  if (form) {
    form.dataset.rowIndex = rowIndex
    form.dataset.tableName = tableName
  } else if (editForm) {
    editForm.dataset.rowIndex = rowIndex
    editForm.dataset.tableName = tableName
  } else {
    console.error('No se encontró el formulario de edición')
  }
  
  // Obtener información de la tabla si no tenemos la clave primaria
  if (!currentTablePrimaryKey) {
    ipcRenderer.invoke('sql-get-table-info', tableName).then(result => {
      if (result.success && result.info && result.info.primaryKey) {
        currentTablePrimaryKey = result.info.primaryKey
        console.log('Clave primaria detectada:', currentTablePrimaryKey)
      } else {
        currentTablePrimaryKey = 'id'
      }
    }).catch(() => {
      currentTablePrimaryKey = 'id'
    })
  }
  
  // Mostrar modal - FORZAR VISIBILIDAD
  console.log('=== INTENTANDO MOSTRAR MODAL ===')
  console.log('editModal existe?', !!editModal)
  console.log('editFields existe?', !!editFields)
  console.log('Filas disponibles:', currentRows.length)
  console.log('Columnas:', currentColumns.length)
  
  if (!editModal) {
    console.error('ERROR: No se encontró el elemento edit-modal en el DOM')
    alert('Error: No se encontró el modal de edición. Verifica que el HTML esté correctamente cargado.')
    return
  }
  
  if (!editFields) {
    console.error('ERROR: No se encontró edit-fields')
    alert('Error: No se encontraron los campos del formulario.')
    return
  }
  
  // FORZAR TODAS LAS PROPIEDADES PARA GARANTIZAR VISIBILIDAD
  editModal.style.display = 'flex'
  editModal.style.position = 'fixed'
  editModal.style.top = '0'
  editModal.style.left = '0'
  editModal.style.right = '0'
  editModal.style.bottom = '0'
  editModal.style.width = '100%'
  editModal.style.height = '100%'
  editModal.style.zIndex = '10000'
  editModal.style.visibility = 'visible'
  editModal.style.opacity = '1'
  editModal.style.backgroundColor = 'rgba(0,0,0,0.8)'
  editModal.classList.add('show')
  
  // Verificar inmediatamente
  const computedStyle = window.getComputedStyle(editModal)
  console.log('Display del modal:', computedStyle.display)
  console.log('Z-index del modal:', computedStyle.zIndex)
  console.log('Visibility:', computedStyle.visibility)
  console.log('Opacity:', computedStyle.opacity)
  
  if (computedStyle.display === 'none') {
    console.error('ERROR: El modal sigue oculto, intentando método alternativo')
    // Método alternativo: crear un nuevo elemento modal
    editModal.removeAttribute('style')
    editModal.setAttribute('style', 'display: flex !important; position: fixed !important; inset: 0 !important; z-index: 10000 !important; background: rgba(0,0,0,0.8) !important; visibility: visible !important; opacity: 1 !important;')
  }
  
  console.log('Modal debería estar visible ahora. Verifica en la pantalla.')
  
  // Verificar que el contenido del modal también sea visible
  const modalContent = editModal.querySelector('.modal-content')
  if (modalContent) {
    modalContent.style.display = 'block'
    modalContent.style.visibility = 'visible'
    console.log('Contenido del modal verificado')
  }
}

async function deleteRow(rowIndex) {
  if (rowIndex < 0 || rowIndex >= currentRows.length) {
    alert('Error: Índice de fila inválido')
    return
  }
  
  // Si no hay tabla actual, intentar detectarla de la consulta
  let tableName = currentTable
  if (!tableName) {
    const editor = document.getElementById('editor')
    const query = editor.value.trim().toUpperCase()
    const match = query.match(/FROM\s+(\w+)/i)
    if (match && match[1]) {
      tableName = match[1]
      currentTable = tableName
    } else {
      alert('Error: No se pudo identificar la tabla. Por favor, selecciona una tabla primero.')
      return
    }
  }
  
  const row = currentRows[rowIndex]
  
  // Confirmar eliminación
  if (!confirm(`¿Estás seguro de eliminar este registro?\n\nClave primaria: ${row[currentTablePrimaryKey] || row.id || Object.values(row)[0] || 'N/A'}`)) {
    return
  }
  
  try {
    setStatus('Eliminando registro...')
    
    // Construir query DELETE
    const pkValue = row[currentTablePrimaryKey] || row.id || Object.values(row)[0]
    if (!pkValue && pkValue !== 0) {
      throw new Error('No se pudo identificar la clave primaria del registro')
    }
    
    // Determinar el nombre correcto de la clave primaria
    let pkColumn = currentTablePrimaryKey
    if (!pkColumn) {
      // Intentar encontrar id o el primer campo
      pkColumn = Object.keys(row).find(k => k.toLowerCase() === 'id') || Object.keys(row)[0]
    }
    
    const escapedPkValue = typeof pkValue === 'string' 
      ? `'${pkValue.replace(/'/g, "''")}'` 
      : pkValue
    const deleteQuery = `DELETE FROM ${tableName} WHERE ${pkColumn} = ${escapedPkValue}`
    
    const result = await ipcRenderer.invoke('sql-execute-query', deleteQuery)
    
    if (result.success) {
      setStatus('Registro eliminado exitosamente')
      // Recargar la consulta actual
      const editor = document.getElementById('editor')
      const currentQuery = editor.value.trim()
      if (currentQuery) {
        executeQuery()
      }
      // Recargar tablas para actualizar contadores
      setTimeout(() => loadTables(), 300)
    } else {
      throw new Error(result.error || 'Error al eliminar registro')
    }
  } catch (err) {
    displayError(err.message || 'Error al eliminar registro')
    setStatus('Error al eliminar', true)
  }
}

function closeEditModal() {
  const editModal = document.getElementById('edit-modal')
  if (editModal) {
    editModal.classList.remove('show')
    editModal.style.display = 'none'
  }
  // Limpiar formulario
  const editFields = document.getElementById('edit-fields')
  if (editFields) {
    editFields.innerHTML = ''
  }
  const form = document.getElementById('edit-form') || editForm
  if (form) {
    form.dataset.rowIndex = ''
    form.dataset.tableName = ''
  }
}

// Hacer función global para onclick del modal
window.closeEditModal = closeEditModal

async function saveEdit(e) {
  e.preventDefault()
  
  const form = document.getElementById('edit-form') || editForm
  if (!form) {
    alert('Error: No se encontró el formulario')
    return
  }
  
  const tableName = form.dataset.tableName || currentTable
  if (!tableName) {
    alert('Error: No se pudo identificar la tabla')
    return
  }
  
  const rowIndex = parseInt(form.dataset.rowIndex)
  if (rowIndex < 0 || rowIndex >= currentRows.length) {
    alert('Error: Índice de fila inválido')
    return
  }
  
  const originalRow = currentRows[rowIndex]
  const pkValue = originalRow[currentTablePrimaryKey] || originalRow.id || Object.values(originalRow)[0]
  
  if (!pkValue && pkValue !== 0) {
    alert('No se pudo identificar la clave primaria del registro')
    return
  }
  
  try {
    setStatus('Guardando cambios...')
    
    // Recopilar valores del formulario directamente desde los inputs
    const updates = []
    
    currentColumns.forEach(col => {
      // No actualizar la clave primaria
      if (col === currentTablePrimaryKey || col.toLowerCase() === 'id') {
        return
      }
      
      const input = document.getElementById(`field-${col}`)
      if (!input) return
      
      const newValue = input.value
      const oldValue = originalRow[col]
      
      // Solo actualizar si cambió
      if (String(newValue) !== String(oldValue !== null && oldValue !== undefined ? oldValue : '')) {
        // Escapar comillas simples en strings
        const escapedValue = typeof newValue === 'string' && newValue.length > 0
          ? `'${newValue.replace(/'/g, "''")}'` 
          : (newValue === '' ? "''" : 'NULL')
        updates.push(`${col} = ${escapedValue}`)
      }
    })
    
    if (updates.length === 0) {
      closeEditModal()
      setStatus('No hay cambios que guardar')
      return
    }
    
    // Construir query UPDATE
    const pkColumn = currentTablePrimaryKey || 'id'
    const escapedPkValue = typeof pkValue === 'string' 
      ? `'${String(pkValue).replace(/'/g, "''")}'` 
      : pkValue
    const updateQuery = `UPDATE ${tableName} SET ${updates.join(', ')} WHERE ${pkColumn} = ${escapedPkValue}`
    
    const result = await ipcRenderer.invoke('sql-execute-query', updateQuery)
    
    if (result.success) {
      setStatus('Registro actualizado exitosamente')
      closeEditModal()
      // Recargar la consulta actual
      const editor = document.getElementById('editor')
      const currentQuery = editor.value.trim()
      if (currentQuery) {
        setTimeout(() => executeQuery(), 300)
      }
    } else {
      throw new Error(result.error || 'Error al actualizar registro')
    }
  } catch (err) {
    displayError(err.message || 'Error al guardar cambios')
    setStatus('Error al guardar', true)
  }
}