const HEADER_SIZE = 1024
const HEADER_OFFSETS = [0x10000, 0x810000, 0x820000]
const HEADER_MAGIC = new TextEncoder().encode('SFBX')
const LOG_BLOCK_SZ = 0x1000
const FLASH_FILES: string[] = [
    "1smcbl_a.bin",
    "header.bin",
    "devkit.ini",
    "mtedata.cfg",
    "certkeys.bin",
    "smcerr.log",
    "system.xvd",
    "$sosrst.xvd",
    "download.xvd",
    "smc_s.cfg",
    "sp_s.cfg",
    "os_s.cfg",
    "smc_d.cfg",
    "sp_d.cfg",
    "os_d.cfg",
    "smcfw.bin",
    "boot.bin",
    "host.xvd",
    "settings.xvd",
    "1smcbl_b.bin",
    "bootanim.dat",
    "sostmpl.xvd",
    "update.cfg",
    "sosinit.xvd",
    "hwinit.cfg"
]
const VALIDATE_OFFSET = 0x5400
const SOC_OFFSET = 0x5410
const BARE_THRESHOLD = 256 * 1024

function getModelName(id: number) {
    const map = new Map<number, string>([
        [0x77, 'Zorro A0'],
        [0x78, 'Zorro B0'], [0x01, 'Zorro B0'],
        [0x79, 'Manda B0'], [0x02, 'Manda B0'],
        [0x7A, 'Vurna A0'],
        [0x7B, 'Vurna B0'], [0x03, 'Vurna B0'],
        [0x7C, 'Arlene A0'],
        [0x7D, 'Arlene A1'], [0x04, 'Arlene A1'],
        [0x7E, 'Arlene B0'], [0x05, 'Arlene B0']
    ])
    return map.get(id) || 'Unknown'
}

function showResult(socId: number) {
    const socHex = toHex(socId)

    const model = getModelName(socId)
    const message = `${socHex} — ${model}`
    if (socId === 0x77) {
      showMessage(message, 'ok')
    } else {
      showMessage(message, 'bad')
    }
}

async function readHeaderAt(file: File, offset: number) {
    if (offset + HEADER_SIZE > file.size) return null
    const ab = await file.slice(offset, offset + HEADER_SIZE).arrayBuffer()
    const slice = new Uint8Array(ab)
    // check magic
    for (let i = 0; i < 4; i++) if (slice[i] !== HEADER_MAGIC[i]) return null
    const view = new DataView(slice.buffer, slice.byteOffset, slice.byteLength)
    const format_version = view.getUint8(4)
    const sequence_version = view.getUint8(5)
    const layout_version = view.getUint16(6, true)
    const files: Array<{ offset: number; size: number }> = []
    let filesStart = 32
    for (let i = 0; i < 25; i++) {
    const entryBase = filesStart + i * 16
    const off = view.getUint32(entryBase, true)
    const sz = view.getUint32(entryBase + 4, true)
    files.push({ offset: off, size: sz })
    }
    // guid at offset 976 (not used here) and hash at 992
    return { headerOffset: offset, format_version, sequence_version, layout_version, files }
}

async function parseBareSpCfg(file: File): Promise<boolean> {
    if (file.size > BARE_THRESHOLD)
        return false
    // need at least validate bytes
    if (file.size <= VALIDATE_OFFSET + 1)
        return false
    
    const ab = await file.slice(0, Math.min(file.size, SOC_OFFSET + 1)).arrayBuffer()
    const buf = new Uint8Array(ab)
    
    if (buf.length <= VALIDATE_OFFSET + 1)
        return false
    if (buf[VALIDATE_OFFSET] !== 0x43 || buf[VALIDATE_OFFSET + 1] !== 0x43)
        return false
    if (buf.length <= SOC_OFFSET) {
        showMessage('bare sp_s.cfg too small for SocID', 'bad')
        return true
    }

    showResult(buf[SOC_OFFSET])

    return true
}


function log(msg: string) {
  const el = document.getElementById('log')!
  el.textContent = msg
}

function toHex(b: number) { return '0x' + b.toString(16).padStart(2, '0').toUpperCase() }

function showMessage(text: string, kind: 'ok'|'bad') {
  const overlay = document.getElementById('overlay')!
  const successImg = document.getElementById('success-img') as HTMLImageElement
  const failImg = document.getElementById('fail-img') as HTMLImageElement
  const spinner = document.getElementById('spinner') as HTMLElement | null
  const msg = document.getElementById('message')!

  // hide spinner and any previous overlays
  spinner?.classList.add('hidden')
  overlay.classList.add('hidden')
  successImg.classList.add('hidden')
  failImg.classList.add('hidden')

  if (kind === 'ok') {
    successImg.classList.remove('hidden')
  } else {
    failImg.classList.remove('hidden')
  }

  msg.textContent = text
  log(text)
}

async function handleFile(file: File) {
    // First try bare sp_s.cfg path for small files
    const bareHandled = await parseBareSpCfg(file)
    if (bareHandled) return

    // Otherwise parse XBFS headers
    const tables: any[] = []
    const headerOffsetsMap: Record<number, number> = {}
    for (const off of HEADER_OFFSETS) {
      const hdr = await readHeaderAt(file, off)
      if (hdr) {
        tables.push(hdr)
        headerOffsetsMap[hdr.sequence_version] = off
      }
    }

    if (tables.length === 0) {
      log('No valid XBFS table found')
      showMessage('No XBFS table found', 'bad')
      return
    }

    const seqList = tables.map(t => t.sequence_version)
    let seqHigh = Math.max(...seqList)
    let latestSeq = seqHigh
    if (seqList.includes(0) && seqHigh === 0xFF) latestSeq = 0
    const latestTable = tables.find(t => t.sequence_version === latestSeq) || tables[0]

    log(`Available sequences: ${seqList.join(', ')}`)
    log(`Using latest sequence: ${latestTable.sequence_version} (header offset 0x${headerOffsetsMap[latestTable.sequence_version].toString(16)})`)

    // find sp_s.cfg
    const spIndex = FLASH_FILES.indexOf('sp_s.cfg')
    if (spIndex < 0) {
      showMessage('sp_s.cfg not listed', 'bad')
      return
    }
    const entry = latestTable.files[spIndex]
    if (!entry || entry.size === 0) {
      showMessage('sp_s.cfg not present in XBFS', 'bad')
      return
    }

    const fileOffset = entry.offset * LOG_BLOCK_SZ
    const fileSize = entry.size * LOG_BLOCK_SZ
    if (fileOffset + fileSize > file.size) {
      showMessage('sp_s.cfg entry out of bounds', 'bad')
      return
    }
    const spAb = await file.slice(fileOffset, fileOffset + fileSize).arrayBuffer()
    const spBuf = new Uint8Array(spAb)
    if (spBuf.length === 0) {
      showMessage('sp_s.cfg empty', 'bad')
      return
    }

    // Validate sp_s.cfg by checking for ASCII "CC" at offset 0x5400
    const validateOffset = VALIDATE_OFFSET
    if (spBuf.length <= validateOffset + 1) {
      showMessage('sp_s.cfg too small for validation', 'bad')
      return
    }
    if (spBuf[validateOffset] !== 0x43 || spBuf[validateOffset + 1] !== 0x43) {
      showMessage('sp_s.cfg validation failed (missing "CC")', 'bad')
      return
    }

    showResult(spBuf[SOC_OFFSET])
}

function setupUI() {
  const drop = document.getElementById('drop-area')!
  const input = document.getElementById('file-input') as HTMLInputElement
  const choose = document.getElementById('choose-btn') as HTMLButtonElement | null

  // clicking the choose button triggers file picker; clicking the tile focuses the area
  if (choose) choose.addEventListener('click', (e) => { e.stopPropagation(); input.click() })
  drop.addEventListener('click', () => input.click())

  input.addEventListener('change', (ev) => {
    const f = input.files && input.files[0]
    if (f) handleFile(f)
  })

  drop.addEventListener('dragover', (e) => {
    e.preventDefault(); drop.classList.add('dragover')
  })
  drop.addEventListener('dragleave', (e) => { e.preventDefault(); drop.classList.remove('dragover') })
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('dragover')
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
    if (f) handleFile(f)
  })
}

setupUI()
