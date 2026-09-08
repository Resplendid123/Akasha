import { WebSocketServer } from 'ws';
import { Logger } from '@nestjs/common';

export class CollabWsAdapter {
  private readonly logger = new Logger(CollabWsAdapter.name);
  private readonly wss: WebSocketServer;

  constructor() {
    this.wss = new WebSocketServer({ noServer: true });
  }

  handleUpgrade(path: string, httpServer: any) {
    httpServer.on('upgrade', (request: any, socket: any, head: any) => {
      try {
        const baseUrl = 'ws://' + request.headers.host + '/';
        const pathname = new URL(request.url, baseUrl).pathname;

        if (pathname === path) {
          this.wss.handleUpgrade(request, socket, head, (ws) => {
            this.wss.emit('connection', ws, request);
          });
        } else if (pathname === '/socket.io/') {
          return;
        } else {
          socket.destroy();
        }
      } catch (err) {
        socket.end('HTTP/1.1 400\r\n' + (err as Error).message);
      }
    });

    return this.wss;
  }

  public close() {
    try {
      this.wss.close();
    } catch (err) {
      this.logger.error(
        { op: 'close', err },
        'Failed to close WebSocket server',
      );
    }
  }

  public destroy() {
    try {
      this.wss.close();
      this.wss.clients.forEach((client) => {
        client.terminate();
      });
    } catch (err) {
      this.logger.error(
        { op: 'destroy', err },
        'Failed to destroy WebSocket server',
      );
    }
  }
}
