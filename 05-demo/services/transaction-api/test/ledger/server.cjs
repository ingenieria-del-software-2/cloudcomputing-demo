const jsonServer = require('json-server');
const server = jsonServer.create();
const port = Number(process.env.PORT ?? 3001);

server.use(jsonServer.defaults({ logger: false }), jsonServer.bodyParser);
server.get('/readyz', (_, res) => res.json({ status: 'ready' }));
server.post('/ledger/entries', ({ body }, res) => {
  const id = body?.operation_id;
  res.status(201).json({
    ledger_entry_id:
      typeof id === 'string' ? `led_${id.slice(3)}` : 'led_unknown',
    operation_id: id,
    status: 'created',
  });
});

const listener = server.listen(port, '127.0.0.1');

process.on('SIGTERM', () => {
  listener.close(() => process.exit(0));
});
