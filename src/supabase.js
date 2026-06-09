import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://kskueunxzzurmtmqgvva.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtza3VldW54enp1cm10bXFndnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5NDI0NzQsImV4cCI6MjA5NjUxODQ3NH0.8dV3grCO6kgjftdpvi7fqSFVSO7VrHAdAcvbwrNmfjo'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
