import { createClient } from '@supabase/supabase-js'

const rawUrl = import.meta.env.VITE_SUPABASE_URL
const rawKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const url = (rawUrl && rawUrl.startsWith('https://'))
  ? rawUrl
  : 'https://qcmjhoxgdlzqdfyyrrmt.supabase.co'

const key = rawKey || ''

export const missingConfig = !key

export const supabase = missingConfig
  ? null
  : createClient(url, key)
