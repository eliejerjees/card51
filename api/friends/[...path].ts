import type { IncomingMessage, ServerResponse } from "node:http";
import { handleFriendsRequest } from "../../server/friendsHandler";

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  await handleFriendsRequest(request, response);
}
