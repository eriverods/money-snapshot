import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL || 'https://qcmjhoxgdlzqdfyyrrmt.supabase.co'
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const missingConfig = !key

export const supabase = missingConfig
  ? null
  : createClient(url, key)
