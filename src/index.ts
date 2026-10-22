#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { baseUrlFor, readToken } from "./config.js";
import { buildServer } from "./server.js";

const token = readToken(process.env);
if (!token) {
  console.error(
    "calculator-mcp: не задан CALCULATOR_API_TOKEN (или прежний CLIENTCORE_API_TOKEN). Получи ключ КП в Настройках своего портала (ClientCore: offer.clientcore.ru, ключ начинается с cck_; Retail Rocket: rrsales.clientcore.ru, ключ с rrk_) и добавь его в конфиг MCP-клиента."
  );
  process.exit(1);
}

const server = await buildServer(token, process.env);
await server.connect(new StdioServerTransport());
console.error(`calculator-mcp подключён · ${baseUrlFor(token, process.env)}`);
