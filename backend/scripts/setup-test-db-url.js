// "mysql://root:@localhost:3306/wondertutor"  ->  "mysql://root:@localhost:3306/wondertutor_test"
export function testDatabaseUrl(url) {
  if (!url) throw new Error('DATABASE_URL is not set (see backend/.env.example)')
  const u = new URL(url)
  const name = u.pathname.slice(1)
  u.pathname = `/${name.endsWith('_test') ? name : `${name}_test`}`
  return u.toString()
}
