import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { handleFriendsRequest } from "./server/friendsHandler";

function friendsApi(): Plugin {
  return {
    name: "card51-friends-api",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/api/friends")) return next();
        await handleFriendsRequest(request, response);
      });
    },
  };
}

export default defineConfig({
  plugins: [friendsApi(), react()],
});
