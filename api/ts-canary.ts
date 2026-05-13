export default function handler(_request: unknown, response: any): void {
  response.statusCode = 200;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify({ ok: true, status: 'typescript_function_ok', timestamp: new Date().toISOString() }));
}
