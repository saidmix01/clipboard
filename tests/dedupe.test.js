const fs = require('fs')
const path = require('path')
const db = require('../db')

async function main() {
  const tmpDir = path.join(__dirname, '.tmp')
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

  const appMock = {
    getPath: (key) => {
      if (key === 'userData') return tmpDir
      return tmpDir
    },
    isPackaged: false
  }

  await db.init(appMock)

  const first = db.insertItem('hola', 'text')
  const second = db.insertItem('hola', 'text')

  const items = db.getItems(100, 0, { search: 'hola' })
  const sameValue = items.filter(i => i.value === 'hola' && i.type === 'text')

  console.log('Insert results:', first, second)
  console.log('Items count with value "hola":', sameValue.length)
  console.log('Items:', items)

  if (sameValue.length !== 1) {
    console.error('Test failed: expected 1 item with "hola", got', sameValue.length)
    process.exit(1)
  }

  console.log('Test passed')
}

main().catch(e => {
  console.error('Test error:', e)
  process.exit(1)
})
