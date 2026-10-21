// Supabase の接続先。Supabase の「Project Settings → API」にある値を入れてください。
// anon（public）キーは公開して大丈夫な鍵です（データは RLS で守られています）。
// service_role キーは絶対にここに入れないでください。
window.KONDATE_CONFIG = {
  supabaseUrl: 'https://pknprxlgjmodqnnsqpjd.supabase.co',
  // 写真から勤務を読み込む機能（AI・有料）。使うときだけ true にする
  aiImport: false,
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBrbnByeGxnam1vZHFubnNxcGpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1Mjc1MjksImV4cCI6MjEwODEwMzUyOX0.JOagNuR3YSkqm6neGpS74MrEzxXHIGgC8zSMibYtPvw'
};
