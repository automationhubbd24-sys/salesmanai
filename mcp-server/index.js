import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import pg from 'pg';
import axios from 'axios';
import { Client } from 'ssh2';
import dotenv from 'dotenv';

dotenv.config();

// 1. CONFIGURATION
const PG_CONFIG = {
  connectionString: process.env.DATABASE_URL,
};

const COOLIFY_CONFIG = {
  baseUrl: process.env.COOLIFY_URL, // e.g., https://coolify.yourdomain.com/api/v1
  token: process.env.COOLIFY_TOKEN,
};

const HOSTINGER_CONFIG = {
  host: process.env.HOSTINGER_HOST,
  port: 22,
  username: process.env.HOSTINGER_USER,
  password: process.env.HOSTINGER_PASSWORD, // or privateKey
};

// 2. SERVER SETUP
const server = new Server(
  {
    name: "devops-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 3. TOOL DEFINITIONS
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "query_postgres",
        description: "Run a read-only SQL query on the Postgres database",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "SQL query to execute (SELECT only)" },
          },
          required: ["query"],
        },
      },
      {
        name: "deploy_coolify_service",
        description: "Trigger a deployment for a specific service in Coolify",
        inputSchema: {
          type: "object",
          properties: {
            serviceUuid: { type: "string", description: "UUID of the service/application in Coolify" },
            force: { type: "boolean", description: "Force rebuild" },
          },
          required: ["serviceUuid"],
        },
      },
      {
        name: "hostinger_list_servers",
        description: "List all VPS servers from Hostinger account via API",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

// 4. TOOL IMPLEMENTATIONS
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "query_postgres": {
      const { query } = request.params.arguments;
      if (!query.trim().toLowerCase().startsWith("select")) {
        throw new Error("Only SELECT queries are allowed for safety.");
      }
      const client = new pg.Client(PG_CONFIG);
      try {
        await client.connect();
        const res = await client.query(query);
        await client.end();
        return {
          content: [{ type: "text", text: JSON.stringify(res.rows, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Database Error: ${err.message}` }],
          isError: true,
        };
      }
    }

    case "deploy_coolify_service": {
      const { serviceUuid, force } = request.params.arguments;
      try {
        const url = `${COOLIFY_CONFIG.baseUrl}/deploy?uuid=${serviceUuid}&force=${force ? 'true' : 'false'}`;
        const response = await axios.get(url, {
          headers: { Authorization: `Bearer ${COOLIFY_CONFIG.token}` },
        });
        return {
          content: [{ type: "text", text: `Deployment Triggered: ${JSON.stringify(response.data)}` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Coolify Error: ${err.message}` }],
          isError: true,
        };
      }
    }

    case "hostinger_list_servers": {
      try {
        const response = await axios.get('https://api.hostinger.com/v1/servers', {
          headers: { Authorization: `Bearer ${HOSTINGER_CONFIG.password}` }, // Using password field as token
        });
        return {
          content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Hostinger API Error: ${err.message}` }],
          isError: true,
        };
      }
    }

    default:
      throw new Error("Tool not found");
  }
});

// 5. START SERVER
const transport = new StdioServerTransport();
await server.connect(transport);
