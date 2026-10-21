// The LAN listener: a second http.Server with the data plane only (`/v1`, `/v1beta`, `/healthz`) — never the
// admin surface, the websocket or the app. Bind address and allowlist are the user's decision; this only serves.
import http from 'node:http';

export class GatewayListener {
  private srv: http.Server | null = null;
  private _port = 0;

  constructor(private onRequest: (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => void) {}

  get running() { return !!this.srv; }
  get port() { return this._port; }

  async start(bind: string, port: number): Promise<number> {
    await this.stop();
    const srv = http.createServer((req, res) => {
      let url: URL;
      try { url = new URL(req.url ?? '/', `http://${bind}`); } catch { res.writeHead(400).end(); return; }
      this.onRequest(req, res, url);
    });
    await new Promise<void>((resolve, reject) => {
      srv.once('error', reject);
      srv.listen(port, bind, () => resolve());
    });
    this.srv = srv;
    this._port = (srv.address() as { port: number }).port;
    return this._port;
  }

  async stop(): Promise<void> {
    const srv = this.srv;
    if (!srv) return;
    this.srv = null;
    this._port = 0;
    await new Promise<void>((r) => { srv.close(() => r()); srv.closeAllConnections(); });
  }
}
