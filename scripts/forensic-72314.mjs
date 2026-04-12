/**
 * Forensic report for order #72314
 * Reads all relevant KV keys and prints everything raw.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env.local
const envPath = resolve(process.cwd(), '.env.local')
const envLines = readFileSync(envPath, 'utf-8').split('\n')
for (const line of envLines) {
  const [k, ...v] = line.split('=')
  if (k && v.length) process.env[k.trim()] = v.join('=').trim()
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

async function kvGet(key) {
  const { data, error } = await supabase
    .from('kv_store')
    .select('value, updated_at')
    .eq('key', key)
    .single()
  if (error && error.code !== 'PGRST116') {
    console.error(`ERROR fetching ${key}:`, error)
    return null
  }
  return data ?? null
}

function mentions72314(obj, depth = 0) {
  if (depth > 10) return false
  if (obj === null || obj === undefined) return false
  if (typeof obj === 'string') return obj.includes('72314')
  if (typeof obj === 'number') return obj === 72314
  if (Array.isArray(obj)) return obj.some(item => mentions72314(item, depth + 1))
  if (typeof obj === 'object') return Object.values(obj).some(v => mentions72314(v, depth + 1))
  return false
}

function section(title) {
  console.log('\n' + '='.repeat(80))
  console.log('  ' + title)
  console.log('='.repeat(80))
}

function subsection(title) {
  console.log('\n' + '-'.repeat(60))
  console.log('  ' + title)
  console.log('-'.repeat(60))
}

async function main() {
  console.log('FORENSIC REPORT — ORDER #72314')
  console.log('Generated at:', new Date().toISOString())
  console.log('Supabase URL:', SUPABASE_URL)

  const KEYS = [
    'criptoblue:logs',
    'criptoblue:match-log',
    'criptoblue:state',
    'criptoblue:audit:2026-04-09',
    'criptoblue:audit:2026-04-08',
    'criptoblue:processed',
  ]

  // Fetch all keys in parallel
  section('STEP 1 — FETCHING ALL KV KEYS')
  const results = {}
  await Promise.all(KEYS.map(async (key) => {
    console.log(`Fetching: ${key}`)
    const row = await kvGet(key)
    results[key] = row
    if (row) {
      const valueStr = JSON.stringify(row.value)
      console.log(`  -> updated_at: ${row.updated_at}  |  size: ${valueStr.length} chars`)
    } else {
      console.log(`  -> NOT FOUND or empty`)
    }
  }))

  // ────────────────────────────────────────────────────────────
  section('STEP 2 — AUDIT LOGS (2026-04-09 and 2026-04-08)')
  // ────────────────────────────────────────────────────────────

  for (const auditKey of ['criptoblue:audit:2026-04-09', 'criptoblue:audit:2026-04-08']) {
    subsection(`Key: ${auditKey}`)
    const row = results[auditKey]
    if (!row) { console.log('NOT FOUND'); continue }

    const val = row.value
    // The audit value might be an array or object with an array
    let entries = []
    if (Array.isArray(val)) entries = val
    else if (val && typeof val === 'object') {
      // look for any array property
      for (const [k, v] of Object.entries(val)) {
        if (Array.isArray(v)) { entries = v; console.log(`  (found entries under key "${k}")`); break }
      }
      if (entries.length === 0) entries = [val]
    }

    console.log(`Total entries in this audit key: ${entries.length}`)

    const matching = entries.filter(e => mentions72314(e))
    console.log(`Entries mentioning 72314: ${matching.length}`)

    if (matching.length === 0) {
      console.log('No entries found for 72314 in this audit key.')
      // Also print first 3 entries as sample to understand structure
      console.log('\nSample (first 3 entries for structure reference):')
      entries.slice(0, 3).forEach((e, i) => {
        console.log(`  [${i}]:`, JSON.stringify(e, null, 2))
      })
    } else {
      matching.forEach((e, i) => {
        console.log(`\n  [MATCH ${i + 1}]:`)
        console.log(JSON.stringify(e, null, 2))
      })
    }
  }

  // ────────────────────────────────────────────────────────────
  section('STEP 3 — registroLog (from criptoblue:logs)')
  // ────────────────────────────────────────────────────────────

  const logsRow = results['criptoblue:logs']
  if (!logsRow) {
    console.log('criptoblue:logs NOT FOUND')
  } else {
    const logsVal = logsRow.value
    const registroLog = logsVal?.registroLog ?? []
    console.log(`Total registroLog entries: ${registroLog.length}`)

    const matching = registroLog.filter(e => mentions72314(e))
    console.log(`Entries mentioning 72314: ${matching.length}`)

    if (matching.length === 0) {
      console.log('No entries found for 72314 in registroLog.')
      console.log('\nSample (first 3 entries):')
      registroLog.slice(0, 3).forEach((e, i) => {
        console.log(`  [${i}]:`, JSON.stringify(e, null, 2))
      })
    } else {
      matching.forEach((e, i) => {
        console.log(`\n  [registroLog MATCH ${i + 1}]:`)
        console.log(JSON.stringify(e, null, 2))
      })
    }

    // Also print errorLog and activityLog entries for 72314
    const errorLog = logsVal?.errorLog ?? []
    const errorMatches = errorLog.filter(e => mentions72314(e))
    console.log(`\nerrorLog total: ${errorLog.length}  |  mentioning 72314: ${errorMatches.length}`)
    errorMatches.forEach((e, i) => {
      console.log(`\n  [errorLog MATCH ${i + 1}]:`)
      console.log(JSON.stringify(e, null, 2))
    })

    const activityLog = logsVal?.activityLog ?? []
    const activityMatches = activityLog.filter(e => mentions72314(e))
    console.log(`\nactivityLog total: ${activityLog.length}  |  mentioning 72314: ${activityMatches.length}`)
    activityMatches.forEach((e, i) => {
      console.log(`\n  [activityLog MATCH ${i + 1}]:`)
      console.log(JSON.stringify(e, null, 2))
    })
  }

  // ────────────────────────────────────────────────────────────
  section('STEP 4 — matchLog (from criptoblue:match-log)')
  // ────────────────────────────────────────────────────────────

  const matchLogRow = results['criptoblue:match-log']
  if (!matchLogRow) {
    console.log('criptoblue:match-log NOT FOUND')
  } else {
    const matchLogVal = matchLogRow.value
    const matchLog = matchLogVal?.matchLog ?? []
    console.log(`Total matchLog entries: ${matchLog.length}`)

    const matching = matchLog.filter(e => mentions72314(e))
    console.log(`Entries mentioning 72314: ${matching.length}`)

    if (matching.length === 0) {
      console.log('No entries found for 72314 in matchLog.')
      console.log('\nSample (first 3 entries):')
      matchLog.slice(0, 3).forEach((e, i) => {
        console.log(`  [${i}]:`, JSON.stringify(e, null, 2))
      })
    } else {
      matching.forEach((e, i) => {
        console.log(`\n  [matchLog MATCH ${i + 1}]:`)
        console.log(JSON.stringify(e, null, 2))
      })
    }
  }

  // ────────────────────────────────────────────────────────────
  section('STEP 5 — STATE (criptoblue:state)')
  // ────────────────────────────────────────────────────────────

  const stateRow = results['criptoblue:state']
  if (!stateRow) {
    console.log('criptoblue:state NOT FOUND')
  } else {
    const stateVal = stateRow.value
    console.log(`State updated_at: ${stateRow.updated_at}`)

    // recentMatches
    subsection('recentMatches — entries for 72314')
    const recentMatches = stateVal?.recentMatches ?? []
    console.log(`Total recentMatches: ${recentMatches.length}`)
    const rmMatches = recentMatches.filter(e => mentions72314(e))
    console.log(`Mentioning 72314: ${rmMatches.length}`)
    if (rmMatches.length === 0) {
      console.log('No recentMatches found for 72314.')
    } else {
      rmMatches.forEach((e, i) => {
        console.log(`\n  [recentMatches MATCH ${i + 1}]:`)
        console.log(JSON.stringify(e, null, 2))
      })
    }

    // externallyMarkedOrders
    subsection('externallyMarkedOrders — check for 72314')
    const emo = stateVal?.externallyMarkedOrders ?? []
    console.log(`Total externallyMarkedOrders: ${emo.length}`)
    const emoMatches = emo.filter(e => mentions72314(e))
    console.log(`Entries mentioning 72314: ${emoMatches.length}`)
    if (emoMatches.length > 0) {
      console.log('FOUND:', JSON.stringify(emoMatches, null, 2))
    } else {
      console.log('72314 NOT found in externallyMarkedOrders.')
      // Print last 20 for context
      console.log('Last 20 entries:', JSON.stringify(emo.slice(-20), null, 2))
    }

    // externallyMarkedPayments
    subsection('externallyMarkedPayments — check for 72314')
    const emp = stateVal?.externallyMarkedPayments ?? []
    console.log(`Total externallyMarkedPayments: ${emp.length}`)
    const empMatches = emp.filter(e => mentions72314(e))
    console.log(`Entries mentioning 72314: ${empMatches.length}`)
    empMatches.forEach((e, i) => {
      console.log(`\n  [externallyMarkedPayments MATCH ${i + 1}]:`)
      console.log(JSON.stringify(e, null, 2))
    })

    // unmatchedPayments
    subsection('unmatchedPayments — check for 72314')
    const up = stateVal?.unmatchedPayments ?? []
    console.log(`Total unmatchedPayments: ${up.length}`)
    const upMatches = up.filter(e => mentions72314(e))
    console.log(`Entries mentioning 72314: ${upMatches.length}`)
    upMatches.forEach((e, i) => {
      console.log(`\n  [unmatchedPayments MATCH ${i + 1}]:`)
      console.log(JSON.stringify(e, null, 2))
    })

    // dismissedPairs
    subsection('dismissedPairs — check for 72314')
    const dp = stateVal?.dismissedPairs ?? []
    console.log(`Total dismissedPairs: ${dp.length}`)
    const dpMatches = dp.filter(e => mentions72314(e))
    console.log(`Entries mentioning 72314: ${dpMatches.length}`)
    dpMatches.forEach((e, i) => {
      console.log(`\n  [dismissedPairs MATCH ${i + 1}]:`)
      console.log(JSON.stringify(e, null, 2))
    })
  }

  // ────────────────────────────────────────────────────────────
  section('STEP 6 — processedPayments (criptoblue:processed)')
  // ────────────────────────────────────────────────────────────

  const processedRow = results['criptoblue:processed']
  if (!processedRow) {
    console.log('criptoblue:processed NOT FOUND')
  } else {
    const processedVal = processedRow.value
    const pp = processedVal?.processedPayments ?? []
    console.log(`Total processedPayments: ${pp.length}`)
    const ppMatches = pp.filter(e => mentions72314(e))
    console.log(`Entries mentioning 72314: ${ppMatches.length}`)
    if (ppMatches.length > 0) {
      console.log('FOUND:', JSON.stringify(ppMatches, null, 2))
    } else {
      console.log('72314 NOT found in processedPayments.')
    }
  }

  // ────────────────────────────────────────────────────────────
  section('STEP 7 — TIMELINE RECONSTRUCTION')
  // ────────────────────────────────────────────────────────────

  const allEvents = []

  // Collect from registroLog
  const logsVal = results['criptoblue:logs']?.value
  if (logsVal?.registroLog) {
    logsVal.registroLog.filter(e => mentions72314(e)).forEach(e => {
      allEvents.push({ source: 'registroLog', timestamp: e.timestamp, data: e })
    })
  }

  // Collect from matchLog
  const matchLogVal = results['criptoblue:match-log']?.value
  if (matchLogVal?.matchLog) {
    matchLogVal.matchLog.filter(e => mentions72314(e)).forEach(e => {
      allEvents.push({ source: 'matchLog', timestamp: e.timestamp, data: e })
    })
  }

  // Collect from recentMatches
  const stateVal = results['criptoblue:state']?.value
  if (stateVal?.recentMatches) {
    stateVal.recentMatches.filter(e => mentions72314(e)).forEach(e => {
      allEvents.push({ source: 'recentMatches', timestamp: e.matchedAt || e.timestamp, data: e })
    })
  }

  // Collect from audit logs
  for (const auditKey of ['criptoblue:audit:2026-04-09', 'criptoblue:audit:2026-04-08']) {
    const val = results[auditKey]?.value
    if (!val) continue
    let entries = []
    if (Array.isArray(val)) entries = val
    else if (val && typeof val === 'object') {
      for (const v of Object.values(val)) {
        if (Array.isArray(v)) { entries = v; break }
      }
    }
    entries.filter(e => mentions72314(e)).forEach(e => {
      allEvents.push({ source: auditKey, timestamp: e.timestamp, data: e })
    })
  }

  // Collect from activityLog
  if (logsVal?.activityLog) {
    logsVal.activityLog.filter(e => mentions72314(e)).forEach(e => {
      allEvents.push({ source: 'activityLog', timestamp: e.timestamp, data: e })
    })
  }

  // Sort by timestamp
  allEvents.sort((a, b) => {
    if (!a.timestamp) return 1
    if (!b.timestamp) return -1
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  })

  console.log(`\nTotal timeline events found: ${allEvents.length}`)

  if (allEvents.length === 0) {
    console.log('No events found for order 72314 across any key.')
  } else {
    allEvents.forEach((ev, i) => {
      console.log(`\n[EVENT ${i + 1}] source=${ev.source}  timestamp=${ev.timestamp}`)
      // Highlight key fields
      const d = ev.data
      const highlights = {
        action: d.action,
        type: d.type,
        actor: d.actor,
        orderNumber: d.orderNumber,
        orderId: d.orderId,
        mpPaymentId: d.mpPaymentId || d.payment?.mpPaymentId,
        amount: d.amount || d.payment?.monto,
        storeName: d.storeName || d.store,
        customerName: d.customerName,
        matchedBy: d.matchedBy,
        ip: d.ip,
        userAgent: d.userAgent,
        requestId: d.requestId,
        endpoint: d.endpoint,
      }
      console.log('  Key fields:', JSON.stringify(highlights))
      console.log('  Full data:', JSON.stringify(d, null, 2))
    })

    // Duplicate detection
    console.log('\n' + '-'.repeat(60))
    console.log('DUPLICATE MARK ANALYSIS')
    console.log('-'.repeat(60))

    const markEvents = allEvents.filter(ev => {
      const d = ev.data
      return (d.action && (d.action.includes('mark') || d.action.includes('match') || d.action.includes('manual'))) ||
             ev.source === 'registroLog' ||
             ev.source === 'matchLog' ||
             ev.source === 'recentMatches'
    })

    console.log(`Mark-related events: ${markEvents.length}`)

    if (markEvents.length >= 2) {
      const times = markEvents.map(ev => new Date(ev.timestamp).getTime()).filter(t => !isNaN(t))
      if (times.length >= 2) {
        times.sort((a, b) => a - b)
        const diffMs = times[times.length - 1] - times[0]
        console.log(`\nTime between first and last mark event: ${diffMs}ms (${(diffMs / 1000).toFixed(2)}s)`)
        if (diffMs < 5000) {
          console.log('>>> POSSIBLE DOUBLE-CLICK / DOUBLE-SUBMIT: events within 5 seconds')
        } else if (diffMs < 60000) {
          console.log('>>> Events within 1 minute — could be two rapid manual actions')
        } else {
          console.log(`>>> Events separated by ${(diffMs / 1000 / 60).toFixed(1)} minutes — more likely two separate human actions`)
        }
      }
    }

    // Actor analysis
    const actors = [...new Set(allEvents.map(ev => ev.data.actor || ev.data.matchedBy || ev.data.ip || 'unknown'))]
    console.log(`\nDistinct actors/IPs: ${JSON.stringify(actors)}`)
    if (actors.filter(a => a !== 'unknown' && a !== 'system').length > 1) {
      console.log('>>> MULTIPLE DISTINCT ACTORS — likely two separate humans')
    } else {
      console.log('>>> Single actor or undetermined')
    }
  }

  section('END OF FORENSIC REPORT')
}

main().catch(e => {
  console.error('FATAL ERROR:', e)
  process.exit(1)
})
