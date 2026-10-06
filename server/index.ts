import { createServer } from "http";
import next from "next";
import { Server } from "socket.io";
import { registerSocket } from "./socket";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);
const app = next({ dev, hostname: "0.0.0.0", port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => handle(req, res));
  const io = new Server(httpServer); // same origin as the page, so no CORS needed
  registerSocket(io);
  httpServer.listen(port, () => console.log(`> Ready on http://localhost:${port} (${dev ? "dev" : "prod"})`));
});
