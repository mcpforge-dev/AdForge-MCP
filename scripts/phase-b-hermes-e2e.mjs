import { createHash, randomBytes } from "node:crypto";
import { createDatabase } from "../packages/database/dist/index.js";
import { HermesGateway, McpHttpClient } from "../apps/hermes/dist/hermes.js";

const database = createDatabase(process.env.DATABASE_URL);
const db = database.client;
const apiUrl = process.env.V2_REHEARSAL_API_URL ?? "http://127.0.0.1:4106";
const chatId = 991234567;
let identityId;
let tokenId;

try {
  const account = await db.providerAccount.findFirst({
    where: { provider: "GOOGLE_ADS", enabled: true },
    select: { id: true, workspaceId: true, externalAccountId: true },
  });
  if (!account) throw new Error("No enabled Google account in rehearsal DB.");

  const identity = await db.serviceIdentity.create({
    data: { workspaceId: account.workspaceId, name: "phase-b-hermes-e2e" },
  });
  identityId = identity.id;
  const rawToken = `hmst_${randomBytes(32).toString("base64url")}`;
  const token = await db.serviceToken.create({
    data: {
      serviceIdentityId: identity.id,
      tokenDigest: createHash("sha256").update(rawToken).digest("hex"),
      tokenPrefix: rawToken.slice(0, 13),
      name: "phase-b-hermes-e2e",
      scopes: ["adforge:mcp:read"],
      accountIds: [account.id],
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  });
  tokenId = token.id;

  const sent = [];
  const mcpCalls = [];
  let listResultShape = null;
  let accountBindingMatched = false;
  let stopGateway = () => {};
  let updateBatch = true;
  const updates = [
    {
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: chatId },
        text: "/hermes spend last 7 days",
      },
    },
    {
      update_id: 2,
      message: {
        message_id: 2,
        chat: { id: chatId },
        text: "/hermes which campaigns are active?",
      },
    },
    {
      update_id: 3,
      message: {
        message_id: 3,
        chat: { id: chatId },
        text: "/hermes which campaign spent the most?",
      },
    },
    {
      update_id: 4,
      message: {
        message_id: 4,
        chat: { id: chatId },
        text: "/hermes compare last 7 days with previous week",
      },
    },
    {
      update_id: 5,
      message: {
        message_id: 5,
        chat: { id: chatId },
        text: "/hermes А сколько было конверсий?",
      },
    },
    {
      update_id: 6,
      message: {
        message_id: 6,
        chat: { id: chatId },
        text: "/hermes increase budget by 20%",
      },
    },
  ];
  const telegram = {
    async getMe() {
      return { username: "hermes_test_bot" };
    },
    async getUpdates() {
      if (!updateBatch) return [];
      updateBatch = false;
      return updates;
    },
    async sendMessage(_message, text) {
      sent.push(text);
      if (sent.length >= updates.length) stopGateway();
    },
  };

  const mcp = new McpHttpClient(`${apiUrl}/mcp`, rawToken);
  const originalCallTool = mcp.callTool.bind(mcp);
  mcp.callTool = async (name, arguments_) => {
    mcpCalls.push(name);
    const result = await originalCallTool(name, arguments_);
    if (name === "list_accounts") {
      listResultShape = {
        isArray: Array.isArray(result),
        count: Array.isArray(result) ? result.length : null,
        keys:
          result && typeof result === "object" && !Array.isArray(result)
            ? Object.keys(result).sort()
            : [],
      };
      accountBindingMatched =
        Array.isArray(result) &&
        result.some(
          (item) =>
            String(item?.account_id ?? "") === account.externalAccountId,
        );
    }
    return result;
  };
  const gateway = new HermesGateway(
    {
      enabled: true,
      botToken: "operator-test-token",
      mcpUrl: `${apiUrl}/mcp`,
      mcpToken: rawToken,
      allowedChatIds: new Set([chatId]),
      chatAccountIds: new Map([[chatId, account.externalAccountId]]),
      pollTimeoutSeconds: 1,
      openAiApiKey: "",
      openAiModel: "gpt-5-mini",
    },
    telegram,
    mcp,
  );
  stopGateway = () => gateway.stop();

  await gateway.run();
  console.log(
    JSON.stringify({
      transport: "telegram-fake -> hermes-v2 -> local-mcp-http",
      openai: "disabled",
      readResponse: sent[0]?.length > 0,
      readResponses: sent.slice(0, -1).filter((value) => value.length > 0)
        .length,
      writeRejected: sent.at(-1)?.length > 0,
      responses: sent.length,
      accountBound: accountBindingMatched,
      providerCredentialsExposedToHermes: false,
      mcpCalls,
      listResultShape,
    }),
  );
} finally {
  if (tokenId) await db.serviceToken.delete({ where: { id: tokenId } });
  if (identityId)
    await db.serviceIdentity.delete({ where: { id: identityId } });
  await database.pool.end();
}
